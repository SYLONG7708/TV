[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RepositoryRoot,

  [Parameter(Mandatory = $true)]
  [string]$Branch,

  [string]$Commit = 'HEAD',
  [string]$RemoteName = 'origin',
  [int]$PushAttempts = 3,
  [int]$RetryDelaySeconds = 15
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($PushAttempts -lt 1) { throw 'PushAttempts must be at least 1.' }
$repo = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$targetRef = "refs/heads/$Branch"

function Invoke-GitChecked {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $stderrPath = Join-Path ([IO.Path]::GetTempPath()) ("oktv-git-stderr-" + [guid]::NewGuid().ToString('N'))
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $stdout = @(& git -C $repo @Arguments 2> $stderrPath)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
    $stderr = if (Test-Path -LiteralPath $stderrPath) { @(Get-Content -LiteralPath $stderrPath) } else { @() }
    if (Test-Path -LiteralPath $stderrPath) { Remove-Item -LiteralPath $stderrPath -Force }
  }
  $lines = @($stdout) + @($stderr)
  $lines | ForEach-Object { Write-Host $_ }
  if ($exitCode -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $exitCode."
  }
  return $lines
}

function Get-GitValue {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $lines = @(Invoke-GitChecked -Arguments $Arguments)
  return ([string]($lines | Select-Object -Last 1)).Trim()
}

function Invoke-Push {
  param([Parameter(Mandatory = $true)][string]$Sha)
  $stderrPath = Join-Path ([IO.Path]::GetTempPath()) ("oktv-git-stderr-" + [guid]::NewGuid().ToString('N'))
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $stdout = @(& git -C $repo push $RemoteName "$Sha`:$targetRef" 2> $stderrPath)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
    $stderr = if (Test-Path -LiteralPath $stderrPath) { @(Get-Content -LiteralPath $stderrPath) } else { @() }
    if (Test-Path -LiteralPath $stderrPath) { Remove-Item -LiteralPath $stderrPath -Force }
  }
  $lines = @($stdout) + @($stderr)
  $lines | ForEach-Object { Write-Host $_ }
  return [pscustomobject]@{
    ExitCode = $exitCode
    Text = ($lines -join "`n")
  }
}

$candidate = Get-GitValue -Arguments @('rev-parse', $Commit)
for ($attempt = 1; $attempt -le $PushAttempts; $attempt++) {
  $push = Invoke-Push -Sha $candidate
  if ($push.ExitCode -eq 0) {
    Write-Host "Pushed $candidate to $RemoteName/$Branch on attempt $attempt."
    return
  }

  if ($push.Text -match '(?i)above its size quota|repository size quota|pre-receive hook declined.*size|large files detected') {
    Write-Host '::error title=GitHub repository storage quota exceeded::Push is blocked by the repository size quota. Compact generated history or contact GitHub Support; retrying cannot repair this condition.'
    throw 'GitHub repository storage quota exceeded (terminal push error).'
  }
  if ($push.Text -match '(?i)permission denied|authentication failed|write access.*not granted|403.*forbidden') {
    Write-Host '::error title=GitHub write permission failed::The workflow token cannot update the target branch.'
    throw 'GitHub write permission failed (terminal push error).'
  }
  if ($attempt -ge $PushAttempts) { break }

  Invoke-GitChecked -Arguments @('fetch', $RemoteName, $Branch)
  $remoteHead = Get-GitValue -Arguments @('rev-parse', "$RemoteName/$Branch")
  & git -C $repo merge-base --is-ancestor $candidate $remoteHead
  if ($LASTEXITCODE -eq 0) {
    Write-Host "Remote $Branch already contains $candidate."
    return
  }

  $stderrPath = Join-Path ([IO.Path]::GetTempPath()) ("oktv-git-stderr-" + [guid]::NewGuid().ToString('N'))
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $mergeStdout = @(& git -C $repo merge-tree --write-tree $remoteHead $candidate 2> $stderrPath)
    $mergeExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
    $mergeStderr = if (Test-Path -LiteralPath $stderrPath) { @(Get-Content -LiteralPath $stderrPath) } else { @() }
    if (Test-Path -LiteralPath $stderrPath) { Remove-Item -LiteralPath $stderrPath -Force }
  }
  $mergeOutput = @($mergeStdout) + @($mergeStderr)
  $mergeOutput | ForEach-Object { Write-Host $_ }
  if ($mergeExit -ne 0) {
    Write-Host '::error title=Concurrent update conflict::Automatic tree merge was not clean. The next scheduled run will rebuild from the latest branch instead of overwriting either update.'
    throw 'Concurrent branch update could not be merged safely.'
  }
  $tree = ([string]($mergeOutput | Select-Object -First 1)).Trim()
  if ($tree -notmatch '^[0-9a-f]{40,64}$') { throw "merge-tree did not return a tree object: $tree" }
  $message = "Merge concurrent automation update for $Branch"
  $stderrPath = Join-Path ([IO.Path]::GetTempPath()) ("oktv-git-stderr-" + [guid]::NewGuid().ToString('N'))
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $commitStdout = @($message | & git -C $repo commit-tree $tree -p $remoteHead -p $candidate 2> $stderrPath)
    $commitExit = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
    $commitStderr = if (Test-Path -LiteralPath $stderrPath) { @(Get-Content -LiteralPath $stderrPath) } else { @() }
    if (Test-Path -LiteralPath $stderrPath) { Remove-Item -LiteralPath $stderrPath -Force }
  }
  $commitOutput = @($commitStdout) + @($commitStderr)
  $commitOutput | ForEach-Object { Write-Host $_ }
  if ($commitExit -ne 0) { throw 'Unable to create the automatic merge commit.' }
  $candidate = ([string]($commitOutput | Select-Object -Last 1)).Trim()
  if ($candidate -notmatch '^[0-9a-f]{40,64}$') { throw "commit-tree did not return a commit object: $candidate" }
  Start-Sleep -Seconds ($RetryDelaySeconds * $attempt)
}

throw "Push to $RemoteName/$Branch failed after $PushAttempts attempts."
