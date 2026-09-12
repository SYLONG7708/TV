param(
    [string]$SourceUrl = "https://raw.githubusercontent.com/FGBLH/GHK/refs/heads/main/%E5%AE%89%E5%8D%9A.txt",
    [string]$Output = "",
    [string]$BackupOutput = "",
    [string]$VerifiedOnlyOutput = "",
    [string]$ReportOutput = "",
    [int]$TimeoutSec = 8,
    [int]$MaxParallel = 24,
    [int]$Retries = 2,
    [int]$SegmentProbeBytes = 262144,
    [int]$MinSegmentBytes = 65536,
    [int]$MinSegmentKbps = 600,
    [string]$PrivateGroupPassword = "7708",
    [switch]$SkipNetworkTest
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-FullPath([string]$Path) {
    return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

function Normalize-Name([string]$Name) {
    $n = $Name.Trim()
    $n = $n -replace '\s+', ''
    $n = $n -replace 'HD$|FHD$|1080P$|720P$', ''
    return $n
}

function Get-UrlScore([string]$Url) {
    $score = 0
    if ($Url -match '^https://') { $score += 30 }
    if ($Url -match '\.m3u8(\?|$)') { $score += 25 }
    if ($Url -match 'z[0-9]+\.ubtvfans\.com') { $score += 15 }
    if ($Url -match '/live/') { $score += 10 }
    if ($Url -match 'udp://|rtmp://') { $score -= 20 }
    return $score
}

function Protect-GroupName([string]$Name, [string]$Password) {
    if ([string]::IsNullOrWhiteSpace($Password)) { return $Name }
    $privateGroupName = [string]([char]0x79c1) + [string]([char]0x5bc6) + [string]([char]0x983b) + [string]([char]0x9053)
    if ($Name -eq $privateGroupName) { return "$Name`_$Password" }
    return $Name
}

function Remove-TrailingBlankLines([System.Collections.Generic.List[string]]$Lines) {
    while (($Lines.Count -gt 0) -and ([string]::IsNullOrWhiteSpace($Lines[$Lines.Count - 1]))) {
        $Lines.RemoveAt($Lines.Count - 1)
    }
}

function Resolve-ChildUrl([string]$BaseUrl, [string]$Line) {
    if ($Line -match '^https?://') { return $Line }
    return ([Uri]::new([Uri]$BaseUrl, $Line)).AbsoluteUri
}

function Read-UrlText([string]$Url, [int]$TimeoutSec) {
    $request = [Net.HttpWebRequest]::Create($Url)
    $request.Method = "GET"
    $request.UserAgent = "Mozilla/5.0 OKTV-Stability-Checker"
    $request.Accept = "*/*"
    $request.Timeout = $TimeoutSec * 1000
    $request.ReadWriteTimeout = $TimeoutSec * 1000
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

function Get-HlsProbeSegmentUrl([string]$Url, [int]$TimeoutSec, [int]$Depth = 0) {
    if ($Depth -gt 2) { throw "HLS playlist recursion too deep." }
    $content = Read-UrlText $Url $TimeoutSec
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
        return (Get-HlsProbeSegmentUrl $variant.Url $TimeoutSec ($Depth + 1))
    }

    $firstUri = @($lines | Where-Object { $_ -notmatch '^#' } | Select-Object -First 1)
    if ($firstUri.Count) { return (Resolve-ChildUrl $Url $firstUri[0]) }
    throw "No media segment found in HLS playlist."
}

function Test-Stream([string]$Url, [int]$TimeoutSec) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        $probeUrl = if ($Url -match '\.m3u8(\?|$)|manifest/hls|mime=application%2Fx-mpegURL') { Get-HlsProbeSegmentUrl $Url $TimeoutSec } else { $Url }
        $request = [Net.HttpWebRequest]::Create($probeUrl)
        $request.Method = "GET"
        $request.UserAgent = "Mozilla/5.0 OKTV-Stability-Checker"
        $request.Timeout = $TimeoutSec * 1000
        $request.ReadWriteTimeout = $TimeoutSec * 1000
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
            $stream.Dispose()
        } finally {
            $response.Dispose()
        }
        $sw.Stop()
        $kbps = if ($sw.Elapsed.TotalSeconds -gt 0) { [Math]::Round(($total * 8 / 1000) / $sw.Elapsed.TotalSeconds, 1) } else { 0 }
        if ($total -lt $MinSegmentBytes -or $kbps -lt $MinSegmentKbps) {
            throw "Segment probe too slow or incomplete: $total bytes, $kbps kbps."
        }
        return [pscustomobject]@{
            Ok = $true
            Ms = [int]$sw.ElapsedMilliseconds
            SegmentBytes = $total
            SegmentKbps = $kbps
            Error = ""
        }
    } catch {
        $sw.Stop()
        return [pscustomobject]@{
            Ok = $false
            Ms = [int]$sw.ElapsedMilliseconds
            SegmentBytes = 0
            SegmentKbps = 0
            Error = $_.Exception.Message
        }
    }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
