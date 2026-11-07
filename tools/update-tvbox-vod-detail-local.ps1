param(
    [string]$RepoRoot = "",
    [string]$TvboxUrl = "https://raw.githubusercontent.com/SYLONG7708/TV/main/sources/TVBOX",
    [int]$UpdateIntervalDays = 1,
    [int]$ScheduleHour = 2,
    [int]$PageSize = 100,
    [int]$PageConcurrency = 3,
    [int]$TimeoutMs = 60000,
    [int]$Retries = 2,
    [int]$RetryDelayMs = 1000,
    [int]$RateLimitDelayMs = 3000,
    [int]$PageDelayMs = 250,
    [int]$MinSourceSeconds = 600,
    [int]$MaxSourceSeconds = 10800,
    [double]$SecondsPerPageEstimate = 1.0,
    [int]$IdleSourceSeconds = 900,
    [int]$RefreshLeadingPages = 0,
    [int]$MaxFailedPagesPerSource = 120,
    [bool]$CheckUpstreamFreshness = $true,
    [int]$FreshnessTimeoutMs = 12000,
    [int]$FreshnessConcurrency = 8,
    [int]$FreshnessMaxSources = 0,
    [switch]$ForceUpdate
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
    $RepoRoot = Resolve-Path $RepoRoot
}

$repoRootText = [string]$RepoRoot
$workDir = Join-Path $repoRootText ".patch-work"
$logDir = Join-Path $repoRootText "logs"
$perSourceLogDir = Join-Path $logDir "tvbox-vod-per-source"
$statePath = Join-Path $repoRootText "docs\data\tvbox-vod-update-state.json"
$lockPath = Join-Path $workDir "tvbox-vod-detail-update.lock"
$legacyVodLockPath = Join-Path $workDir "lunatv-vod-local-update.lock"
$logPath = Join-Path $workDir "tvbox-vod-detail-update.log"
$sourceSnapshotPath = Join-Path $repoRootText "docs\data\tvbox-source-latest.json"
$localTvboxPath = Join-Path $repoRootText "sources\TVBOX"
$seedCatalogPath = Join-Path $repoRootText "docs\data\tvbox-vod-catalog.json"
$seedReportPath = Join-Path $repoRootText "docs\data\tvbox-vod-catalog-report.json"
$freshnessReportPath = Join-Path $repoRootText "docs\data\tvbox-vod-freshness-report.json"
$detailRoot = Join-Path $repoRootText "docs\data\vod-detail"
$indexRoot = Join-Path $repoRootText "docs\data\vod-index"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$script:LastTriggerReason = "schedule"

New-Item -ItemType Directory -Force -Path $workDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $sourceSnapshotPath) | Out-Null
New-Item -ItemType Directory -Force -Path $perSourceLogDir | Out-Null

function Write-Log([string]$Message) {
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
    $line | Tee-Object -FilePath $logPath -Append | Out-Null
}

function Get-ScheduleTimeZone {
    try {
        return [TimeZoneInfo]::FindSystemTimeZoneById("China Standard Time")
    } catch {
        return [TimeZoneInfo]::Local
    }
}

function Get-NextDueAt([DateTimeOffset]$SuccessAt) {
    $tz = Get-ScheduleTimeZone
    $localSuccess = [TimeZoneInfo]::ConvertTime($SuccessAt, $tz)
    $nextLocalDateTime = $localSuccess.Date.AddDays($UpdateIntervalDays).AddHours($ScheduleHour)
    if ($nextLocalDateTime -le $localSuccess.DateTime) {
        $nextLocalDateTime = $nextLocalDateTime.AddDays(1)
    }
    $offset = $tz.GetUtcOffset($nextLocalDateTime)
    return [DateTimeOffset]::new($nextLocalDateTime, $offset)
}

function Get-ScheduleState {
    if (-not (Test-Path -LiteralPath $statePath)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-Log "Schedule state is unreadable; update will run. $($_.Exception.Message)"
        return $null
    }
}

