param(
    [string]$ChannelCsv = "",
    [string]$BaseLive = "",
    [string]$YoutubeOutput = "",
    [string]$MergedOutput = "",
    [string]$ReportOutput = "",
    [string]$YtDlpPath = "",
    [string]$CookiesFile = "",
    [string]$CookiesFromBrowser = "",
    [int]$MaxChannels = 0,
    [int]$MaxHeight = 480,
    [int]$SocketTimeoutSec = 15,
    [int]$ProcessTimeoutSec = 45,
    [int]$StreamValidationTimeoutSec = 8,
    [int]$SegmentProbeBytes = 262144,
    [int]$MinSegmentBytes = 65536,
    [int]$MinSegmentKbps = 600,
    [int]$RetryCount = 2,
    [switch]$DownloadYtDlp,
    [switch]$SkipResolve,
    [switch]$IncludeOriginalOnFailure,
    [switch]$KeepFallbackInPlaylist
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if ([string]::IsNullOrWhiteSpace($ChannelCsv)) { $ChannelCsv = Join-Path $repoRoot "sources\youtube-live-channels.csv" }
if ([string]::IsNullOrWhiteSpace($BaseLive)) { $BaseLive = Join-Path $repoRoot "sources\live-verified-only.txt" }
if ([string]::IsNullOrWhiteSpace($YoutubeOutput)) { $YoutubeOutput = Join-Path $repoRoot "sources\live-youtube-stable.txt" }
if ([string]::IsNullOrWhiteSpace($MergedOutput)) { $MergedOutput = Join-Path $repoRoot "sources\live-stable.txt" }
if ([string]::IsNullOrWhiteSpace($ReportOutput)) { $ReportOutput = Join-Path $repoRoot "sources\live-youtube-report.json" }

function Get-FullPath([string]$Path) {
    return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

function Get-RepoRelativePath([string]$Path) {
    $fullPath = Get-FullPath $Path
    $rootPath = (Get-FullPath $repoRoot).TrimEnd("\", "/")
    if ($fullPath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        return ($fullPath.Substring($rootPath.Length).TrimStart("\", "/") -replace "\\", "/")
    }
    return ($fullPath -replace "\\", "/")
}

function Find-CommandPath([string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return ""
}

function ConvertTo-ProcessArgument([string]$Argument) {
    if ($null -eq $Argument) { return '""' }
    if ($Argument -notmatch '[\s"]') { return $Argument }
    return '"' + ($Argument -replace '"', '\"') + '"'
}

function Join-ProcessArguments($Arguments) {
    return (($Arguments | ForEach-Object { ConvertTo-ProcessArgument ([string]$_) }) -join " ")
}

function Resolve-YtDlp {
    if (-not [string]::IsNullOrWhiteSpace($YtDlpPath) -and (Test-Path -LiteralPath $YtDlpPath)) {
        return (Get-FullPath $YtDlpPath)
    }
    $fromPath = Find-CommandPath "yt-dlp.exe"
    if ($fromPath) { return $fromPath }
    $fromPath = Find-CommandPath "yt-dlp"
    if ($fromPath) { return $fromPath }

    $toolDir = Join-Path $repoRoot ".tools"
    $localExe = Join-Path $toolDir "yt-dlp.exe"
    if (Test-Path -LiteralPath $localExe) { return $localExe }
    if (-not $DownloadYtDlp) {
        throw "yt-dlp not found. Re-run with -DownloadYtDlp or install yt-dlp first."
    }

    New-Item -ItemType Directory -Force -Path $toolDir | Out-Null
    $downloadUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    Write-Host "Downloading yt-dlp: $downloadUrl"
    Invoke-WebRequest -Uri $downloadUrl -OutFile $localExe
    return $localExe
}

function Resolve-StreamUrl([string]$Url, [string]$YtDlp) {
    if ($SkipResolve) { return $Url }
    $format = "best[protocol^=m3u8][height<=$MaxHeight]/best[protocol^=m3u8][height<=1080]/best[protocol^=m3u8]"
    $args = @(
        "--no-warnings",
        "--no-playlist",
        "--socket-timeout", [string]$SocketTimeoutSec,
        "--force-ipv4",
        "-f", $format,
        "--get-url",
        $Url
    )
    if (-not [string]::IsNullOrWhiteSpace($CookiesFile) -and (Test-Path -LiteralPath $CookiesFile)) {
        $args = @("--cookies", (Get-FullPath $CookiesFile)) + $args
    }
    if (-not [string]::IsNullOrWhiteSpace($CookiesFromBrowser)) {
        $args = @("--cookies-from-browser", $CookiesFromBrowser) + $args
    }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $YtDlp
    $psi.Arguments = Join-ProcessArguments $args
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $psi
    [void]$process.Start()
    if (-not $process.WaitForExit([Math]::Max(5, $ProcessTimeoutSec) * 1000)) {
        try { $process.Kill() } catch { }
        throw "yt-dlp timed out after $ProcessTimeoutSec seconds."
    }
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $output = @(($stdout + "`n" + $stderr) -split "(`r`n|`n)" | Where-Object { $_ -ne "" })
    if ($process.ExitCode -ne 0) {
        throw (($output | Out-String).Trim())
    }
    $urls = @($output | Where-Object { $_ -match '^https?://' })
    if (-not $urls.Count) { throw "yt-dlp returned no playable URL." }
    $hls = @($urls | Where-Object { $_ -match '\.m3u8|manifest/hls|mime=application%2Fx-mpegURL' })
    if ($hls.Count) { return [string]$hls[0] }
    throw "yt-dlp returned URL, but not an HLS stream."
}

function Resolve-StreamUrlWithRetry([string]$Url, [string]$YtDlp) {
    $lastError = $null
    for ($attempt = 1; $attempt -le [Math]::Max(1, $RetryCount); $attempt++) {
        try {
            return (Resolve-StreamUrl $Url $YtDlp)
        } catch {
            $lastError = $_
            if ($attempt -lt [Math]::Max(1, $RetryCount)) {
                Start-Sleep -Seconds ([Math]::Min(5, $attempt * 2))
            }
        }
    }
    throw $lastError
}

function Add-LinesForGroup($Lines, [string]$GroupName, $Rows) {
    if (-not $Rows.Count) { return }
    $Lines.Add("$GroupName,#genre#")
    foreach ($row in $Rows) {
        $name = "{0:D3} {1}" -f ([int]$row.Order), $row.Name
        $Lines.Add("$name,$($row.StreamUrl)")
    }
    $Lines.Add("")
}

function Resolve-ChildUrl([string]$BaseUrl, [string]$Line) {
    if ($Line -match '^https?://') { return $Line }
    return ([Uri]::new([Uri]$BaseUrl, $Line)).AbsoluteUri
}

function Read-UrlText([string]$Url) {
    $request = [Net.HttpWebRequest]::Create($Url)
    $request.Method = "GET"
    $request.UserAgent = "Mozilla/5.0 OKTV-HLS-Validator"
    $request.Accept = "*/*"
    $request.Timeout = [Math]::Max(3, $StreamValidationTimeoutSec) * 1000
    $request.ReadWriteTimeout = [Math]::Max(3, $StreamValidationTimeoutSec) * 1000
    $request.AllowAutoRedirect = $true
    $response = $request.GetResponse()
    try {
        $stream = $response.GetResponseStream()
        $memory = New-Object IO.MemoryStream
        $buffer = New-Object byte[] 65536
        do {
            $read = $stream.Read($buffer, 0, $buffer.Length)
            if ($read -gt 0) { $memory.Write($buffer, 0, $read) }
        } while ($read -gt 0 -and $memory.Length -lt 8388608)
        return [Text.Encoding]::UTF8.GetString($memory.ToArray())
    } finally {
        if ($memory) { $memory.Dispose() }
        if ($stream) { $stream.Dispose() }
        $response.Dispose()
    }
}

function Get-HlsProbeSegmentUrl([string]$Url, [int]$Depth = 0) {
    if ($Depth -gt 2) { throw "HLS playlist recursion too deep." }
    $content = Read-UrlText $Url
    if ($content -notmatch "#EXTM3U") { throw "HLS playlist marker not found." }

    $lines = @($content -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^#EXTINF') {
            for ($j = $i + 1; $j -lt $lines.Count; $j++) {
                if ($lines[$j] -and $lines[$j] -notmatch '^#') {
                    return (Resolve-ChildUrl $Url $lines[$j])
                }
            }
        }
    }

    $variants = New-Object System.Collections.Generic.List[object]
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^#EXT-X-STREAM-INF') {
            $bandwidth = 999999999
            if ($lines[$i] -match 'BANDWIDTH=([0-9]+)') { $bandwidth = [int]$Matches[1] }
            for ($j = $i + 1; $j -lt $lines.Count; $j++) {
                if ($lines[$j] -and $lines[$j] -notmatch '^#') {
                    $variants.Add([pscustomobject]@{ Bandwidth = $bandwidth; Url = Resolve-ChildUrl $Url $lines[$j] })
                    break
                }
            }
        }
    }
    if ($variants.Count) {
        $variant = @($variants | Sort-Object Bandwidth | Select-Object -First 1)[0]
        return (Get-HlsProbeSegmentUrl $variant.Url ($Depth + 1))
    }

    $firstUri = @($lines | Where-Object { $_ -notmatch '^#' } | Select-Object -First 1)
    if ($firstUri.Count) { return (Resolve-ChildUrl $Url $firstUri[0]) }
    throw "No media segment found in HLS playlist."
}

function Test-HlsPlaylist([string]$Url) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        $segmentUrl = Get-HlsProbeSegmentUrl $Url
        $request = [Net.HttpWebRequest]::Create($segmentUrl)
        $request.Method = "GET"
        $request.UserAgent = "Mozilla/5.0 OKTV-HLS-Validator"
        $request.Accept = "*/*"
        $request.Timeout = [Math]::Max(3, $StreamValidationTimeoutSec) * 1000
        $request.ReadWriteTimeout = [Math]::Max(3, $StreamValidationTimeoutSec) * 1000
        $request.AllowAutoRedirect = $true
        try { $request.AddRange(0, [Math]::Max(1024, $SegmentProbeBytes) - 1) } catch {}
        $response = $request.GetResponse()
        try {
            $stream = $response.GetResponseStream()
            $buffer = New-Object byte[] 65536
            $total = 0
            do {
                $read = $stream.Read($buffer, 0, $buffer.Length)
                $total += $read
            } while ($read -gt 0 -and $total -lt $SegmentProbeBytes)
            $sw.Stop()
            $kbps = if ($sw.Elapsed.TotalSeconds -gt 0) { [Math]::Round(($total * 8 / 1000) / $sw.Elapsed.TotalSeconds, 1) } else { 0 }
            $ok = ([int]$response.StatusCode -ge 200 -and [int]$response.StatusCode -lt 400 -and $total -ge $MinSegmentBytes -and $kbps -ge $MinSegmentKbps)
            return [pscustomobject]@{
                Ok = $ok
                Status = [int]$response.StatusCode
                Ms = [int]$sw.ElapsedMilliseconds
                Bytes = $total
                Kbps = $kbps
                SegmentUrl = $segmentUrl
                Error = if ($ok) { "" } else { "Segment probe too slow or incomplete: $total bytes, $kbps kbps." }
            }
        } finally {
            if ($stream) { $stream.Dispose() }
            $response.Dispose()
        }
    } catch {
        $sw.Stop()
        return [pscustomobject]@{
            Ok = $false
            Status = 0
            Ms = [int]$sw.ElapsedMilliseconds
            Bytes = 0
            Kbps = 0
            SegmentUrl = ""
            Error = $_.Exception.Message
        }
    }
}

$ChannelCsv = Get-FullPath $ChannelCsv
$BaseLive = Get-FullPath $BaseLive
$YoutubeOutput = Get-FullPath $YoutubeOutput
$MergedOutput = Get-FullPath $MergedOutput
$ReportOutput = Get-FullPath $ReportOutput

if (-not (Test-Path -LiteralPath $ChannelCsv)) { throw "Channel CSV not found: $ChannelCsv" }
if (-not (Test-Path -LiteralPath $BaseLive)) { throw "Base live source not found: $BaseLive" }

$channels = @(Import-Csv -LiteralPath $ChannelCsv -Encoding UTF8 | Sort-Object @{ Expression = { [int]$_.Order }; Ascending = $true })
if ($MaxChannels -gt 0) { $channels = @($channels | Select-Object -First $MaxChannels) }
$ytDlp = if ($SkipResolve) { "" } else { Resolve-YtDlp }

$resolved = New-Object System.Collections.Generic.List[object]
$failed = New-Object System.Collections.Generic.List[object]
$index = 0
foreach ($channel in $channels) {
    $index += 1
    $name = [string]$channel.Name
    $url = [string]$channel.Url
    Write-Host "[$index/$($channels.Count)] $name"
    try {
        $streamUrl = Resolve-StreamUrlWithRetry $url $ytDlp
        $validation = if ($SkipResolve) {
            [pscustomobject]@{ Ok = $false; Status = 0; Ms = 0; Error = "Skipped resolution." }
        } else {
            Test-HlsPlaylist $streamUrl
        }
        if (-not $validation.Ok) {
            throw "Resolved stream failed HLS validation: $($validation.Error)"
        }
        $resolved.Add([pscustomobject]@{
            Order = [int]$channel.Order
            Group = [string]$channel.Group
            Name = $name
            PageUrl = $url
            StreamUrl = $streamUrl
            Ok = (-not $SkipResolve)
            ValidationMs = $validation.Ms
            ValidationStatus = $validation.Status
            SegmentBytes = $validation.Bytes
            SegmentKbps = $validation.Kbps
        })
    } catch {
        $failed.Add([pscustomobject]@{
            Order = [int]$channel.Order
            Group = [string]$channel.Group
            Name = $name
            PageUrl = $url
            Error = $_.Exception.Message
        })
        if ($IncludeOriginalOnFailure) {
            $resolved.Add([pscustomobject]@{
                Order = [int]$channel.Order
                Group = [string]$channel.Group
                Name = $name
                PageUrl = $url
                StreamUrl = $url
                Ok = $false
            })
        }
    }
}

$playlistResolved = if ($KeepFallbackInPlaylist) {
    @($resolved)
} else {
    @($resolved | Where-Object { $_.Ok })
}

$youtubeLines = New-Object System.Collections.Generic.List[string]
$groupNames = @(
    $channels |
        Sort-Object @{ Expression = { [int]$_.Order }; Ascending = $true } |
        Select-Object -ExpandProperty Group -Unique
)
foreach ($groupName in $groupNames) {
    $rows = @($playlistResolved | Where-Object { $_.Group -eq $groupName } | Sort-Object Order)
    Add-LinesForGroup $youtubeLines $groupName $rows
}
while ($youtubeLines.Count -gt 0 -and $youtubeLines[$youtubeLines.Count - 1] -eq "") {
    $youtubeLines.RemoveAt($youtubeLines.Count - 1)
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $YoutubeOutput) | Out-Null
[System.IO.File]::WriteAllLines($YoutubeOutput, $youtubeLines, [System.Text.UTF8Encoding]::new($false))

$mergedLines = New-Object System.Collections.Generic.List[string]
foreach ($line in $youtubeLines) { $mergedLines.Add($line) }
if ($youtubeLines.Count -and $youtubeLines[$youtubeLines.Count - 1] -ne "") { $mergedLines.Add("") }
$baseLines = [System.IO.File]::ReadAllLines($BaseLive, [System.Text.UTF8Encoding]::new($false))
foreach ($line in $baseLines) { $mergedLines.Add($line) }
[System.IO.File]::WriteAllLines($MergedOutput, $mergedLines, [System.Text.UTF8Encoding]::new($false))

$report = [pscustomobject]@{
    generatedAt = (Get-Date).ToString("o")
    channelCsv = Get-RepoRelativePath $ChannelCsv
    baseLive = Get-RepoRelativePath $BaseLive
    youtubeOutput = Get-RepoRelativePath $YoutubeOutput
    mergedOutput = Get-RepoRelativePath $MergedOutput
    total = $channels.Count
    resolved = $resolved.Count
    playable = if ($SkipResolve) { 0 } else { @($resolved | Where-Object { $_.Ok }).Count }
    fallback = if ($SkipResolve) { $resolved.Count } else { @($resolved | Where-Object { -not $_.Ok }).Count }
    failed = $failed.Count
    workflowSuccessRate = if ($channels.Count) { [Math]::Round(($resolved.Count / $channels.Count) * 100, 2) } else { 0 }
    hlsSuccessRate = if ($channels.Count -and -not $SkipResolve) { [Math]::Round((@($resolved | Where-Object { $_.Ok }).Count / $channels.Count) * 100, 2) } else { 0 }
    playlistEntries = $playlistResolved.Count
    removedFromPlaylist = if ($KeepFallbackInPlaylist) { 0 } else { @($resolved | Where-Object { -not $_.Ok }).Count }
    playlistPolicy = if ($KeepFallbackInPlaylist) { "include-fallback" } else { "playable-only" }
    mode = if ($SkipResolve) { "no-cookies-fallback" } elseif (-not [string]::IsNullOrWhiteSpace($CookiesFile) -and (Test-Path -LiteralPath $CookiesFile)) { "cookies-file-hls-resolve" } elseif (-not [string]::IsNullOrWhiteSpace($CookiesFromBrowser)) { "browser-cookies-hls-resolve" } else { "best-effort-hls-resolve" }
    note = if ($SkipResolve) { "GitHub runner has no YouTube cookies, so unresolved YouTube watch URLs are removed from the playable playlist. Add YOUTUBE_COOKIES_B64 to resolve HLS URLs." } else { "" }
    skipResolve = [bool]$SkipResolve
    includeOriginalOnFailure = [bool]$IncludeOriginalOnFailure
    maxHeight = $MaxHeight
    processTimeoutSec = $ProcessTimeoutSec
    streamValidationTimeoutSec = $StreamValidationTimeoutSec
    segmentProbeBytes = $SegmentProbeBytes
    minSegmentBytes = $MinSegmentBytes
    minSegmentKbps = $MinSegmentKbps
    retryCount = $RetryCount
    ytDlp = $ytDlp
    cookiesEnabled = ((-not [string]::IsNullOrWhiteSpace($CookiesFile) -and (Test-Path -LiteralPath $CookiesFile)) -or (-not [string]::IsNullOrWhiteSpace($CookiesFromBrowser)))
    cookiesFromBrowser = $CookiesFromBrowser
    groups = ($resolved | Group-Object Group | Sort-Object Name | ForEach-Object { [pscustomobject]@{ name = $_.Name; count = $_.Count } })
    failures = $failed
}
[System.IO.File]::WriteAllText($ReportOutput, ($report | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))

Write-Host "YouTube output: $YoutubeOutput"
Write-Host "Merged output: $MergedOutput"
Write-Host "Resolved: $($resolved.Count) / $($channels.Count)"
if ($failed.Count) { Write-Host "Failed: $($failed.Count). See $ReportOutput" }
