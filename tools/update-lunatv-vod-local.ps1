param(
    [string]$RepoRoot = "",
    [string]$PagesRoot = "",
    [string]$SourceName = "jin18,full",
    [int]$TimeoutSec = 12,
    [int]$MaxDetailProbe = 3,
    [int]$UpdateIntervalDays = 1,
    [int]$ScheduleHour = 2,
    [switch]$ForceUpdate,
    [switch]$NoGitPush,
    [switch]$PublishFullData
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
    $RepoRoot = Resolve-Path $RepoRoot
}

$repoRootText = [string]$RepoRoot
$safeDir = $repoRootText -replace "\\", "/"
$parentDir = Split-Path -Parent $repoRootText
if ([string]::IsNullOrWhiteSpace($PagesRoot)) {
    $PagesRoot = Join-Path $parentDir "TV-gh-pages"
}
$pagesRootText = [string]$PagesRoot
$pagesSafeDir = $pagesRootText -replace "\\", "/"
$logDir = Join-Path $repoRootText ".patch-work"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir "lunatv-vod-local-update.log"
$lockPath = Join-Path $logDir "lunatv-vod-local-update.lock"
$scheduleStatePath = Join-Path $repoRootText "docs\data\lunatv-vod-update-state.json"

function Write-Log([string]$Message) {
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
    $line | Tee-Object -FilePath $logPath -Append | Out-Null
}

function Invoke-Git {
    git -c "safe.directory=$safeDir" @args
}

function Invoke-PagesGit {
    git -c "safe.directory=$pagesSafeDir" @args
}

function Invoke-GitPushWithRetry {
    param(
        [scriptblock]$PushCommand,
        [string]$Label,
        [scriptblock]$RecoveryCommand = $null
    )

    $pushed = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        & $PushCommand
        if ($LASTEXITCODE -eq 0) {
            $pushed = $true
            break
        }

        Write-Log "$Label failed on attempt $attempt; retrying after backoff."
        if ($null -ne $RecoveryCommand) {
            & $RecoveryCommand
            if ($LASTEXITCODE -ne 0) {
                throw "$Label recovery failed after attempt $attempt."
            }
        }
        Start-Sleep -Seconds (30 * $attempt)
    }

    if (-not $pushed) {
        throw "$Label failed after 3 attempts."
    }
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
    if (-not (Test-Path -LiteralPath $scheduleStatePath)) {
        return $null
    }

    try {
        return Get-Content -LiteralPath $scheduleStatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-Log "Schedule state is unreadable; update will run. $($_.Exception.Message)"
        return $null
    }
}

function Test-UpdateDue {
    if ($ForceUpdate) {
        Write-Log "ForceUpdate set; update will run now."
        return $true
    }

    $state = Get-ScheduleState
    if (-not $state) {
        Write-Log "No successful VOD update state found; update is due."
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
        Write-Log "VOD update is not due. Next due: $($nextDue.ToString("yyyy-MM-dd HH:mm:ss zzz"))."
        return $false
    }

    Write-Log "VOD update is due. Last success: $($state.lastSuccessAt); next due: $nextDueText."
    return $true
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
        updatedBy = "tools/update-lunatv-vod-local.ps1"
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $scheduleStatePath) | Out-Null
    Set-Content -LiteralPath $scheduleStatePath -Value (($state | ConvertTo-Json -Depth 4) + "`n") -Encoding UTF8
    Write-Log "VOD update marked successful. Next scheduled update: $($nextDue.ToString("yyyy-MM-dd HH:mm:ss zzz"))."
}

