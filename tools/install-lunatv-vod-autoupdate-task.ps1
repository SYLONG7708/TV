param(
    [string]$TaskName = "OKTV LunaTV VOD Auto Update",
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

$scriptPath = Join-Path $RepoRoot "tools\update-lunatv-vod-local.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Local updater script not found: $scriptPath"
}

$actionArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}" -SourceName "jin18,full" -UpdateIntervalDays 1' -f $scriptPath, $RepoRoot
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs
$triggerAt = (Get-Date).Date.AddHours($AtHour)
if ($triggerAt -le (Get-Date)) {
    $triggerAt = $triggerAt.AddDays(1)
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
    -ExecutionTimeLimit (New-TimeSpan -Minutes 240)
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description "Check OKTV LunaTV VOD sources at startup and daily at 02:00; refresh daily after the last successful update, and retry on the next trigger if the update fails." `
    -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Repo: $RepoRoot"
Write-Host "Script: $scriptPath"
Write-Host "Trigger: startup and daily at $($triggerAt.ToString("HH:mm")) with daily success gate"

if ($RunNow) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Started scheduled task now."
}