if ([string]::IsNullOrWhiteSpace($Output)) { $Output = Join-Path $repoRoot "sources\live-stable.txt" }
if ([string]::IsNullOrWhiteSpace($BackupOutput)) { $BackupOutput = Join-Path $repoRoot "sources\live-cleaned-backup.txt" }
if ([string]::IsNullOrWhiteSpace($VerifiedOnlyOutput)) { $VerifiedOnlyOutput = Join-Path $repoRoot "sources\live-verified-only.txt" }
if ([string]::IsNullOrWhiteSpace($ReportOutput)) { $ReportOutput = Join-Path $repoRoot "sources\live-stability-report.json" }

$Output = Get-FullPath $Output
$BackupOutput = Get-FullPath $BackupOutput
$VerifiedOnlyOutput = Get-FullPath $VerifiedOnlyOutput
$ReportOutput = Get-FullPath $ReportOutput
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null

$rawPath = Join-Path (Split-Path -Parent $Output) "upstream-anbo.txt"
Write-Host "Downloading source: $SourceUrl"
Invoke-WebRequest -Uri $SourceUrl -OutFile $rawPath -UseBasicParsing

$lines = Get-Content -LiteralPath $rawPath -Encoding UTF8
$items = New-Object System.Collections.Generic.List[object]
$currentGroup = "Ungrouped"
$order = 0
$seenPairs = @{}
$seenUrls = @{}

foreach ($line in $lines) {
    $trim = $line.Trim()
    if ($trim.Length -eq 0) { continue }
    if ($trim -match ',#genre#$') {
        $currentGroup = ($trim -replace ',#genre#$', '').Trim()
        continue
    }
    $idx = $trim.IndexOf(',')
    if ($idx -le 0) { continue }
    $name = $trim.Substring(0, $idx).Trim()
    $url = $trim.Substring($idx + 1).Trim()
    if ($url -notmatch '^(https?|rtmp|rtsp|udp)://') { continue }
    $pairKey = "$name|$url"
    if ($seenPairs.ContainsKey($pairKey)) { continue }
    $seenPairs[$pairKey] = $true
    $seenUrls[$url] = $true
    $items.Add([pscustomobject]@{
        Group = $currentGroup
        Name = $name
        StableName = Normalize-Name $name
        Url = $url
        Order = $order
        StaticScore = Get-UrlScore $url
        Ok = $false
        Ms = 999999
        SegmentBytes = 0
        SegmentKbps = 0
        Error = ""
    })
    $order++
}

Write-Host "Parsed $($items.Count) unique lines and $($seenUrls.Count) unique URLs."