function Sync-GhPages {
    if (-not (Test-Path -LiteralPath (Join-Path $pagesRootText ".git"))) {
        Write-Log "GitHub Pages worktree not found; skipping gh-pages sync: $pagesRootText"
        return
    }

    Write-Log "Syncing iPhone public files to gh-pages worktree: $pagesRootText"
    Push-Location $pagesRootText
    try {
        try {
            Invoke-PagesGit config user.name | Out-Null
        } catch {
            Invoke-PagesGit config user.name "OKTV local updater"
        }
        try {
            Invoke-PagesGit config user.email | Out-Null
        } catch {
            Invoke-PagesGit config user.email "oktv-local-updater@example.local"
        }
        Invoke-PagesGit config http.postBuffer 524288000
        Invoke-PagesGit config http.version HTTP/1.1

        Invoke-PagesGit pull --ff-only origin gh-pages

        New-Item -ItemType Directory -Force -Path (Join-Path $pagesRootText "docs") | Out-Null
        New-Item -ItemType Directory -Force -Path (Join-Path $pagesRootText "docs\data") | Out-Null
        Copy-Item -LiteralPath (Join-Path $repoRootText ".gitattributes") -Destination (Join-Path $pagesRootText ".gitattributes") -Force
        Copy-Item -LiteralPath (Join-Path $repoRootText "docs\iphone") -Destination (Join-Path $pagesRootText "docs") -Recurse -Force
        Copy-Item -LiteralPath (Join-Path $repoRootText "docs\assets") -Destination (Join-Path $pagesRootText "docs") -Recurse -Force
        Get-ChildItem -LiteralPath (Join-Path $repoRootText "docs\data") -File | Where-Object {
            $_.Name -notin @("iphone-vod-catalog.json", "iphone-vod-catalog-report.json")
        } | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $pagesRootText "docs\data") -Force
        }
        if ($PublishFullData) {
            Write-Log "PublishFullData set; copying full vod-detail and vod-index to gh-pages."
            Copy-Item -LiteralPath (Join-Path $repoRootText "docs\data\vod-detail") -Destination (Join-Path $pagesRootText "docs\data") -Recurse -Force
            Copy-Item -LiteralPath (Join-Path $repoRootText "docs\data\vod-index") -Destination (Join-Path $pagesRootText "docs\data") -Recurse -Force
        } else {
            Write-Log "Publishing indexed vod-detail/vod-index via public catalog builder."
        }

        $publicCatalogScript = Join-Path $repoRootText "tools\build-pages-public-catalog.mjs"
        & node $publicCatalogScript `
            --tvRoot $repoRootText `
            --pagesRoot $pagesRootText `
            --catalog (Join-Path $repoRootText "docs\data\iphone-vod-catalog.json") `
            --smallCatalog (Join-Path $pagesRootText "docs\data\iphone-vod-catalog.json") `
            --output (Join-Path $pagesRootText "docs\data\iphone-vod-catalog.json") `
            --reportOutput (Join-Path $pagesRootText "docs\data\iphone-vod-catalog-report.json") `
            --preservePreviousPublicSources true

        $queryManifest = Join-Path $pagesRootText "docs\data\vod-query\manifest.json"
        $queryMergeScript = Join-Path $repoRootText "tools\merge-iphone-query-shards.mjs"
        if ((Test-Path -LiteralPath $queryManifest) -and (Test-Path -LiteralPath $queryMergeScript)) {
            Write-Log "Merging the latest iPhone catalog into the mobile-safe query shards."
            & node $queryMergeScript `
                --repoRoot $repoRootText `
                --catalog (Join-Path $repoRootText "docs\data\iphone-vod-catalog.json") `
                --latest (Join-Path $repoRootText "docs\data\iphone-vod-latest.json") `
                --outputRoot (Join-Path $pagesRootText "docs\data\vod-query") `
                --iphoneHtml (Join-Path $repoRootText "docs\iphone\index.html")
            if ($LASTEXITCODE -ne 0) { throw "Query shard merge failed with exit code $LASTEXITCODE." }
        } else {
            Write-Log "Query shard manifest is not available yet; keeping the current public search fallback."
        }

        Get-ChildItem -LiteralPath (Join-Path $repoRootText "docs\data") -File | ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $pagesRootText "docs\data") -Force
        }
        if ($PublishFullData) {
            Write-Log "PublishFullData set; copying full vod-detail and vod-index to gh-pages."
            Copy-Item -LiteralPath (Join-Path $repoRootText "docs\data\vod-detail") -Destination (Join-Path $pagesRootText "docs\data") -Recurse -Force
            Copy-Item -LiteralPath (Join-Path $repoRootText "docs\data\vod-index") -Destination (Join-Path $pagesRootText "docs\data") -Recurse -Force
        } else {
            Write-Log "Skipping full vod-detail/vod-index copy for lean gh-pages publish."
        }

        Invoke-PagesGit add ".gitattributes" "docs/iphone" "docs/data" "docs/assets"
        if (Invoke-PagesGit diff --cached --quiet) {
            Write-Log "No gh-pages public file changes to commit."
        } else {
            Invoke-PagesGit commit -m "Publish auto refreshed OKTV data"
            if ($NoGitPush) {
                Write-Log "NoGitPush set; gh-pages commit created but not pushed."
            } else {
                Invoke-GitPushWithRetry -Label "gh-pages push" -PushCommand {
                    Invoke-PagesGit push origin HEAD:gh-pages
                } -RecoveryCommand {
                    Invoke-PagesGit fetch origin gh-pages
                    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
                    Invoke-PagesGit rebase origin/gh-pages
                }
            }
        }
    } finally {
        Pop-Location
    }
}

