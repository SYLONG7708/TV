param(
    [string]$RepoRoot = "",
    [string]$PagesRoot = "",
    [int]$MaxHeight = 1080,
    [int]$IntervalSafeMinutes = 120,
    [switch]$NoGitPush,
    [switch]$NoGhPagesPush
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
    $RepoRoot = Resolve-Path $RepoRoot
}

$RepoRootText = [string]$RepoRoot
if ([string]::IsNullOrWhiteSpace($PagesRoot)) {
    $PagesRoot = Join-Path (Split-Path -Parent $RepoRootText) "TV-gh-pages"
}
$PagesRootText = [string]$PagesRoot
$logDir = Join-Path $RepoRoot ".patch-work"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir "youtube-live-local-update.log"
$lockPath = Join-Path $logDir "youtube-live-local-update.lock"

function Write-Log([string]$Message) {
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
    $line | Tee-Object -FilePath $logPath -Append
}

function Invoke-GitChecked {
    param([string[]]$Arguments)

    git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

function Invoke-GitPushWithRetry {
    param(
        [string]$Branch,
        [string]$Label
    )

    for ($attempt = 1; $attempt -le 3; $attempt++) {
        git push origin "HEAD:$Branch"
        if ($LASTEXITCODE -eq 0) {
            return
        }

        Write-Log "$Label failed on attempt $attempt; rebasing with autostash before retry."
        git status --short | ForEach-Object { Write-Log $_ }
        Invoke-GitChecked @("pull", "--rebase", "--autostash", "origin", $Branch)
        git status --short | ForEach-Object { Write-Log $_ }
        Start-Sleep -Seconds (20 * $attempt)
    }

    throw "$Label failed after 3 attempts."
}

function Sync-GhPagesLiveData {
    $liveJson = Join-Path $RepoRootText "docs\data\live-channels.json"
    $summaryJson = Join-Path $RepoRootText "docs\data\source-summary.json"
    if (-not (Test-Path -LiteralPath $liveJson)) {
        Write-Log "Live JSON not found; skipping gh-pages sync: $liveJson"
        return
    }

    if (-not (Test-Path -LiteralPath (Join-Path $PagesRootText ".git"))) {
        if (Test-Path -LiteralPath $PagesRootText) {
            Write-Log "Pages path exists but is not a git worktree; skipping gh-pages sync: $PagesRootText"
            return
        }
        Write-Log "Creating gh-pages worktree: $PagesRootText"
        Invoke-GitChecked @("fetch", "origin", "gh-pages")
        Invoke-GitChecked @("worktree", "add", $PagesRootText, "origin/gh-pages")
    }

    Write-Log "Syncing live JSON to gh-pages."
    Push-Location $PagesRootText
    try {
        try {
            git config user.name | Out-Null
        } catch {
            git config user.name "OKTV local updater"
        }
        try {
            git config user.email | Out-Null
        } catch {
            git config user.email "oktv-local-updater@example.local"
        }

        Invoke-GitChecked @("pull", "--ff-only", "origin", "gh-pages")
        New-Item -ItemType Directory -Force -Path (Join-Path $PagesRootText "docs\data") | Out-Null
        Copy-Item -LiteralPath $liveJson -Destination (Join-Path $PagesRootText "docs\data\live-channels.json") -Force
        if (Test-Path -LiteralPath $summaryJson) {
            Copy-Item -LiteralPath $summaryJson -Destination (Join-Path $PagesRootText "docs\data\source-summary.json") -Force
        }
        git add docs/data/live-channels.json docs/data/source-summary.json
        if (git diff --cached --quiet) {
            Write-Log "No gh-pages live data changes to commit."
        } else {
            git commit -m "Publish refreshed live data"
            if ($NoGhPagesPush -or $NoGitPush) {
                Write-Log "Push disabled; gh-pages live data commit created locally."
            } else {
                Invoke-GitPushWithRetry -Branch "gh-pages" -Label "gh-pages live data push"
            }
        }
    } finally {
        Pop-Location
    }
}

if (Test-Path -LiteralPath $lockPath) {
    $age = (Get-Date) - (Get-Item -LiteralPath $lockPath).LastWriteTime
    if ($age.TotalMinutes -lt 45) {
        Write-Log "Another update appears to be running. Lock age: $([int]$age.TotalMinutes) minutes."
        exit 0
    }
}

Set-Content -LiteralPath $lockPath -Value ([DateTime]::Now.ToString("o")) -Encoding UTF8
try {
    Write-Log "Starting OKTV YouTube live update. Repo: $RepoRoot"
    Push-Location $RepoRoot

    try {
        git config user.name | Out-Null
    } catch {
        git config user.name "OKTV local updater"
    }
    try {
        git config user.email | Out-Null
    } catch {
        git config user.email "oktv-local-updater@example.local"
    }

    $statusBefore = git status --porcelain
    if ($statusBefore) {
        Write-Log "Working tree has existing changes; continuing without pull to avoid overwriting local work."
    } else {
        Write-Log "Pulling latest main."
        Invoke-GitChecked @("pull", "--ff-only", "origin", "main")
    }

    $updateScript = Join-Path $RepoRoot "tools\update-youtube-live.ps1"
    $args = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", $updateScript,
        "-DownloadYtDlp",
        "-IncludeOriginalOnFailure",
        "-MaxHeight", [string]$MaxHeight,
        "-SocketTimeoutSec", "10",
        "-ProcessTimeoutSec", "25",
        "-StreamValidationTimeoutSec", "15",
        "-SegmentProbeBytes", "262144",
        "-MinSegmentBytes", "65536",
        "-MinSegmentKbps", "900",
        "-MinPlaylistEntries", "10",
        "-RetryCount", "1"
    )

    $cookieFile = Join-Path $RepoRoot "youtube-cookies.txt"
    if (Test-Path -LiteralPath $cookieFile) {
        Write-Log "Using local youtube-cookies.txt."
        $args += @("-CookiesFile", $cookieFile)
    } else {
        Write-Log "No local youtube-cookies.txt found; using public YouTube extraction only."
    }

    Write-Log "Resolving and validating YouTube HLS sources."
    powershell @args

    $buildLiveScript = Join-Path $RepoRoot "tools\build-live-channels-json.mjs"
    if (Test-Path -LiteralPath $buildLiveScript) {
        Write-Log "Rebuilding public live JSON from sources/live-stable.txt."
        node $buildLiveScript `
            --tvRoot $RepoRoot `
            --input (Join-Path $RepoRoot "sources\live-stable.txt") `
            --output (Join-Path $RepoRoot "docs\data\live-channels.json") `
            --summary (Join-Path $RepoRoot "docs\data\source-summary.json") `
            --minValidSeconds 600
    }

    $reportPath = Join-Path $RepoRoot "sources\live-youtube-report.json"
    if (Test-Path -LiteralPath $reportPath) {
        $report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Log "Playlist entries: $($report.playlistEntries) / $($report.total); HLS success: $($report.hlsSuccessRate)%; min speed: $($report.minSegmentKbps) kbps."
    }

    git add sources/live-stable.txt sources/live-youtube-stable.txt sources/live-youtube-report.json sources/live-stability-report.json sources/live-verified-only.txt sources/live-cleaned-backup.txt docs/data/live-channels.json docs/data/source-summary.json tools/build-live-channels-json.mjs tools/update-youtube-live-local.ps1 .github/workflows/update-youtube-live.yml
    if (git diff --cached --quiet) {
        Write-Log "No source changes to commit."
    } else {
        $message = "Auto refresh playable YouTube live sources"
        git commit -m $message
        if ($NoGitPush) {
            Write-Log "NoGitPush set; commit created but not pushed."
        } else {
            Write-Log "Pushing update to GitHub."
            Invoke-GitPushWithRetry -Branch "main" -Label "main live data push"
        }
    }

    Sync-GhPagesLiveData
    Write-Log "Update finished."
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    throw
} finally {
    Pop-Location
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