if (-not $SkipNetworkTest) {
    Write-Host "Testing streams with timeout ${TimeoutSec}s, retries $Retries and max parallel $MaxParallel."
    $pool = [runspacefactory]::CreateRunspacePool(1, $MaxParallel)
    $pool.Open()
    $jobs = New-Object System.Collections.Generic.List[object]
    $scriptBlock = {
        param($Url, $TimeoutSec, $Retries, $SegmentProbeBytes, $MinSegmentBytes, $MinSegmentKbps)
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        function Resolve-ChildUrl([string]$BaseUrl, [string]$Line) {
            if ($Line -match '^https?://') { return $Line }
            return ([Uri]::new([Uri]$BaseUrl, $Line)).AbsoluteUri
        }
        function Read-UrlText([string]$Url, [int]$TimeoutSec) {
            $request = [Net.HttpWebRequest]::Create($Url)
            $request.Method = "GET"
            $request.UserAgent = "Mozilla/5.0 OKTV-Stability-Checker"
            $request.Accept = "*/*"
            $request.Timeout = $TimeoutSec * 1000
            $request.ReadWriteTimeout = $TimeoutSec * 1000
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
        function Get-HlsProbeSegmentUrl([string]$Url, [int]$TimeoutSec, [int]$Depth = 0) {
            if ($Depth -gt 2) { throw "HLS playlist recursion too deep." }
            $content = Read-UrlText $Url $TimeoutSec
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
                return (Get-HlsProbeSegmentUrl $variant.Url $TimeoutSec ($Depth + 1))
            }
            $firstUri = @($lines | Where-Object { $_ -notmatch '^#' } | Select-Object -First 1)
            if ($firstUri.Count) { return (Resolve-ChildUrl $Url $firstUri[0]) }
            throw "No media segment found in HLS playlist."
        }
        $attempts = [Math]::Max(1, $Retries)
        $best = $null
        $last = $null
        for ($attempt = 1; $attempt -le $attempts; $attempt++) {
            $sw = [Diagnostics.Stopwatch]::StartNew()
            try {
                $probeUrl = if ($Url -match '\.m3u8(\?|$)|manifest/hls|mime=application%2Fx-mpegURL') { Get-HlsProbeSegmentUrl $Url $TimeoutSec } else { $Url }
                $request = [Net.HttpWebRequest]::Create($probeUrl)
                $request.Method = "GET"
                $request.UserAgent = "Mozilla/5.0 OKTV-Stability-Checker"
                $request.Timeout = $TimeoutSec * 1000
                $request.ReadWriteTimeout = $TimeoutSec * 1000
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
                    $stream.Dispose()
                } finally {
                    $response.Dispose()
                }
                $sw.Stop()
                $kbps = if ($sw.Elapsed.TotalSeconds -gt 0) { [Math]::Round(($total * 8 / 1000) / $sw.Elapsed.TotalSeconds, 1) } else { 0 }
                if ($total -lt $MinSegmentBytes -or $kbps -lt $MinSegmentKbps) {
                    throw "Segment probe too slow or incomplete: $total bytes, $kbps kbps."
                }
                $current = [pscustomobject]@{ Ok = $true; Ms = [int]$sw.ElapsedMilliseconds; SegmentBytes = $total; SegmentKbps = $kbps; Error = "" }
                if (($null -eq $best) -or ($current.SegmentKbps -gt $best.SegmentKbps)) { $best = $current }
            } catch {
                $sw.Stop()
                $last = [pscustomobject]@{ Ok = $false; Ms = [int]$sw.ElapsedMilliseconds; SegmentBytes = 0; SegmentKbps = 0; Error = $_.Exception.Message }
            }
            if ($attempt -lt $attempts) { Start-Sleep -Milliseconds 150 }
        }
        if ($null -ne $best) {
            $best
        } elseif ($null -ne $last) {
            $last
        } else {
            [pscustomobject]@{ Ok = $false; Ms = 0; SegmentBytes = 0; SegmentKbps = 0; Error = "No test result" }
        }
    }

    for ($i = 0; $i -lt $items.Count; $i++) {
        $ps = [powershell]::Create()
        $ps.RunspacePool = $pool
        [void]$ps.AddScript($scriptBlock).AddArgument($items[$i].Url).AddArgument($TimeoutSec).AddArgument($Retries).AddArgument($SegmentProbeBytes).AddArgument($MinSegmentBytes).AddArgument($MinSegmentKbps)
        $jobs.Add([pscustomobject]@{ Index = $i; Ps = $ps; Handle = $ps.BeginInvoke() })
    }

    foreach ($job in $jobs) {
        $result = $job.Ps.EndInvoke($job.Handle)
        $job.Ps.Dispose()
        if ($result.Count -gt 0) {
            $items[$job.Index].Ok = [bool]$result[0].Ok
            $items[$job.Index].Ms = [int]$result[0].Ms
            $items[$job.Index].SegmentBytes = [int]$result[0].SegmentBytes
            $items[$job.Index].SegmentKbps = [double]$result[0].SegmentKbps
            $items[$job.Index].Error = [string]$result[0].Error
        }
    }
    $pool.Close()
    $pool.Dispose()
}

$verified = @($items | Where-Object { $_.Ok -or $SkipNetworkTest })
$usable = @($items.ToArray())
if ($verified.Count -eq 0) {
    Write-Host "No URL passed network test, using static ranking only."
}

$groupOrder = @{}
$idx = 0
foreach ($item in $items) {
    if (-not $groupOrder.ContainsKey($item.Group)) {
        $groupOrder[$item.Group] = $idx
        $idx++
    }
}

$stableLines = New-Object System.Collections.Generic.List[string]
$backupLines = New-Object System.Collections.Generic.List[string]
$verifiedLines = New-Object System.Collections.Generic.List[string]

