param(
    [string]$SourceName = "jin18",
    [string]$SourceUrl = "",
    [string]$CompareVodUrl = "",
    [string]$CompareVodPath = "",
    [string]$Output = "",
    [string]$ReportOutput = "",
    [string]$AnalysisOutput = "",
    [int]$TimeoutSec = 12,
    [int]$MaxDetailProbe = 3,
    [string]$SearchKeyword = "test",
    [switch]$SkipValidation,
    [switch]$SkipDuplicateCheck,
    [switch]$RedactSampleNames,
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
    if ($SourceName -eq "full") {
        $SourceUrl = "https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/LunaTV-config.json"
    } else {
        $SourceUrl = "https://raw.githubusercontent.com/hafrey1/LunaTV-config/refs/heads/main/$SourceName.json"
    }
}
if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = Join-Path $repoRoot "sources\vod-lunatv-$SourceName-oktv.json"
}
if ([string]::IsNullOrWhiteSpace($ReportOutput)) {
    $ReportOutput = Join-Path $repoRoot "sources\vod-lunatv-$SourceName-report.json"
}
if ([string]::IsNullOrWhiteSpace($AnalysisOutput)) {
    $AnalysisOutput = Join-Path $repoRoot "sources\vod-lunatv-$SourceName-analysis.csv"
}

$sourceConfigPath = Join-Path $repoRoot "sources\current-sources.json"
if (([string]::IsNullOrWhiteSpace($CompareVodUrl) -and [string]::IsNullOrWhiteSpace($CompareVodPath)) -and (Test-Path -LiteralPath $sourceConfigPath)) {
    $currentConfig = Get-Content -LiteralPath $sourceConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($currentConfig.vod.compareUrl) {
        $CompareVodUrl = [string]$currentConfig.vod.compareUrl
    } elseif ($currentConfig.vod.url -and ([string]$currentConfig.vod.url) -notmatch "vod-lunatv-.+-oktv\.json") {
        $CompareVodUrl = [string]$currentConfig.vod.url
    }
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

function Normalize-SourceName {
    param([string]$Value)

    $normalized = [string]$Value
    $normalized = $normalized -replace "[\p{So}\p{Sk}\p{Cn}]+", ""
    $normalized = $normalized -replace "(?i)luna\s*\d+", ""
    $normalized = $normalized -replace "[\s\-_|\.,:;()\[\]{}]+", ""
    return $normalized.Trim().ToLowerInvariant()
}

function Unwrap-ProxyUrl {
    param([string]$Url)

    $value = [string]$Url
    if ([string]::IsNullOrWhiteSpace($value)) { return "" }
    $value = $value.Trim()
    if ($value -match "[?&]url=([^&]+)") {
        try {
            return [System.Uri]::UnescapeDataString($matches[1])
        } catch {
            return $matches[1]
        }
    }
    return $value
}

function Normalize-ApiUrl {
    param([string]$Url)

    $value = Unwrap-ProxyUrl -Url $Url
    if ([string]::IsNullOrWhiteSpace($value)) { return "" }
    $value = $value.Trim().TrimEnd("/")
    $value = $value -replace "(?i)[?&](ac|wd|ids|pg|t)=.*$", ""
    $value = $value.TrimEnd("/")
    return $value.ToLowerInvariant()
}

function Get-ApiHost {
    param([string]$Url)

    $value = Unwrap-ProxyUrl -Url $Url
    try {
        return ([System.Uri]$value).Host.ToLowerInvariant()
    } catch {
        return ""
    }
}

function Get-JsonFromPathOrUrl {
    param(
        [string]$Path,
        [string]$Url
    )

    if (-not [string]::IsNullOrWhiteSpace($Path)) {
        if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
            throw "Compare VOD file not found: $Path"
        }
        return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
    }

    if (-not [string]::IsNullOrWhiteSpace($Url)) {
        return Get-Utf8Text -Url $Url | ConvertFrom-Json
    }

    return $null
}

