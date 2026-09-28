param(
    [string]$TaskName = "OKTV YouTube Live Local HLS",
    [string]$RepoRoot = "",
    [switch]$RunNow
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
} else {
    $RepoRoot = Resolve-Path $RepoRoot
}

$scriptPath = Join-Path $RepoRoot "tools\run-youtube-live-managed.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
    throw "Local updater script not found: $scriptPath"
}

$actionArgs = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}"' -f $scriptPath, $RepoRoot
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs -WorkingDirectory $RepoRoot
$triggers = @(
    (New-ScheduledTaskTrigger -AtLogOn),
    (New-ScheduledTaskTrigger -AtStartup),
    (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 3) -RepetitionDuration (New-TimeSpan -Days 3650))
)
$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -Hidden `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 120)
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $triggers `
        -Settings $settings `
        -Principal $principal `
        -Description "Refresh OKTV YouTube HLS live URLs at startup/logon and every 3 hours, then push playable sources to GitHub." `
        -Force | Out-Null
    Write-Host "Registered hidden scheduled task: $TaskName"
    if ($RunNow) { Start-ScheduledTask -TaskName $TaskName }
} catch {
    if ($_.Exception.Message -notmatch 'Access is denied|拒絕存取') { throw }
    $loopPath = Join-Path $RepoRoot 'tools\run-youtube-live-loop.ps1'
    if (-not (Test-Path -LiteralPath $loopPath)) { throw "Local loop script not found: $loopPath" }
    $startupDir = [Environment]::GetFolderPath('Startup')
    if ([string]::IsNullOrWhiteSpace($startupDir)) { throw 'Windows Startup folder is unavailable.' }
    $launcherPath = Join-Path $startupDir 'OKTV YouTube Live Local HLS.vbs'
    $command = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -RepoRoot "{1}"' -f $loopPath, $RepoRoot
    $escaped = $command.Replace('"', '""')
    $launcher = 'CreateObject("WScript.Shell").Run "' + $escaped + '", 0, False'
    [IO.File]::WriteAllText($launcherPath, $launcher + "`r`n", [Text.Encoding]::ASCII)
    Write-Host "Task Scheduler access was denied; installed hidden Startup launcher: $launcherPath"
    if ($RunNow) {
        Start-Process -FilePath 'wscript.exe' -ArgumentList ('"{0}"' -f $launcherPath) -WindowStyle Hidden
        Write-Host 'Started the hidden local HLS refresh loop.'
    }
}

Write-Host "Repo: $RepoRoot"
Write-Host "Script: $scriptPath"
