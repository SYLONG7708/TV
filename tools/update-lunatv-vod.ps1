param(
    [string]$SourceName = "jin18",
    [string]$SourceUrl = "",
    [string]$Output = "",
    [string]$ReportOutput = "",
    [int]$TimeoutSec = 12,
    [int]$MaxDetailProbe = 3,
    [switch]$SkipValidation,
    [switch]$KeepFailed
)

$ErrorActionPreference = "Stop"

try {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12 -bor [System.Net.SecurityProtocolType]::Tls11 -bor [System.Net.SecurityProtocolType]::Tls
} catch {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($SourceUrl)) {
    $SourceUrl = "https://pz.v88.qzz.io?format=0&source=$SourceName"
}
if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = Join-Path $repoRoot "sources\vod-lunatv-$SourceName-oktv.json"
}
if ([string]::IsNullOrWhiteSpace($ReportOutput)) {
    $ReportOutput = Join-Path $repoRoot "sources\vod-lunatv-$SourceName-report.json"
}

function Get-Utf8Text {
    param([Parameter(Mandatory = $true)][string]$Url)

    $request = [System.Net.WebRequest]::Create($Url)
    $request.Method = "GET"
    $request.Timeout = $TimeoutSec * 1000
    $request.ReadWriteTimeout = $TimeoutSec * 1000
    $request.UserAgent = "OKTV-LunaTV-VOD-Updater"
    $request.Accept = "application/json,text/plain,*/*"

    $response = $request.GetResponse()
    try {
        $stream = $response.GetResponseStream()
        $memory = New-Object System.IO.MemoryStream
        $stream.CopyTo($memory)
        return [System.Text.Encoding]::UTF8.GetString($memory.ToArray())
    } finally {
        if ($stream) { $stream.Dispose() }
        $response.Dispose()
    }
}

function Add-VodQuery {
    param(
        [Parameter(Mandatory = $true)][string]$Api,
        [Parameter(Mandatory = $true)][string]$Query
    )

    $trimmed = $Api.Trim()
    if ($trimmed.EndsWith("?") -or $trimmed.EndsWith("&")) {
        return "$trimmed$Query"
    }

    # OKTV/FongMi CMS endpoints normally append ?ac=... to the configured API.
    # Keeping this convention also makes LunaTV proxy URLs usable.
    return "$trimmed`?$Query"
}

function New-SafeKey {
    param(
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][int]$Index
    )

    $safe = $Key.ToLowerInvariant() -replace "[^a-z0-9]+", "_"
    $safe = $safe.Trim("_")
    if ([string]::IsNullOrWhiteSpace($safe)) { $safe = "source_$Index" }
    return ("lunatv_{0:000}_{1}" -f $Index, $safe)
}

function Clean-SourceName {
    param([Parameter(Mandatory = $true)][string]$Name)

    $clean = $Name -replace "^[^\p{L}\p{N}]+", ""
    $clean = $clean -replace "^\s*-\s*", ""
    $clean = $clean.Trim()
    if ([string]::IsNullOrWhiteSpace($clean)) { return "LunaTV" }
    return $clean
}

function Test-LunaApi {
    param([Parameter(Mandatory = $true)][string]$Api)

    $result = [ordered]@{
        listOk = $false
        detailOk = $false
        hasPlayUrl = $false
        sampleVodName = ""
        sampleVodId = ""
        error = ""
    }

    try {
        $listUrl = Add-VodQuery -Api $Api -Query "ac=list"
        $listJson = Get-Utf8Text -Url $listUrl | ConvertFrom-Json
        $items = @($listJson.list)
        if ($items.Count -eq 0) {
            throw "ac=list returned no items"
        }

        $result.listOk = $true
        $probeItems = @($items | Select-Object -First $MaxDetailProbe)
        foreach ($item in $probeItems) {
            $vodId = [string]$item.vod_id
            if ([string]::IsNullOrWhiteSpace($vodId)) { continue }

            $detailUrl = Add-VodQuery -Api $Api -Query ("ac=detail&ids=" + [System.Uri]::EscapeDataString($vodId))
            $detailJson = Get-Utf8Text -Url $detailUrl | ConvertFrom-Json
            $detailItems = @($detailJson.list)
            if ($detailItems.Count -eq 0) { continue }

            $detail = $detailItems[0]
            $playUrl = [string]$detail.vod_play_url
            if ([string]::IsNullOrWhiteSpace($playUrl)) {
                $playUrl = [string]$item.vod_play_url
            }
            $result.detailOk = $true
            $result.sampleVodId = $vodId
            $result.sampleVodName = [string]$detail.vod_name
            if (-not [string]::IsNullOrWhiteSpace($playUrl)) {
                $result.hasPlayUrl = $true
                break
            }
        }

        if (-not $result.hasPlayUrl) {
            $keyword = "%E5%93%88"
            $searchUrl = Add-VodQuery -Api $Api -Query "ac=detail&wd=$keyword"
            $searchJson = Get-Utf8Text -Url $searchUrl | ConvertFrom-Json
            $searchItems = @($searchJson.list)
            foreach ($item in @($searchItems | Select-Object -First $MaxDetailProbe)) {
                $playUrl = [string]$item.vod_play_url
                if (-not [string]::IsNullOrWhiteSpace($playUrl)) {
                    $result.detailOk = $true
                    $result.hasPlayUrl = $true
                    $result.sampleVodId = [string]$item.vod_id
                    $result.sampleVodName = [string]$item.vod_name
                    break
                }
            }
        }

        if (-not $result.hasPlayUrl) {
            $result.error = "No vod_play_url found in detail/search probe"
        }
    } catch {
        $result.error = $_.Exception.Message
    }

    return [pscustomobject]$result
}

