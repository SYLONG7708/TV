param(
    [string]$TaskName = "OKTV YouTube Live Auto Update",
    [string]$RepoRoot = "",
    [switch]$RunNow
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
    $RepoRoot = Resolve-Path $RepoRoot
}

$scriptPath = Join-Path $RepoRoot "tools\update-youtube-live-local.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Local updater script not found: $scriptPath"
}

$actionArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}"' -f $scriptPath, $RepoRoot
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn),
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 2) -RepetitionDuration (New-TimeSpan -Days 3650))
)
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description "Refresh OKTV YouTube HLS live URLs at startup/logon and every 2 hours, then push playable sources to GitHub." `
    -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Repo: $RepoRoot"
Write-Host "Script: $scriptPath"

if ($RunNow) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Started scheduled task now."
}
