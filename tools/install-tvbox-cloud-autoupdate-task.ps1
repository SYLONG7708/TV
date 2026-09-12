param(
    [string]$TaskName = "OKTV TVBOX Cloud Auto Update",
    [string]$RepoRoot = "",
    [string]$PagesRoot = "C:\Users\Administrator\TV-gh-pages",
    [int]$AtHour = 2,
    [switch]$RunNow
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
    $RepoRoot = Resolve-Path $RepoRoot
}
$RepoRoot = [string]$RepoRoot
$scriptPath = Join-Path $RepoRoot "tools\run-tvbox-cloud-autoupdate.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Auto update script not found: $scriptPath"
}

$triggerAt = (Get-Date).Date.AddHours($AtHour)
if ($triggerAt -le (Get-Date)) {
    $triggerAt = $triggerAt.AddDays(1)
}

$actionArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}" -PagesRoot "{2}" -UpdateIntervalDays 1' -f $scriptPath, $RepoRoot, $PagesRoot
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs
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
$principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description "Every day at 02:00 and at startup: refresh OKTV TVBOX VOD data, rebuild lean iPhone search indexes, rebuild car Android APK, and push main/gh-pages to GitHub." `
    -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Script: $scriptPath"
Write-Host "Trigger: startup and every day at $($triggerAt.ToString("HH:mm"))"

if ($RunNow) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Started scheduled task now."
}
