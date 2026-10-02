[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("oktv-pages-batched-test-" + [guid]::NewGuid().ToString('N'))
$publisher = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\tools\publish-gh-pages-batched.ps1')).Path
$testFailure = $null

function Invoke-TestGit {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Repository,

    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & git -C $Repository @Arguments | Out-Host
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

try {
  $null = New-Item -ItemType Directory -Path $testRoot
  $remote = Join-Path $testRoot 'remote.git'
  $seed = Join-Path $testRoot 'seed'
  $pages = Join-Path $testRoot 'pages'

  & git init --bare $remote | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create the temporary bare repository.' }
  & git init -b gh-pages $seed | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Unable to create the seed repository.' }

  $null = New-Item -ItemType Directory -Force -Path `
    (Join-Path $seed 'docs\iphone'), `
    (Join-Path $seed 'docs\assets'), `
    (Join-Path $seed 'docs\data\vod-detail'), `
    (Join-Path $seed 'docs\data\vod-index'), `
    (Join-Path $seed 'docs\data\vod-query\normal')
  [IO.File]::WriteAllText((Join-Path $seed '.gitattributes'), "* text=auto`n")
  [IO.File]::WriteAllText((Join-Path $seed 'docs\iphone\index.html'), '<!doctype html>')
  [IO.File]::WriteAllText((Join-Path $seed 'docs\assets\app.svg'), '<svg/>')
  [IO.File]::WriteAllText((Join-Path $seed 'docs\data\manifest.json'), '{"version":1}')
  [IO.File]::WriteAllText((Join-Path $seed 'docs\data\vod-detail\page.json'), '{"items":[]}')
  [IO.File]::WriteAllText((Join-Path $seed 'docs\data\vod-index\source.json.gz'), 'seed-index')
  [IO.File]::WriteAllText((Join-Path $seed 'docs\data\vod-query\normal\b-0.json.gz'), 'seed-query')

  Invoke-TestGit -Repository $seed -Arguments @('config', 'user.name', 'test')
  Invoke-TestGit -Repository $seed -Arguments @('config', 'user.email', 'test@example.invalid')
  Invoke-TestGit -Repository $seed -Arguments @('add', '.')
  Invoke-TestGit -Repository $seed -Arguments @('commit', '-m', 'seed')
  Invoke-TestGit -Repository $seed -Arguments @('remote', 'add', 'origin', $remote)
  Invoke-TestGit -Repository $seed -Arguments @('push', '-u', 'origin', 'gh-pages')

  & git clone --branch gh-pages $remote $pages | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Unable to clone the temporary Pages repository.' }
  Invoke-TestGit -Repository $pages -Arguments @('config', 'core.quotepath', 'true')

  [IO.File]::WriteAllText((Join-Path $pages 'docs\data\manifest.json'), '{"version":2}')
  [IO.File]::WriteAllText((Join-Path $pages 'docs\data\vod-detail\page.json'), '{"items":[1]}')
  [IO.File]::WriteAllText((Join-Path $pages 'docs\data\vod-index\source.json.gz'), 'updated-index')
  $unicodeDirName = -join @([char]0x611B, [char]0x5947, [char]0x85DD, [char]0x6E2C, [char]0x8A66)
  $unicodeFileName = (-join @([char]0x7B2C, '1', [char]0x9801)) + '.json'
  $unicodeTitle = -join @([char]0x7661, [char]0x8FF7)
  $unicodeJson = '{"title":"' + $unicodeTitle + '"}'
  $unicodeDetailDir = Join-Path $pages "docs\data\vod-detail\$unicodeDirName"
  $null = New-Item -ItemType Directory -Force -Path $unicodeDetailDir
  [IO.File]::WriteAllText((Join-Path $unicodeDetailDir $unicodeFileName), $unicodeJson)
  0..599 | ForEach-Object {
    $longName = 'page-{0:D4}-{1}.json' -f $_, ('x' * 55)
    [IO.File]::WriteAllText((Join-Path $pages "docs\data\vod-detail\$longName"), "{`"id`":$_}")
  }
  0..5 | ForEach-Object {
    $bytes = [byte[]]::new(1048576)
    [Random]::new($_ + 100).NextBytes($bytes)
    [IO.File]::WriteAllBytes((Join-Path $pages "docs\data\vod-query\normal\b-$_.json.gz"), $bytes)
  }

  & $publisher `
    -RepositoryRoot $pages `
    -RunId '999' `
    -RunAttempt '1' `
    -MaxBatchBytes 2097152 `
    -PushAttempts 2
  if ($LASTEXITCODE -ne 0) { throw "Publisher exited with code $LASTEXITCODE." }

  Invoke-TestGit -Repository $pages -Arguments @('fetch', 'origin', 'gh-pages')
  $remoteManifest = (& git -C $pages show 'origin/gh-pages:docs/data/manifest.json').Trim()
  if ($remoteManifest -ne '{"version":2}') {
    throw 'The atomic gh-pages update did not publish the expected metadata.'
  }
  $unicodeGitPath = "origin/gh-pages:docs/data/vod-detail/$unicodeDirName/$unicodeFileName"
  $remoteUnicodeDetail = (& git -C $pages show $unicodeGitPath).Trim()
  if ($LASTEXITCODE -ne 0 -or $remoteUnicodeDetail -ne $unicodeJson) {
    throw 'The NUL pathspec did not publish the expected Unicode detail path.'
  }
  $tempBranch = @(& git -C $pages ls-remote --heads origin 'oktv-pages-upload-*')
  if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect temporary upload branches.' }
  if ($tempBranch.Count -ne 0) {
    throw 'The temporary upload branch was not removed after success.'
  }
  $publishedCommitCount = [int](& git -C $pages rev-list --count 'origin/gh-pages')
  if ($LASTEXITCODE -ne 0 -or $publishedCommitCount -ne 1) {
    throw "Expected bounded gh-pages history with one commit, found $publishedCommitCount."
  }

  $beforeNoop = (& git -C $pages rev-parse 'origin/gh-pages').Trim()
  & $publisher `
    -RepositoryRoot $pages `
    -RunId '999' `
    -RunAttempt '2' `
    -MaxBatchBytes 2097152 `
    -PushAttempts 2
  if ($LASTEXITCODE -ne 0) { throw "No-op publisher exited with code $LASTEXITCODE." }
  Invoke-TestGit -Repository $pages -Arguments @('fetch', 'origin', 'gh-pages')
  $afterNoop = (& git -C $pages rev-parse 'origin/gh-pages').Trim()
  if ($afterNoop -ne $beforeNoop) {
    throw 'A no-op publish unexpectedly changed gh-pages.'
  }

  Write-Host 'PASS publish-gh-pages-batched integration test'
}
catch {
  $testFailure = $_
}
finally {
  if (Test-Path -LiteralPath $testRoot) {
    $resolvedTestRoot = (Resolve-Path -LiteralPath $testRoot).Path
    $resolvedTemp = (Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path
    if (-not $resolvedTestRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Split-Path -Leaf $resolvedTestRoot).StartsWith('oktv-pages-batched-test-', [StringComparison]::Ordinal)) {
      throw "Refusing to remove unexpected test path: $resolvedTestRoot"
    }
    Remove-Item -LiteralPath $resolvedTestRoot -Recurse -Force
  }
}

if ($null -ne $testFailure) {
  Write-Error $testFailure
  exit 1
}