function Get-CompareIndex {
    param(
        [string]$Path,
        [string]$Url
    )

    $index = [ordered]@{
        loaded = $false
        path = $Path
        url = $Url
        count = 0
        apiKeys = @{}
        hosts = @{}
        names = @{}
        error = ""
    }

    if ([string]::IsNullOrWhiteSpace($Path) -and [string]::IsNullOrWhiteSpace($Url)) {
        $index.error = "No compare VOD source configured."
        return [pscustomobject]$index
    }

    try {
        $json = Get-JsonFromPathOrUrl -Path $Path -Url $Url
        $sites = @($json.sites)
        foreach ($site in $sites) {
            $apiKey = Normalize-ApiUrl -Url ([string]$site.api)
            $apiHost = Get-ApiHost -Url ([string]$site.api)
            $nameKey = Normalize-SourceName -Value ([string]$site.name)

            if (-not [string]::IsNullOrWhiteSpace($apiKey)) { $index.apiKeys[$apiKey] = $true }
            if (-not [string]::IsNullOrWhiteSpace($apiHost)) { $index.hosts[$apiHost] = $true }
            if (-not [string]::IsNullOrWhiteSpace($nameKey)) { $index.names[$nameKey] = $true }
        }
        $index.loaded = $true
        $index.count = $sites.Count
    } catch {
        $index.error = $_.Exception.Message
    }

    return [pscustomobject]$index
}

