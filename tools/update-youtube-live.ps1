param(
    [string]$ChannelCsv = "",
    [string]$BaseLive = "",
    [string]$YoutubeOutput = "",
    [string]$MergedOutput = "",
    [string]$ReportOutput = "",
    [string]$YtDlpPath = "",
    [int]$MaxChannels = 0,
    [int]$MaxHeight = 720,
    [int]$SocketTimeoutSec = 15,
    [int]$RetryCount = 2,
    [switch]$DownloadYtDlp,
    [switch]$SkipResolve,
    [switch]$IncludeOriginalOnFailure
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if ([string]::IsNullOrWhiteSpace($ChannelCsv)) { $ChannelCsv = Join-Path $repoRoot "sources\youtube-live-channels.csv" }
if ([string]::IsNullOrWhiteSpace($BaseLive)) { $BaseLive = Join-Path $repoRoot "sources\live-base.txt" }
if ([string]::IsNullOrWhiteSpace($YoutubeOutput)) { $YoutubeOutput = Join-Path $repoRoot "sources\live-youtube-stable.txt" }
if ([string]::IsNullOrWhiteSpace($MergedOutput)) { $MergedOutput = Join-Path $repoRoot "sources\live-stable.txt" }
if ([string]::IsNullOrWhiteSpace($ReportOutput)) { $ReportOutput = Join-Path $repoRoot "sources\live-youtube-report.json" }

function Get-FullPath([string]$Path) {
    return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

function Find-CommandPath([string]$Name) {
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    return ""
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
    $format = "best[protocol^=m3u8][height<=$MaxHeight]/best[height<=$MaxHeight]/best[protocol^=m3u8][height<=1080]/best[height<=1080]/best"
    $args = @(
        "--no-warnings",
        "--no-playlist",
        "--socket-timeout", [string]$SocketTimeoutSec,
        "--force-ipv4",
        "-f", $format,
        "--get-url",
        $Url
    )
    $output = & $YtDlp @args 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw (($output | Out-String).Trim())
    }
    $urls = @($output | Where-Object { $_ -match '^https?://' })
    if (-not $urls.Count) { throw "yt-dlp returned no playable URL." }
    $hls = @($urls | Where-Object { $_ -match '\.m3u8|manifest/hls|mime=application%2Fx-mpegURL' })
    if ($hls.Count) { return [string]$hls[0] }
    return [string]$urls[0]
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
        $resolved.Add([pscustomobject]@{
            Order = [int]$channel.Order
            Group = [string]$channel.Group
            Name = $name
            PageUrl = $url
            StreamUrl = $streamUrl
            Ok = $true
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

$youtubeLines = New-Object System.Collections.Generic.List[string]
$groupNames = @(
    $channels |
        Sort-Object @{ Expression = { [int]$_.Order }; Ascending = $true } |
        Select-Object -ExpandProperty Group -Unique
)
foreach ($groupName in $groupNames) {
    $rows = @($resolved | Where-Object { $_.Group -eq $groupName } | Sort-Object Order)
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
    channelCsv = "sources/youtube-live-channels.csv"
    baseLive = "sources/live-base.txt"
    youtubeOutput = "sources/live-youtube-stable.txt"
    mergedOutput = "sources/live-stable.txt"
    total = $channels.Count
    resolved = $resolved.Count
    playable = @($resolved | Where-Object { $_.Ok }).Count
    fallback = @($resolved | Where-Object { -not $_.Ok }).Count
    failed = $failed.Count
    skipResolve = [bool]$SkipResolve
    includeOriginalOnFailure = [bool]$IncludeOriginalOnFailure
    maxHeight = $MaxHeight
    retryCount = $RetryCount
    ytDlp = $ytDlp
    groups = ($resolved | Group-Object Group | Sort-Object Name | ForEach-Object { [pscustomobject]@{ name = $_.Name; count = $_.Count } })
    failures = $failed
}
[System.IO.File]::WriteAllText($ReportOutput, ($report | ConvertTo-Json -Depth 6), [System.Text.UTF8Encoding]::new($false))

Write-Host "YouTube output: $YoutubeOutput"
Write-Host "Merged output: $MergedOutput"
Write-Host "Resolved: $($resolved.Count) / $($channels.Count)"
if ($failed.Count) { Write-Host "Failed: $($failed.Count). See $ReportOutput" }
