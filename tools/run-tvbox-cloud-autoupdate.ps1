param(
    [string]$RepoRoot = "",
    [string]$PagesRoot = "C:\Users\Administrator\TV-gh-pages",
    [string]$AndroidProject = "",
    [int]$UpdateIntervalDays = 1,
    [switch]$ForceUpdate,
    [switch]$SkipGitPush,
    [switch]$SkipApkBuild
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
    $RepoRoot = Resolve-Path $RepoRoot
}
$RepoRoot = [string]$RepoRoot
$PagesRoot = [string](Resolve-Path $PagesRoot)
$logDir = Join-Path $RepoRoot "logs"
$logPath = Join-Path $logDir "tvbox-cloud-autoupdate.log"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Write-Log([string]$Message) {
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
    $line | Tee-Object -FilePath $logPath -Append | Out-Null
}

function Invoke-Step([string]$Label, [scriptblock]$Body) {
    Write-Log $Label
    $global:LASTEXITCODE = 0
    & $Body
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE"
    }
}

function Copy-IfExists([string]$Source, [string]$Destination) {
    if (-not (Test-Path -LiteralPath $Source)) { return }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Destination) | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

function Invoke-Git([string]$WorkingDirectory, [string[]]$Arguments) {
    Push-Location $WorkingDirectory
    try {
        & git @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE in $WorkingDirectory"
        }
    } finally {
        Pop-Location
    }
}

function Test-GitWorkTree([string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & git rev-parse --is-inside-work-tree *> $null
        return $LASTEXITCODE -eq 0
    } finally {
        Pop-Location
    }
}

function Test-GitHasStagedChanges([string]$WorkingDirectory) {
    Push-Location $WorkingDirectory
    try {
        & git diff --cached --quiet
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0) { return $false }
        if ($exitCode -eq 1) { return $true }
        throw "git diff --cached --quiet failed with exit code $exitCode in $WorkingDirectory"
    } finally {
        Pop-Location
    }
}

function Resolve-AndroidProjectPath([string]$ProjectPath) {
    if (-not [string]::IsNullOrWhiteSpace($ProjectPath)) {
        $resolved = Resolve-Path -LiteralPath $ProjectPath
        return [string]$resolved
    }

    $desktop = [Environment]::GetFolderPath("Desktop")
    $matches = Get-ChildItem -LiteralPath $desktop -Directory -Recurse -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -like "*OKTV_TVBOX*" -and
            $_.FullName -like "*20260608*" -and
            (Test-Path -LiteralPath (Join-Path $_.FullName "gradlew.bat")) -and
            (Test-Path -LiteralPath (Join-Path $_.FullName "app\build.gradle"))
        } |
        Sort-Object LastWriteTime -Descending

    if (-not $matches -or $matches.Count -lt 1) {
        throw "Android project was not found under Desktop. Pass -AndroidProject with the project path."
    }

    return [string]$matches[0].FullName
}