if ($verified.Count -gt 0) {
    $verifiedFirst = @($verified | Sort-Object `
        @{ Expression = { -1 * $_.SegmentKbps }; Ascending = $true },
        @{ Expression = { $_.Ms }; Ascending = $true },
        @{ Expression = { -1 * $_.StaticScore }; Ascending = $true },
        @{ Expression = { $_.Order }; Ascending = $true })
    if ($verifiedFirst.Count -gt 0) {
        $stableLines.Add("Verified Fastest,#genre#")
        foreach ($entry in $verifiedFirst) {
            $stableLines.Add("$($entry.Name),$($entry.Url)")
        }
        $stableLines.Add("")
    }
}

$groups = $usable | Group-Object Group | Sort-Object { $groupOrder[$_.Name] }

foreach ($group in $groups) {
    $protectedGroupName = Protect-GroupName $group.Name $PrivateGroupPassword
    $stableLines.Add("$protectedGroupName,#genre#")
    $backupLines.Add("$protectedGroupName,#genre#")
    $channels = $group.Group | Group-Object StableName | Sort-Object { ($_.Group | Measure-Object Order -Minimum).Minimum }
    foreach ($channel in $channels) {
        $ranked = @($channel.Group | Sort-Object `
            @{ Expression = { if ($_.Ok) { 0 } else { 1 } }; Ascending = $true },
            @{ Expression = { -1 * $_.SegmentKbps }; Ascending = $true },
            @{ Expression = { $_.Ms }; Ascending = $true },
            @{ Expression = { -1 * $_.StaticScore }; Ascending = $true },
            @{ Expression = { $_.Order }; Ascending = $true })
        foreach ($entry in $ranked) {
            $stableLines.Add("$($entry.Name),$($entry.Url)")
            $backupLines.Add("$($entry.Name),$($entry.Url)")
        }
    }
    $stableLines.Add("")
    $backupLines.Add("")
}

$verifiedGroups = $verified | Group-Object Group | Sort-Object { $groupOrder[$_.Name] }
foreach ($group in $verifiedGroups) {
    $protectedGroupName = Protect-GroupName $group.Name $PrivateGroupPassword
    $verifiedLines.Add("$protectedGroupName,#genre#")
    $channels = $group.Group | Group-Object StableName | Sort-Object { ($_.Group | Measure-Object Order -Minimum).Minimum }
    foreach ($channel in $channels) {
        $ranked = @($channel.Group | Sort-Object `
            @{ Expression = { -1 * $_.SegmentKbps }; Ascending = $true },
            @{ Expression = { $_.Ms }; Ascending = $true },
            @{ Expression = { -1 * $_.StaticScore }; Ascending = $true },
            @{ Expression = { $_.Order }; Ascending = $true })
        foreach ($entry in $ranked) {
            $verifiedLines.Add("$($entry.Name),$($entry.Url)")
        }
    }
    $verifiedLines.Add("")
}

Remove-TrailingBlankLines $stableLines
Remove-TrailingBlankLines $backupLines
Remove-TrailingBlankLines $verifiedLines

[System.IO.File]::WriteAllLines($Output, $verifiedLines, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllLines($BackupOutput, $backupLines, [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllLines($VerifiedOnlyOutput, $verifiedLines, [System.Text.UTF8Encoding]::new($false))

$report = [pscustomobject]@{
    generatedAt = (Get-Date).ToString("s")
    sourceUrl = $SourceUrl
    inputLines = $lines.Count
    uniqueChannelUrls = $items.Count
    uniqueUrls = $seenUrls.Count
    stableLines = $verified.Count
    priorityVerifiedLines = $verified.Count
    stableOutputStreamLines = @($verifiedLines | Where-Object { $_ -match '^[^,]+,https?://' }).Count
    backupOutputStreamLines = @($backupLines | Where-Object { $_ -match '^[^,]+,https?://' }).Count
    verifiedLines = $verified.Count
    failedShortTestLines = ($items.Count - $verified.Count)
    timeoutSec = $TimeoutSec
    maxParallel = $MaxParallel
    retries = $Retries
    segmentProbeBytes = $SegmentProbeBytes
    minSegmentBytes = $MinSegmentBytes
    minSegmentKbps = $MinSegmentKbps
    privateGroupPassword = $PrivateGroupPassword
    skipNetworkTest = [bool]$SkipNetworkTest
    outputs = @{
        stable = "sources/live-stable.txt"
        backup = "sources/live-cleaned-backup.txt"
        verifiedOnly = "sources/live-verified-only.txt"
    }
    fastest = @($verified | Sort-Object @{ Expression = { -1 * $_.SegmentKbps }; Ascending = $true }, Ms | Select-Object -First 30 Group,Name,Url,Ok,Ms,SegmentBytes,SegmentKbps,StaticScore)
    failedSample = @($items | Where-Object { -not $_.Ok } | Select-Object -First 30 Group,Name,Url,Ms,SegmentBytes,SegmentKbps,Error)
}
$json = $report | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($ReportOutput, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "Stable output: $Output"
Write-Host "Backup output: $BackupOutput"
Write-Host "Verified-only output: $VerifiedOnlyOutput"
Write-Host "Report output: $ReportOutput"
Write-Host "Stable lines: $($verified.Count) / $($items.Count)"
Write-Host "Verified short-test lines: $($verified.Count) / $($items.Count)"