Write-Host "Downloading LunaTV config: $SourceUrl"
$sourceJson = Get-Utf8Text -Url $SourceUrl | ConvertFrom-Json
if (-not $sourceJson.api_site) {
    throw "LunaTV config does not contain api_site."
}

$sourceEntries = @($sourceJson.api_site.PSObject.Properties)
$sites = New-Object System.Collections.Generic.List[object]
$checks = New-Object System.Collections.Generic.List[object]
$index = 0

foreach ($entryProp in $sourceEntries) {
    $entry = $entryProp.Value
    $api = [string]$entry.api
    if ([string]::IsNullOrWhiteSpace($api)) { continue }

    $index++
    $name = Clean-SourceName -Name ([string]$entry.name)
    $site = [ordered]@{
        key = New-SafeKey -Key $entryProp.Name -Index $index
        name = ("Luna {0:00} {1}" -f $index, $name)
        type = if ($api -match "(?i)xml|/at/xml") { 0 } else { 1 }
        api = $api.Trim()
        searchable = 1
        quickSearch = 1
        filterable = 1
    }

    if ($SkipValidation) {
        $check = [pscustomobject]([ordered]@{
            key = $site.key
            name = $site.name
            api = $site.api
            included = $true
            listOk = $null
            detailOk = $null
            hasPlayUrl = $null
            sampleVodName = ""
            sampleVodId = ""
            error = "Validation skipped"
        })
        $sites.Add([pscustomobject]$site)
        $checks.Add($check)
        continue
    }

    Write-Host ("Checking {0}: {1}" -f $site.name, $site.api)
    $probe = Test-LunaApi -Api $site.api
    $include = [bool]$probe.hasPlayUrl -or $KeepFailed.IsPresent
    if ($include) {
        $sites.Add([pscustomobject]$site)
    }

    $check = [pscustomobject]([ordered]@{
        key = $site.key
        name = $site.name
        api = $site.api
        included = $include
        listOk = $probe.listOk
        detailOk = $probe.detailOk
        hasPlayUrl = $probe.hasPlayUrl
        sampleVodName = $probe.sampleVodName
        sampleVodId = $probe.sampleVodId
        error = $probe.error
    })
    $checks.Add($check)
}

$siteArray = @($sites.ToArray())
$checkArray = @($checks.ToArray())

$vodConfig = [ordered]@{
    spider = ""
    logo = "https://raw.githubusercontent.com/SYLONG7708/TV/main/branding/icon-tech-20260528.png"
    wallpaper = "http://tool.teyonds.com/api"
    warningText = "LunaTV candidate VOD source converted for OKTV. This file is not the built-in APK default; replace manually only for testing."
    sites = $siteArray
}

$report = [ordered]@{
    generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")
    sourceName = $SourceName
    sourceUrl = $SourceUrl
    upstreamCacheSeconds = $sourceJson.cache_time
    output = ($Output -replace "\\", "/")
    totalSources = $sourceEntries.Count
    includedSources = $sites.Count
    failedSources = ($sourceEntries.Count - $sites.Count)
    validationSkipped = [bool]$SkipValidation
    checks = $checkArray
}

$outputDir = Split-Path -Parent $Output
$reportDir = Split-Path -Parent $ReportOutput
if (-not (Test-Path -LiteralPath $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }
if (-not (Test-Path -LiteralPath $reportDir)) { New-Item -ItemType Directory -Path $reportDir -Force | Out-Null }

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($Output, ($vodConfig | ConvertTo-Json -Depth 8), $utf8NoBom)
[System.IO.File]::WriteAllText($ReportOutput, ($report | ConvertTo-Json -Depth 8), $utf8NoBom)

Write-Host ("Wrote OKTV VOD candidate: {0}" -f $Output)
Write-Host ("Wrote validation report: {0}" -f $ReportOutput)
Write-Host ("Included sources: {0} / {1}" -f $sites.Count, $sourceEntries.Count)