function Test-UpdateDue {
    if ($ForceUpdate) {
        Write-Log "ForceUpdate set; TVBOX VOD update will run now."
        $script:LastTriggerReason = "manual-force"
        return $true
    }

    $state = Get-ScheduleState
    if (-not $state) {
        Write-Log "No TVBOX VOD update state found; update is due."
        return $true
    }

    $nextDueText = [string]$state.nextDueAt
    if ([string]::IsNullOrWhiteSpace($nextDueText) -and -not [string]::IsNullOrWhiteSpace([string]$state.lastSuccessAt)) {
        $lastSuccess = [DateTimeOffset]::Parse([string]$state.lastSuccessAt)
        $nextDueText = (Get-NextDueAt $lastSuccess).ToString("o")
    }

    if ([string]::IsNullOrWhiteSpace($nextDueText)) {
        Write-Log "Schedule state has no nextDueAt; update is due."
        return $true
    }

    $nextDue = [DateTimeOffset]::Parse($nextDueText)
    $now = [DateTimeOffset]::UtcNow
    if ($now -lt $nextDue.ToUniversalTime()) {
        Write-Log "TVBOX VOD update is not due. Next due: $($nextDue.ToString("yyyy-MM-dd HH:mm:ss zzz"))."
        return $false
    }

    Write-Log "TVBOX VOD update is due. Last success: $($state.lastSuccessAt); next due: $nextDueText."
    $script:LastTriggerReason = "schedule"
    return $true
}

function Test-UpstreamFreshnessDue {
    if (-not $CheckUpstreamFreshness) {
        Write-Log "Upstream freshness check disabled; TVBOX VOD update remains skipped until the next schedule."
        return $false
    }

    $freshnessScript = Join-Path $repoRootText "tools\check-tvbox-vod-freshness.mjs"
    if (-not (Test-Path -LiteralPath $freshnessScript)) {
        Write-Log "Freshness checker missing; TVBOX VOD update remains skipped until the next schedule: $freshnessScript"
        return $false
    }

    if (-not (Test-Path -LiteralPath $localTvboxPath)) {
        Write-Log "Local TVBOX config missing; cannot check upstream freshness before the next schedule: $localTvboxPath"
        return $false
    }

    Write-Log "Checking upstream VOD update dates before skipping scheduled update."
    $nodeArgs = @(
        $freshnessScript,
        "--repoRoot", $repoRootText,
        "--input", $localTvboxPath,
        "--indexRoot", $indexRoot,
        "--output", $freshnessReportPath,
        "--timeoutMs", [string]$FreshnessTimeoutMs,
        "--concurrency", [string]$FreshnessConcurrency,
        "--pageSize", [string]$PageSize,
        "--maxSources", [string]$FreshnessMaxSources
    )

    $outputLines = & node @nodeArgs 2>&1
    $exitCode = $LASTEXITCODE
    foreach ($line in $outputLines) {
        if (-not [string]::IsNullOrWhiteSpace([string]$line)) {
            Write-Log "Freshness: $line"
        }
    }

    if ($exitCode -ne 0) {
        Write-Log "Freshness check failed with exit code $exitCode; TVBOX VOD update remains skipped until the next schedule."
        return $false
    }

    if (-not (Test-Path -LiteralPath $freshnessReportPath)) {
        Write-Log "Freshness check produced no report; TVBOX VOD update remains skipped until the next schedule."
        return $false
    }

    try {
        $report = Get-Content -LiteralPath $freshnessReportPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ([bool]$report.hasNewerUpstream) {
            $script:LastTriggerReason = "upstream-date"
            Write-Log "Upstream VOD dates are newer than saved indexes; update will run before the daily schedule."
            return $true
        }

        Write-Log "No newer upstream VOD dates found; TVBOX VOD update remains skipped until the next schedule."
        return $false
    } catch {
        Write-Log "Freshness report is unreadable; TVBOX VOD update remains skipped until the next schedule. $($_.Exception.Message)"
        return $false
    }
}

function Write-ScheduleSuccess {
    $successAt = [DateTimeOffset]::Now
    $nextDue = Get-NextDueAt $successAt
    $state = [ordered]@{
        status = "success"
        lastSuccessAt = $successAt.ToString("o")
        nextDueAt = $nextDue.ToString("o")
        intervalDays = $UpdateIntervalDays
        scheduleHour = $ScheduleHour
        timeZone = (Get-ScheduleTimeZone).Id
        triggerReason = $script:LastTriggerReason
        checkUpstreamFreshness = $CheckUpstreamFreshness
        freshnessReport = "docs/data/tvbox-vod-freshness-report.json"
        updatedBy = "tools/update-tvbox-vod-detail-local.ps1"
        source = $TvboxUrl
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $statePath) | Out-Null
    Set-Content -LiteralPath $statePath -Value (($state | ConvertTo-Json -Depth 4) + "`n") -Encoding UTF8
    Write-Log "TVBOX VOD update marked successful. Next scheduled update: $($nextDue.ToString("yyyy-MM-dd HH:mm:ss zzz"))."
}

