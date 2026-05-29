param(
    [string]$RepoRoot = "",
    [int]$MaxHeight = 480,
    [int]$IntervalSafeMinutes = 120,
    [switch]$NoGitPush
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
    $RepoRoot = Resolve-Path $RepoRoot
}

$logDir = Join-Path $RepoRoot ".patch-work"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir "youtube-live-local-update.log"
$lockPath = Join-Path $logDir "youtube-live-local-update.lock"

function Write-Log([string]$Message) {
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
    $line | Tee-Object -FilePath $logPath -Append
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
        git pull --ff-only origin main
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
        "-MinSegmentKbps", "600",
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

    $reportPath = Join-Path $RepoRoot "sources\live-youtube-report.json"
    if (Test-Path -LiteralPath $reportPath) {
        $report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json
        Write-Log "Playlist entries: $($report.playlistEntries) / $($report.total); HLS success: $($report.hlsSuccessRate)%; min speed: $($report.minSegmentKbps) kbps."
    }

    git add sources/live-stable.txt sources/live-youtube-stable.txt sources/live-youtube-report.json sources/live-stability-report.json sources/live-verified-only.txt sources/live-cleaned-backup.txt
    if (git diff --cached --quiet) {
        Write-Log "No source changes to commit."
    } else {
        $message = "Auto refresh playable YouTube live sources"
        git commit -m $message
        if ($NoGitPush) {
            Write-Log "NoGitPush set; commit created but not pushed."
        } else {
            Write-Log "Pushing update to GitHub."
            git push origin main
        }
    }

    Write-Log "Update finished."
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    throw
} finally {
    Pop-Location
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
