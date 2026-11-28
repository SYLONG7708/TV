param(
    [string]$TaskName = "OKTV TVBOX VOD Auto Update",
    [string]$RepoRoot = "",
    [int]$AtHour = 2,
    [switch]$RunNow
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
    $RepoRoot = Resolve-Path $RepoRoot
}

$scriptPath = Join-Path $RepoRoot "tools\update-tvbox-vod-detail-local.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Local TVBOX VOD updater script not found: $scriptPath"
}

$actionArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}" -UpdateIntervalDays 1 -CheckUpstreamFreshness 1 -MaxFailedPagesPerSource 120' -f $scriptPath, $RepoRoot
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs
$triggerAt = $null
$statePath = Join-Path $RepoRoot "docs\data\tvbox-vod-update-state.json"
if (Test-Path -LiteralPath $statePath) {
    try {
        $state = Get-Content -LiteralPath $statePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($state.nextDueAt) {
            $stateNextDueAt = [DateTimeOffset]::Parse([string]$state.nextDueAt).LocalDateTime
            if ($stateNextDueAt -gt (Get-Date)) {
                $triggerAt = $stateNextDueAt
            }
        }
    } catch {
        Write-Warning "Could not read nextDueAt from ${statePath}: $($_.Exception.Message)"
    }
}
if ($null -eq $triggerAt) {
    $triggerAt = (Get-Date).Date.AddHours($AtHour)
    if ($triggerAt -le (Get-Date)) {
        $triggerAt = $triggerAt.AddDays(1)
    }
}
$triggers = @(
    (New-ScheduledTaskTrigger -Daily -At $triggerAt),
    (New-ScheduledTaskTrigger -AtStartup)
)
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 12)
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description "Check and continue the full OKTV TVBOX VOD page archive at startup and every day at 02:00, or sooner when upstream VOD update dates are newer. Existing VOD detail pages are reused; missing/new pages are saved without duplicating old page files." `
    -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Repo: $RepoRoot"
Write-Host "Script: $scriptPath"
Write-Host "Trigger: startup check and every day at $($triggerAt.ToString("HH:mm")); upstream VOD date changes also trigger an update"

if ($RunNow) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Started scheduled task now."
}
