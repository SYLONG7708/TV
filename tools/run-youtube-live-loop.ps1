[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [int]$IntervalMinutes = 180
)

$ErrorActionPreference = 'Stop'
if ($IntervalMinutes -lt 15) { throw 'IntervalMinutes must be at least 15.' }
$repo = (Resolve-Path -LiteralPath $RepoRoot).Path
$stateDir = Join-Path $repo '.patch-work'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$lockPath = Join-Path $stateDir 'youtube-live-loop.lock'
$loopLog = Join-Path $stateDir 'youtube-live-loop.log'
$statusPath = Join-Path $stateDir 'youtube-live-managed-status.json'
$lock = $null
try {
  $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch [IO.IOException] {
  exit 0
}

try {
  while ($true) {
    $waitMinutes = $IntervalMinutes
    try {
      Add-Content -LiteralPath $loopLog -Value "$(Get-Date -Format o) Starting local HLS refresh."
      & (Join-Path $repo 'tools\run-youtube-live-managed.ps1') -RepoRoot $repo
      if (Test-Path -LiteralPath $statusPath) {
        $status = Get-Content -LiteralPath $statusPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($status.state -in @('error', 'deferred')) { $waitMinutes = 15 }
        Add-Content -LiteralPath $loopLog -Value "$(Get-Date -Format o) Result: $($status.state); retry in $waitMinutes minutes."
      }
    } catch {
      $waitMinutes = 15
      Add-Content -LiteralPath $loopLog -Value "$(Get-Date -Format o) Error: $($_.Exception.Message); retry in 15 minutes."
    }
    Start-Sleep -Seconds ($waitMinutes * 60)
  }
} finally {
  $lock.Dispose()
}