function Get-DuplicateReason {
    param(
        [Parameter(Mandatory = $true)][object]$CompareIndex,
        [Parameter(Mandatory = $true)][string]$Api,
        [Parameter(Mandatory = $true)][string]$Name
    )

    if (-not $CompareIndex.loaded) { return "" }

    $apiKey = Normalize-ApiUrl -Url $Api
    $apiHost = Get-ApiHost -Url $Api
    $nameKey = Normalize-SourceName -Value $Name

    if (-not [string]::IsNullOrWhiteSpace($apiKey) -and $CompareIndex.apiKeys.Contains($apiKey)) {
        return "duplicate_api"
    }
    if (-not [string]::IsNullOrWhiteSpace($apiHost) -and $CompareIndex.hosts.Contains($apiHost)) {
        return "duplicate_host"
    }
    if (-not [string]::IsNullOrWhiteSpace($nameKey) -and $CompareIndex.names.Contains($nameKey)) {
        return "duplicate_name"
    }
    return ""
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
        searchOk = $false
        searchHasPlayUrl = $false
        hasPlayUrl = $false
        sampleVodName = ""
        sampleVodId = ""
        searchSampleVodId = ""
        error = ""
    }

    try {
        $firstName = ""
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
            if ([string]::IsNullOrWhiteSpace($firstName)) {
                $firstName = [string]$detail.vod_name
            }
            if (-not [string]::IsNullOrWhiteSpace($playUrl)) {
                $result.hasPlayUrl = $true
                break
            }
        }

        $searchTerms = New-Object System.Collections.Generic.List[string]
        if (-not [string]::IsNullOrWhiteSpace($SearchKeyword)) {
            $searchTerms.Add($SearchKeyword)
        }
        if (-not [string]::IsNullOrWhiteSpace($firstName)) {
            $searchTerms.Add($firstName)
        }

        foreach ($term in @($searchTerms.ToArray() | Select-Object -Unique)) {
            $encodedTerm = [System.Uri]::EscapeDataString($term)
            $searchUrl = Add-VodQuery -Api $Api -Query "ac=detail&wd=$encodedTerm"
            try {
                $searchJson = Get-Utf8Text -Url $searchUrl | ConvertFrom-Json
                $searchItems = @($searchJson.list)
                if ($searchItems.Count -eq 0) { continue }

                $result.searchOk = $true
                foreach ($item in @($searchItems | Select-Object -First $MaxDetailProbe)) {
                    $result.searchSampleVodId = [string]$item.vod_id
                    $playUrl = [string]$item.vod_play_url
                    if (-not [string]::IsNullOrWhiteSpace($playUrl)) {
                        $result.searchHasPlayUrl = $true
                        if (-not $result.hasPlayUrl) {
                            $result.hasPlayUrl = $true
                            $result.detailOk = $true
                            $result.sampleVodId = [string]$item.vod_id
                            $result.sampleVodName = [string]$item.vod_name
                        }
                        break
                    }
                }
            } catch {
                if ([string]::IsNullOrWhiteSpace($result.error)) {
                    $result.error = "Search probe failed: $($_.Exception.Message)"
                }
            }

            if ($result.searchOk) { break }
        }

        if (-not $result.hasPlayUrl) {
            $keyword = "%E5%93%88"
            $searchUrl = Add-VodQuery -Api $Api -Query "ac=detail&wd=$keyword"
            $searchJson = Get-Utf8Text -Url $searchUrl | ConvertFrom-Json
            $searchItems = @($searchJson.list)
            foreach ($item in @($searchItems | Select-Object -First $MaxDetailProbe)) {
                $playUrl = [string]$item.vod_play_url
                if (-not [string]::IsNullOrWhiteSpace($playUrl)) {
                    $result.searchOk = $true
                    $result.searchHasPlayUrl = $true
                    $result.detailOk = $true
                    $result.hasPlayUrl = $true
                    $result.sampleVodId = [string]$item.vod_id
                    $result.sampleVodName = [string]$item.vod_name
                    $result.searchSampleVodId = [string]$item.vod_id
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

$compareIndex = $null
if ($SkipDuplicateCheck) {
    $compareIndex = [pscustomobject]([ordered]@{
        loaded = $false
        path = $CompareVodPath
        url = $CompareVodUrl
        count = 0
        apiKeys = @{}
        hosts = @{}
        names = @{}
        error = "Duplicate check skipped"
    })
} else {
    Write-Host "Loading compare VOD source for duplicate detection."
    $compareIndex = Get-CompareIndex -Path $CompareVodPath -Url $CompareVodUrl
    if ($compareIndex.loaded) {
        Write-Host ("Compare VOD sources loaded: {0}" -f $compareIndex.count)
    } else {
        Write-Host ("Compare VOD source unavailable: {0}" -f $compareIndex.error)
    }
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

    $duplicateReason = ""
    if (-not $SkipDuplicateCheck) {
        $duplicateReason = Get-DuplicateReason -CompareIndex $compareIndex -Api $site.api -Name $name
    }

    if ($SkipValidation) {
        $include = [string]::IsNullOrWhiteSpace($duplicateReason) -or $KeepFailed.IsPresent
        if ($include) {
            $sites.Add([pscustomobject]$site)
        }
        $check = [pscustomobject]([ordered]@{
            key = $site.key
            name = $site.name
            api = $site.api
            included = $include
            duplicate = -not [string]::IsNullOrWhiteSpace($duplicateReason)
            duplicateReason = $duplicateReason
            listOk = $null
            detailOk = $null
            searchOk = $null
            searchHasPlayUrl = $null
            hasPlayUrl = $null
            sampleVodName = ""
            sampleVodId = ""
            searchSampleVodId = ""
            error = $(if ($duplicateReason) { $duplicateReason } else { "Validation skipped" })
        })
        $checks.Add($check)
        continue
    }

    Write-Host ("Checking {0}: {1}" -f $site.name, $site.api)
    $probe = Test-LunaApi -Api $site.api
    $include = (([bool]$probe.hasPlayUrl) -and [string]::IsNullOrWhiteSpace($duplicateReason)) -or $KeepFailed.IsPresent
    if ($include) {
        $sites.Add([pscustomobject]$site)
    }

    $check = [pscustomobject]([ordered]@{
        key = $site.key
        name = $site.name
        api = $site.api
        included = $include
        duplicate = -not [string]::IsNullOrWhiteSpace($duplicateReason)
        duplicateReason = $duplicateReason
        listOk = $probe.listOk
        detailOk = $probe.detailOk
        searchOk = $probe.searchOk
        searchHasPlayUrl = $probe.searchHasPlayUrl
        hasPlayUrl = $probe.hasPlayUrl
        sampleVodName = $probe.sampleVodName
        sampleVodId = $probe.sampleVodId
        searchSampleVodId = $probe.searchSampleVodId
        error = $(if ($duplicateReason) { $duplicateReason } else { $probe.error })
    })
    $checks.Add($check)
}

$siteArray = @($sites.ToArray())
$checkArray = @($checks.ToArray())

$warningText = if ($SourceName -eq "full") {
    "影視 LunaTV full technical test source. Includes 18+ entries from upstream. Auto refreshed, validated and de-duplicated; review required before any playback use."
} else {
    "影視 LunaTV jin18 VOD source. Auto refreshed, validated, de-duplicated against the configured baseline, and adult/full sources are not used by default."
}

$vodConfig = [ordered]@{
    spider = ""
    logo = "https://raw.githubusercontent.com/SYLONG7708/TV/main/branding/icon-tech-20260528.png"
    wallpaper = "http://tool.teyonds.com/api"
    warningText = $warningText
    sites = $siteArray
}

$duplicateCount = @($checkArray | Where-Object { $_.duplicate }).Count
$invalidCount = @($checkArray | Where-Object { -not $_.hasPlayUrl -and -not $_.included }).Count
$searchOkCount = @($checkArray | Where-Object { $_.searchOk }).Count
$searchPlayableCount = @($checkArray | Where-Object { $_.searchHasPlayUrl }).Count

$report = [ordered]@{
    generatedAt = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss zzz")
    sourceName = $SourceName
    sourceUrl = $SourceUrl
    compareVodUrl = $CompareVodUrl
    compareVodPath = $CompareVodPath
    compareLoaded = [bool]$compareIndex.loaded
    compareCount = [int]$compareIndex.count
    compareError = [string]$compareIndex.error
    upstreamCacheSeconds = $sourceJson.cache_time
    output = ($Output -replace "\\", "/")
    analysisOutput = ($AnalysisOutput -replace "\\", "/")
    totalSources = $sourceEntries.Count
    includedSources = $sites.Count
    failedSources = ($sourceEntries.Count - $sites.Count)
    duplicateSources = $duplicateCount
    invalidSources = $invalidCount
    searchOkSources = $searchOkCount
    searchPlayableSources = $searchPlayableCount
    validationSkipped = [bool]$SkipValidation
    duplicateCheckSkipped = [bool]$SkipDuplicateCheck
    redactedSampleNames = [bool]$RedactSampleNames
    checks = $checkArray
}

if ($RedactSampleNames) {
    foreach ($check in $checkArray) {
        if ($check.sampleVodName) {
            $check.sampleVodName = "[redacted]"
        }
    }
}

$outputDir = Split-Path -Parent $Output
$reportDir = Split-Path -Parent $ReportOutput
$analysisDir = Split-Path -Parent $AnalysisOutput
if (-not (Test-Path -LiteralPath $outputDir)) { New-Item -ItemType Directory -Path $outputDir -Force | Out-Null }
if (-not (Test-Path -LiteralPath $reportDir)) { New-Item -ItemType Directory -Path $reportDir -Force | Out-Null }
if (-not (Test-Path -LiteralPath $analysisDir)) { New-Item -ItemType Directory -Path $analysisDir -Force | Out-Null }

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($Output, ($vodConfig | ConvertTo-Json -Depth 8), $utf8NoBom)
[System.IO.File]::WriteAllText($ReportOutput, ($report | ConvertTo-Json -Depth 8), $utf8NoBom)

$analysisRows = $checkArray | Select-Object `
    name,
    api,
    included,
    duplicate,
    duplicateReason,
    listOk,
    detailOk,
    searchOk,
    searchHasPlayUrl,
    hasPlayUrl,
    sampleVodId,
    searchSampleVodId,
    error
[System.IO.File]::WriteAllText($AnalysisOutput, (($analysisRows | ConvertTo-Csv -NoTypeInformation) -join "`r`n") + "`r`n", $utf8NoBom)

Write-Host ("Wrote OKTV VOD candidate: {0}" -f $Output)
Write-Host ("Wrote validation report: {0}" -f $ReportOutput)
Write-Host ("Wrote analysis CSV: {0}" -f $AnalysisOutput)
Write-Host ("Included sources: {0} / {1}" -f $sites.Count, $sourceEntries.Count)
Write-Host ("Duplicates removed: {0}; invalid removed: {1}" -f $duplicateCount, $invalidCount)
Write-Host ("Search OK: {0}; search playable: {1}" -f $searchOkCount, $searchPlayableCount)
