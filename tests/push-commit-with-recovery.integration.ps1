[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ("oktv-push-recovery-test-" + [guid]::NewGuid().ToString('N'))
$script = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\tools\push-commit-with-recovery.ps1')).Path
$failure = $null

function Invoke-TestGit([string]$repository, [string[]]$arguments) {
  & git -C $repository @arguments | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "git $($arguments -join ' ') failed." }
}

try {
  $remote = Join-Path $root 'remote.git'
  $first = Join-Path $root 'first'
  $second = Join-Path $root 'second'
  $null = New-Item -ItemType Directory -Force -Path $root
  & git init --bare $remote | Out-Host
  & git init -b main $first | Out-Host
  Invoke-TestGit $first @('config', 'user.name', 'test')
  Invoke-TestGit $first @('config', 'user.email', 'test@example.invalid')
  [IO.File]::WriteAllText((Join-Path $first 'base.txt'), 'base')
  Invoke-TestGit $first @('add', '.')
  Invoke-TestGit $first @('commit', '-m', 'base')
  Invoke-TestGit $first @('remote', 'add', 'origin', $remote)
  Invoke-TestGit $first @('push', '-u', 'origin', 'main')
  & git clone --branch main $remote $second | Out-Host
  Invoke-TestGit $second @('config', 'user.name', 'test')
  Invoke-TestGit $second @('config', 'user.email', 'test@example.invalid')

  [IO.File]::WriteAllText((Join-Path $first 'remote.txt'), 'remote')
  Invoke-TestGit $first @('add', 'remote.txt')
  Invoke-TestGit $first @('commit', '-m', 'remote update')
  Invoke-TestGit $first @('push')

  [IO.File]::WriteAllText((Join-Path $second 'local.txt'), 'local')
  Invoke-TestGit $second @('add', 'local.txt')
  Invoke-TestGit $second @('commit', '-m', 'local update')
  & $script -RepositoryRoot $second -Branch main -PushAttempts 2 -RetryDelaySeconds 0
  if ($LASTEXITCODE -ne 0) { throw "Push recovery exited with $LASTEXITCODE." }

  Invoke-TestGit $second @('fetch', 'origin', 'main')
  foreach ($path in @('base.txt', 'remote.txt', 'local.txt')) {
    & git -C $second cat-file -e "origin/main`:$path"
    if ($LASTEXITCODE -ne 0) { throw "Recovered branch is missing $path." }
  }
  $parents = (& git -C $second rev-list --parents -n 1 origin/main).Trim().Split(' ').Count - 1
  if ($parents -ne 2) { throw "Expected a two-parent recovery merge, found $parents parents." }
  Write-Host 'PASS push-commit-with-recovery integration test'
} catch {
  $failure = $_
} finally {
  if (Test-Path -LiteralPath $root) {
    $resolved = (Resolve-Path -LiteralPath $root).Path
    $temp = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path
    if (-not $resolved.StartsWith($temp, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Split-Path -Leaf $resolved).StartsWith('oktv-push-recovery-test-', [StringComparison]::Ordinal)) {
      throw "Refusing to remove unexpected test path: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}

if ($null -ne $failure) {
  Write-Error $failure
  exit 1
}
