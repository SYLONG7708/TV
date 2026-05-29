param(
    [string]$RepoRoot = "",
    [string]$SourceName = "jin18,full",
    [int]$TimeoutSec = 12,
    [int]$MaxDetailProbe = 3,
    [switch]$NoGitPush
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
$logDir = Join-Path $repoRootText ".patch-work"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir "lunatv-vod-local-update.log"
$lockPath = Join-Path $logDir "lunatv-vod-local-update.lock"

function Write-Log([string]$Message) {
    $line = "{0} {1}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"), $Message
    $line | Tee-Object -FilePath $logPath -Append
}

function Invoke-Git {
    git -c "safe.directory=$safeDir" @args
}

if (Test-Path -LiteralPath $lockPath) {
    $age = (Get-Date) - (Get-Item -LiteralPath $lockPath).LastWriteTime
    if ($age.TotalMinutes -lt 60) {
        Write-Log "Another LunaTV update appears to be running. Lock age: $([int]$age.TotalMinutes) minutes."
        exit 0
    }
}

Set-Content -LiteralPath $lockPath -Value ([DateTime]::Now.ToString("o")) -Encoding UTF8
try {
    Write-Log "Starting LunaTV VOD update. Repo: $repoRootText"
    Push-Location $repoRootText

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

    $statusBefore = Invoke-Git status --porcelain
    if ($statusBefore) {
        Write-Log "Working tree has existing changes; continuing without pull to avoid overwriting local work."
    } else {
        Write-Log "Pulling latest main."
        Invoke-Git pull --ff-only origin main
    }

    $updateScript = Join-Path $repoRootText "tools\update-lunatv-vod.ps1"
    $adultSortScript = Join-Path $repoRootText "tools\build-lunatv-adult18-sorted.mjs"
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

    Invoke-Git add `
        "tools/update-lunatv-vod.ps1" `
        "tools/update-lunatv-vod-local.ps1" `
        "tools/install-lunatv-vod-autoupdate-task.ps1" `
        "tools/build-lunatv-adult18-sorted.mjs" `
        "sources/current-sources.json" `
        "sources/vod-lunatv-jin18-oktv.json" `
        "sources/vod-lunatv-jin18-report.json" `
        "sources/vod-lunatv-jin18-analysis.csv" `
        "sources/vod-lunatv-full-oktv.json" `
        "sources/vod-lunatv-full-report.json" `
        "sources/vod-lunatv-full-analysis.csv" `
        "sources/vod-lunatv-adult18-sorted-oktv.json" `
        "sources/vod-lunatv-adult18-sorted-report.json" `
        "sources/vod-lunatv-adult18-sorted-analysis.csv" `
        ".github/workflows/update-lunatv-vod.yml"

    if (Invoke-Git diff --cached --quiet) {
        Write-Log "No LunaTV VOD source changes to commit."
    } else {
        $message = "Auto refresh LunaTV VOD sources"
        Invoke-Git commit -m $message
        if ($NoGitPush) {
            Write-Log "NoGitPush set; commit created but not pushed."
        } else {
            Write-Log "Pushing update to GitHub."
            Invoke-Git push origin main
        }
    }

    Write-Log "LunaTV VOD update finished."
} catch {
    Write-Log "ERROR: $($_.Exception.Message)"
    throw
} finally {
    Pop-Location
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
}