function Invoke-NodeStep {
    param(
        [string]$Label,
        [string[]]$NodeArgs
    )

    Write-Log $Label
    & node @NodeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

foreach ($existingLockPath in @($lockPath, $legacyVodLockPath)) {
    if (-not (Test-Path -LiteralPath $existingLockPath)) {
        continue
    }

    $age = (Get-Date) - (Get-Item -LiteralPath $existingLockPath).LastWriteTime
    if ($age.TotalMinutes -lt 720) {
        Write-Log "Another VOD update appears to be running: $existingLockPath. Lock age: $([int]$age.TotalMinutes) minutes."
        exit 0
    }
}

Set-Content -LiteralPath $lockPath -Value ([DateTime]::Now.ToString("o")) -Encoding UTF8
Set-Content -LiteralPath $legacyVodLockPath -Value ([DateTime]::Now.ToString("o")) -Encoding UTF8
$pushedLocation = $false
try {
    Write-Log "Starting TVBOX VOD detail update. Repo: $repoRootText"
    $dueBySchedule = Test-UpdateDue
    if (-not $dueBySchedule -and -not (Test-UpstreamFreshnessDue)) {
        exit 0
    }

    Push-Location $repoRootText
    $pushedLocation = $true

    try {
        Write-Log "Downloading latest TVBOX config: $TvboxUrl"
        $response = Invoke-WebRequest -Uri $TvboxUrl -UseBasicParsing -TimeoutSec 60
        $text = [string]$response.Content
        $tvboxConfig = $text | ConvertFrom-Json
        $tvboxConfig.warningText = "OKTV all on-demand sources. Auto refreshed daily at 02:00 or sooner when upstream VOD update dates change; existing detail pages are preserved and new pages are appended under docs/data/vod-detail."
        $text = $tvboxConfig | ConvertTo-Json -Depth 16
        [System.IO.File]::WriteAllText($sourceSnapshotPath, $text, $utf8NoBom)
        [System.IO.File]::WriteAllText($localTvboxPath, $text, $utf8NoBom)
    } catch {
        Write-Log "Unable to download latest TVBOX config; using local file. $($_.Exception.Message)"
        if (-not (Test-Path -LiteralPath $localTvboxPath)) {
            throw "No local TVBOX config found: $localTvboxPath"
        }
        Copy-Item -LiteralPath $localTvboxPath -Destination $sourceSnapshotPath -Force
    }

    Invoke-NodeStep "Building TVBOX VOD seed catalog from current sources/TVBOX." @(
        (Join-Path $repoRootText "tools\build-tvbox-vod-seed-catalog.mjs"),
        "--repoRoot", $repoRootText,
        "--input", $sourceSnapshotPath,
        "--output", $seedCatalogPath,
        "--report", $seedReportPath,
        "--detailRoot", $detailRoot
    )

    Invoke-NodeStep "Continuing full TVBOX VOD page archive from missing pages." @(
        (Join-Path $repoRootText "tools\run-full-vod-per-source.mjs"),
        "--tvRoot", $repoRootText,
        "--catalog", $seedCatalogPath,
        "--report", $seedReportPath,
        "--detailRoot", $detailRoot,
        "--logDir", $perSourceLogDir,
        "--pageSize", [string]$PageSize,
        "--pageConcurrency", [string]$PageConcurrency,
        "--timeoutMs", [string]$TimeoutMs,
        "--retries", [string]$Retries,
        "--retryDelayMs", [string]$RetryDelayMs,
        "--rateLimitDelayMs", [string]$RateLimitDelayMs,
        "--pageDelayMs", [string]$PageDelayMs,
        "--minSourceSeconds", [string]$MinSourceSeconds,
        "--maxSourceSeconds", [string]$MaxSourceSeconds,
        "--secondsPerPageEstimate", [string]$SecondsPerPageEstimate,
        "--idleSourceSeconds", [string]$IdleSourceSeconds,
        "--appendDetailPages", "true",
        "--skipExistingPages", "true",
        "--keepPartialPages", "true",
        "--includeEmptySeedSources", "true",
        "--refreshLeadingPages", [string]$RefreshLeadingPages,
        "--maxFailedPages", [string]$MaxFailedPagesPerSource,
        "--allowPartialSources", "true"
    )

    Invoke-NodeStep "Rebuilding TVBOX VOD compressed indexes from saved detail pages." @(
        (Join-Path $repoRootText "tools\assemble-vod-index-from-detail.mjs"),
        "--tvRoot", $repoRootText,
        "--catalog", $seedCatalogPath,
        "--report", $seedReportPath,
        "--detailRoot", $detailRoot,
        "--indexRoot", $indexRoot,
        "--dropEmptySources", "false"
    )

    Write-ScheduleSuccess
    Write-Log "TVBOX VOD detail update finished."
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    throw
} finally {
    if ($pushedLocation) {
        Pop-Location
    }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $legacyVodLockPath -Force -ErrorAction SilentlyContinue
}