if (Test-Path -LiteralPath $lockPath) {
    $age = (Get-Date) - (Get-Item -LiteralPath $lockPath).LastWriteTime
    if ($age.TotalMinutes -lt 60) {
        Write-Log "Another LunaTV update appears to be running. Lock age: $([int]$age.TotalMinutes) minutes."
        exit 0
    }
}

Set-Content -LiteralPath $lockPath -Value ([DateTime]::Now.ToString("o")) -Encoding UTF8
$pushedLocation = $false
try {
    Write-Log "Starting LunaTV VOD update. Repo: $repoRootText"
    if (-not (Test-UpdateDue)) {
        exit 0
    }

    Push-Location $repoRootText
    $pushedLocation = $true

    try {
        Invoke-Git config user.name | Out-Null
    } catch {
        Invoke-Git config user.name "OKTV local updater"
    }
    try {
        Invoke-Git config user.email | Out-Null
    } catch {
        Invoke-Git config user.email "oktv-local-updater@example.local"
    }
    Invoke-Git config http.postBuffer 524288000
    Invoke-Git config http.version HTTP/1.1

    $statusBefore = Invoke-Git status --porcelain --untracked-files=no
    if ($statusBefore) {
        Write-Log "Working tree has existing changes; continuing without pull to avoid overwriting local work."
    } else {
        Write-Log "Pulling latest main."
        Invoke-Git pull --ff-only origin main
    }

    $updateScript = Join-Path $repoRootText "tools\update-lunatv-vod.ps1"
    $adultSortScript = Join-Path $repoRootText "tools\build-lunatv-adult18-sorted.mjs"
    $iphoneCatalogScript = Join-Path $repoRootText "tools\build-iphone-vod-catalog.mjs"
    $fullChunkedCatalogScript = Join-Path $repoRootText "tools\build-full-vod-chunked-catalog.mjs"
    $type3SpiderCatalogScript = Join-Path $repoRootText "tools\build-type3-spider-catalog.mjs"
    $assembleChunkedCatalogScript = Join-Path $repoRootText "tools\assemble-vod-index-from-detail.mjs"
    $applyVodKindRulesScript = Join-Path $repoRootText "tools\apply-vod-kind-rules.mjs"
    $iphoneLatestScript = Join-Path $repoRootText "tools\build-iphone-vod-latest.mjs"
    $compactIphoneCatalogScript = Join-Path $repoRootText "tools\compact-iphone-catalog.mjs"
    $iphoneHealthScript = Join-Path $repoRootText "tools\check-iphone-catalog-health.mjs"
    $tvboxConfigScript = Join-Path $repoRootText "tools\build-tvbox-config.mjs"
    $sourceNames = @($SourceName -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    foreach ($name in $sourceNames) {
        Write-Log "Refreshing LunaTV VOD sources from GitHub raw $name."
        powershell -NoProfile -ExecutionPolicy Bypass -File $updateScript `
            -SourceName $name `
            -TimeoutSec $TimeoutSec `
            -MaxDetailProbe $MaxDetailProbe `
            -RedactSampleNames

        $reportPath = Join-Path $repoRootText "sources\vod-lunatv-$name-report.json"
        if (Test-Path -LiteralPath $reportPath) {
            $report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
            Write-Log "$name included: $($report.includedSources) / $($report.totalSources); duplicates removed: $($report.duplicateSources); invalid removed: $($report.invalidSources); search OK: $($report.searchOkSources)."
        }
    }

    if (Test-Path -LiteralPath $adultSortScript) {
        Write-Log "Building sorted adult 18+ resource area."
        node $adultSortScript --repoRoot $repoRootText
    }

    if (Test-Path -LiteralPath $iphoneCatalogScript) {
        Write-Log "Building iPhone OKTV VOD catalog."
        node $iphoneCatalogScript `
            --tvRoot $repoRootText `
            --output (Join-Path $repoRootText "docs\data\iphone-vod-catalog.json") `
            --reportOutput (Join-Path $repoRootText "docs\data\iphone-vod-catalog-report.json") `
            --maxSources 120 `
            --maxItemsPerSource 70 `
            --maxCategoriesPerSource 8 `
            --includeAdult true `
            --includeLegacySources false `
            --mergeExisting true `
            --timeoutMs 8000
    }

    if (Test-Path -LiteralPath $fullChunkedCatalogScript) {
        Write-Log "Building full chunked iPhone OKTV VOD catalog for all readable sources."
        node $fullChunkedCatalogScript `
            --tvRoot $repoRootText `
            --catalog (Join-Path $repoRootText "docs\data\iphone-vod-catalog.json") `
            --report (Join-Path $repoRootText "docs\data\iphone-vod-catalog-report.json") `
            --detailRoot (Join-Path $repoRootText "docs\data\vod-detail") `
            --includeAdult true `
            --pageSize 100 `
            --sourceConcurrency 2 `
            --pageConcurrency 8 `
            --outputPageSize 500 `
            --fetchRetries 3 `
            --timeoutMs 20000 `
            --appendDetailPages true `
            --skipExistingPages true `
            --keepPartialPages true `
            --refreshLeadingPages 2 `
            --maxNewPagesPerSource 10 `
            --maxFailedPages 20 `
            --detailOnly true
    }

    if (Test-Path -LiteralPath $type3SpiderCatalogScript) {
        Write-Log "Building playable type 3 spider catalog snapshots."
        node $type3SpiderCatalogScript `
            --tvRoot $repoRootText `
            --catalog (Join-Path $repoRootText "docs\data\iphone-vod-catalog.json") `
            --report (Join-Path $repoRootText "docs\data\iphone-vod-catalog-report.json") `
            --detailRoot (Join-Path $repoRootText "docs\data\vod-detail") `
            --maxPagesPerCategory 0 `
            --maxCategoryPageSafetyLimit 200 `
            --fetchRetries 5 `
            --timeoutMs 30000
    }

    if (Test-Path -LiteralPath $assembleChunkedCatalogScript) {
        Write-Log "Assembling compressed source indexes from VOD detail chunks."
        node $assembleChunkedCatalogScript `
            --tvRoot $repoRootText `
            --catalog (Join-Path $repoRootText "docs\data\iphone-vod-catalog.json") `
            --report (Join-Path $repoRootText "docs\data\iphone-vod-catalog-report.json") `
            --detailRoot (Join-Path $repoRootText "docs\data\vod-detail") `
            --indexRoot (Join-Path $repoRootText "docs\data\vod-index") `
            --dropEmptySources true
    }

    if (Test-Path -LiteralPath $applyVodKindRulesScript) {
        Write-Log "Applying persistent VOD category rules to catalog and indexes."
        node $applyVodKindRulesScript --tvRoot $repoRootText --skipDetail true --skipQuantum true
    }

    if (Test-Path -LiteralPath $iphoneLatestScript) {
        Write-Log "Building fast iPhone latest VOD cache."
        node $iphoneLatestScript `
            --tvRoot $repoRootText `
            --catalog (Join-Path $repoRootText "docs\data\iphone-vod-catalog.json") `
            --output (Join-Path $repoRootText "docs\data\iphone-vod-latest.json") `
            --maxItems 3600 `
            --maxItemsPerSource 80
    }

    if (Test-Path -LiteralPath $compactIphoneCatalogScript) {
        Write-Log "Compacting iPhone catalog for fast first paint."
        node $compactIphoneCatalogScript `
            --tvRoot $repoRootText `
            --catalog (Join-Path $repoRootText "docs\data\iphone-vod-catalog.json") `
            --report (Join-Path $repoRootText "docs\data\iphone-vod-catalog-report.json") `
            --detailRoot (Join-Path $repoRootText "docs\data\iphone-detail") `
            --pageSize 240
    }

    if (Test-Path -LiteralPath $tvboxConfigScript) {
        Write-Log "Saving TVBOX on-demand source config."
        node $tvboxConfigScript `
            --repoRoot $repoRootText `
            --output (Join-Path $repoRootText "sources\TVBOX")
    }

    if (Test-Path -LiteralPath $iphoneHealthScript) {
        Write-Log "Checking iPhone VOD names, posters, VOD sources and live sources."
        node $iphoneHealthScript `
            --tvRoot $repoRootText `
            --catalog (Join-Path $repoRootText "docs\data\iphone-vod-catalog.json") `
            --live (Join-Path $repoRootText "docs\data\live-channels.json") `
            --output (Join-Path $repoRootText "docs\data\iphone-health-check-latest.json") `
            --csvOutput (Join-Path $repoRootText "docs\data\iphone-health-check-latest.csv") `
            --timeoutMs 8000 `
            --concurrency 18
    }

    Write-ScheduleSuccess

    $gitAddPaths = @(
        "tools/update-lunatv-vod.ps1",
        "tools/update-lunatv-vod-local.ps1",
        "tools/install-lunatv-vod-autoupdate-task.ps1",
        "tools/build-lunatv-adult18-sorted.mjs",
        "tools/build-iphone-vod-catalog.mjs",
        "tools/build-iphone-vod-latest.mjs",
        "tools/build-full-vod-chunked-catalog.mjs",
        "tools/build-type3-spider-catalog.mjs",
        "tools/vod-payload-parser.mjs",
        "tools/assemble-vod-index-from-detail.mjs",
        "tools/vod-kind-rules.mjs",
        "tools/apply-vod-kind-rules.mjs",
        "tools/compact-iphone-catalog.mjs",
        "tools/build-tvbox-config.mjs",
        "tools/build-tvbox-api-history.mjs",
        "tools/build-iqiyi-full-catalog.mjs",
        "tools/build-quantum-lzi-full.mjs",
        "tools/check-iphone-catalog-health.mjs",
        "sources/current-sources.json",
        "sources/TVBOX",
        "sources/All on-demand sources",
        "sources/All on-demand sources-report.json",
        "sources/vod-lunatv-jin18-oktv.json",
        "sources/vod-lunatv-jin18-report.json",
        "sources/vod-lunatv-jin18-analysis.csv",
        "sources/vod-lunatv-full-oktv.json",
        "sources/vod-lunatv-full-report.json",
        "sources/vod-lunatv-full-analysis.csv",
        "sources/vod-lunatv-adult18-sorted-oktv.json",
        "sources/vod-lunatv-adult18-sorted-report.json",
        "sources/vod-lunatv-adult18-sorted-analysis.csv",
        "docs/data/iphone-vod-catalog.json",
        "docs/data/iphone-vod-catalog-report.json",
        "docs/data/iphone-vod-latest.json",
        "docs/data/vod-sources.json",
        "docs/data/source-summary.json",
        "docs/data/iphone-health-check-latest.json",
        "docs/data/iphone-health-check-latest.csv",
        "docs/data/lunatv-vod-update-state.json",
        "docs/iphone/index.html",
        "docs/assets/source-signal-icon.svg",
        "docs/assets/adult-18-badge.svg",
        ".github/workflows/update-lunatv-vod.yml"
    )
    $existingGitAddPaths = @($gitAddPaths | Where-Object { Test-Path -LiteralPath (Join-Path $repoRootText $_) })
    $missingGitAddPaths = @($gitAddPaths | Where-Object { -not (Test-Path -LiteralPath (Join-Path $repoRootText $_)) })
    if ($missingGitAddPaths.Count -gt 0) {
        Write-Log "Skipping missing git add paths: $($missingGitAddPaths -join ', ')"
    }
    Invoke-Git add -- $existingGitAddPaths
    if ($LASTEXITCODE -ne 0) {
        throw "git add failed with exit code $LASTEXITCODE."
    }

    if (Invoke-Git diff --cached --quiet) {
        Write-Log "No LunaTV VOD source changes to commit."
    } else {
        $message = "Auto refresh LunaTV VOD sources"
        Invoke-Git commit -m $message
        if ($NoGitPush) {
            Write-Log "NoGitPush set; commit created but not pushed."
        } else {
            Write-Log "Pushing update to GitHub."
            Invoke-GitPushWithRetry -Label "main push" -PushCommand {
                Invoke-Git push origin HEAD:main
            } -RecoveryCommand {
                Invoke-Git fetch origin main
                if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
                Invoke-Git rebase origin/main
            }
        }
    }

    Sync-GhPages
    Write-Log "LunaTV VOD update finished."
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    throw
} finally {
    if ($pushedLocation) {
        Pop-Location
    }
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