try {
    Write-Log "Starting OKTV TVBOX cloud auto update. Repo=$RepoRoot Pages=$PagesRoot"

    $updateParams = @{
        RepoRoot = $RepoRoot
        UpdateIntervalDays = $UpdateIntervalDays
        CheckUpstreamFreshness = $true
        MaxFailedPagesPerSource = 120
    }
    if ($ForceUpdate) { $updateParams.ForceUpdate = $true }
    Invoke-Step "Updating TVBOX VOD archive" {
        & (Join-Path $RepoRoot "tools\update-tvbox-vod-detail-local.ps1") @updateParams
    }

    Invoke-Step "Building lean VOD search indexes" {
        & node (Join-Path $RepoRoot "tools\build-vod-search-indexes.mjs") `
            --repoRoot $RepoRoot `
            --catalog (Join-Path $RepoRoot "docs\data\tvbox-vod-catalog.json") `
            --indexRoot (Join-Path $RepoRoot "docs\data\vod-index") `
            --outputRoot (Join-Path $RepoRoot "docs\data\vod-search") `
            --report (Join-Path $RepoRoot "docs\data\vod-search-report.json") `
            --updateCatalog true
    }

    Invoke-Step "Syncing iPhone lean catalog search paths" {
        & node (Join-Path $RepoRoot "tools\sync-iphone-lean-catalog.mjs") `
            --repoRoot $RepoRoot `
            --pagesRoot $RepoRoot `
            --sourceCatalog "docs/data/tvbox-vod-catalog.json" `
            --iphoneCatalog "docs/data/iphone-vod-catalog.json" `
            --pagesTvboxCatalog "docs/data/tvbox-vod-catalog.json"
        & node (Join-Path $RepoRoot "tools\sync-iphone-lean-catalog.mjs") `
            --repoRoot $RepoRoot `
            --pagesRoot $PagesRoot `
            --sourceCatalog "docs/data/tvbox-vod-catalog.json" `
            --iphoneCatalog "docs/data/iphone-vod-catalog.json" `
            --pagesTvboxCatalog "docs/data/tvbox-vod-catalog.json"
    }

    foreach ($relative in @(
        "docs\iphone\index.html",
        "docs\data\iphone-vod-catalog.json",
        "docs\data\iphone-vod-catalog-report.json",
        "docs\data\iphone-health-check-latest.json",
        "docs\data\iphone-health-check-latest.csv",
        "docs\data\tvbox-vod-catalog.json",
        "docs\data\tvbox-vod-catalog-report.json",
        "docs\data\tvbox-playback-check-latest.json",
        "docs\data\tvbox-playback-check-latest.csv",
        "docs\data\tvbox-source-latest.json",
        "sources\TVBOX"
    )) {
        Copy-IfExists (Join-Path $RepoRoot $relative) (Join-Path $PagesRoot $relative)
    }

    $apkName = "OKTV_TVBOX_CarAndroid_WebView_fullsearch_perf_20260618.apk"
    if (-not $SkipApkBuild) {
        $AndroidProject = Resolve-AndroidProjectPath $AndroidProject
        Invoke-Step "Building Android APK" {
            Push-Location $AndroidProject
            try {
                & .\gradlew.bat assembleRelease
            } finally {
                Pop-Location
            }
        }
        $builtApk = Join-Path $AndroidProject "app\build\outputs\apk\release\app-release.apk"
        Copy-IfExists $builtApk (Join-Path $RepoRoot "releases\$apkName")
        Copy-IfExists $builtApk (Join-Path $PagesRoot "releases\$apkName")
    }

    $state = [ordered]@{
        status = "success"
        finishedAt = (Get-Date).ToString("o")
        repoRoot = $RepoRoot
        pagesRoot = $PagesRoot
        intervalDays = $UpdateIntervalDays
        apk = "releases/$apkName"
        script = "tools/run-tvbox-cloud-autoupdate.ps1"
    }
    [IO.File]::WriteAllText((Join-Path $RepoRoot "docs\data\tvbox-cloud-autoupdate-state.json"), (($state | ConvertTo-Json -Depth 4) + "`n"), $utf8NoBom)

    if (-not $SkipGitPush) {
        if (-not (Test-GitWorkTree $RepoRoot)) {
            throw "RepoRoot is not a git worktree: $RepoRoot"
        }
        Invoke-Git $RepoRoot @("add", "docs", "sources", "tools", "releases")
        if (Test-GitHasStagedChanges $RepoRoot) {
            Invoke-Git $RepoRoot @("commit", "-m", "Refresh TVBOX search indexes and car APK")
            Invoke-Git $RepoRoot @("push", "origin", "HEAD:main")
        } else {
            Write-Log "No main-branch changes to commit."
        }

        if (-not (Test-GitWorkTree $PagesRoot)) {
            throw "PagesRoot is not a git worktree: $PagesRoot"
        }
        Invoke-Git $PagesRoot @("add", "docs", "sources", "releases")
        if (Test-GitHasStagedChanges $PagesRoot) {
            Invoke-Git $PagesRoot @("commit", "-m", "Publish iPhone performance search update")
            Invoke-Git $PagesRoot @("push", "origin", "gh-pages")
        } else {
            Write-Log "No gh-pages changes to commit."
        }
    }

    Write-Log "OKTV TVBOX cloud auto update finished."
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    throw
}
