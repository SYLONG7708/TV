param(
    [string]$TaskName = "OKTV LunaTV VOD Auto Update",
    [string]$RepoRoot = "",
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

$actionArgs = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}" -SourceName "jin18,full"' -f $scriptPath, $RepoRoot
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn),
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650))
)
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 60)
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $triggers `
    -Settings $settings `
    -Principal $principal `
    -Description "Refresh OKTV LunaTV VOD, iPhone catalog, poster/name checks and live checks at startup/logon and every hour, then push to GitHub." `
    -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Repo: $RepoRoot"
Write-Host "Script: $scriptPath"

if ($RunNow) {
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Started scheduled task now."
}
