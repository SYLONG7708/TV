[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$RepositoryRoot,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9]+$')]
  [string]$RunId,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9]+$')]
  [string]$RunAttempt,

  [string]$RemoteName = 'origin',
  [string]$PagesBranch = 'gh-pages',
  [long]$MaxBatchBytes = 134217728,
  [int]$PushAttempts = 4,
  [bool]$CompactPublishedHistory = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($MaxBatchBytes -lt 1048576) {
  throw 'MaxBatchBytes must be at least 1 MiB.'
}
if ($PushAttempts -lt 1) {
  throw 'PushAttempts must be at least 1.'
}

$repo = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$uploadBranch = "oktv-pages-upload-$RunId-$RunAttempt"
$uploadRef = "refs/heads/$uploadBranch"
$pagesRef = "refs/heads/$PagesBranch"
$uploadedAny = $false

function Invoke-GitChecked {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & git -C $repo @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
}

function Get-GitValue {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  $value = @(& git -C $repo @Arguments)
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
  }
  return ($value | Select-Object -Last 1).Trim()
}

function Push-UploadHead {
  for ($attempt = 1; $attempt -le $PushAttempts; $attempt++) {
    & git -C $repo push $RemoteName "HEAD:$uploadRef"
    if ($LASTEXITCODE -eq 0) {
      return
    }
    if ($attempt -lt $PushAttempts) {
      Write-Warning "Temporary Pages upload failed on attempt $attempt; retrying the same checkpoint."
      Start-Sleep -Seconds (15 * $attempt)
    }
  }
  throw "Temporary Pages upload failed after $PushAttempts attempts."
}

function Commit-And-UploadStaged {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message
  )

  & git -C $repo diff --cached --quiet
  $diffExit = $LASTEXITCODE
  if ($diffExit -eq 0) {
    return $false
  }
  if ($diffExit -gt 1) {
    throw "git diff --cached --quiet failed with exit code $diffExit."
  }

  Invoke-GitChecked -Arguments @('commit', '-m', $Message)
  Push-UploadHead
  $script:uploadedAny = $true
  return $true
}

function Get-ChangedPaths {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Root
  )

  $tracked = @(& git -C $repo diff --name-only -- $Root)
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to enumerate tracked changes under $Root."
  }
  $untracked = @(& git -C $repo ls-files --others --exclude-standard -- $Root)
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to enumerate untracked files under $Root."
  }
  return @($tracked + $untracked | Where-Object { $_ } | Sort-Object -Unique)
}

function Add-PathsChecked {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Paths
  )

  if ($Paths.Count -eq 0) {
    return
  }

  $pathspecFile = Join-Path ([IO.Path]::GetTempPath()) ("oktv-git-pathspec-" + [guid]::NewGuid().ToString('N'))
  try {
    $pathspecPayload = [string]::Join([char]0, $Paths) + [char]0
    [IO.File]::WriteAllText($pathspecFile, $pathspecPayload, [Text.UTF8Encoding]::new($false))
    Invoke-GitChecked -Arguments @(
      'add', '--sparse',
      "--pathspec-from-file=$pathspecFile",
      '--pathspec-file-nul'
    )
  }
  finally {
    if (Test-Path -LiteralPath $pathspecFile) {
      Remove-Item -LiteralPath $pathspecFile -Force
    }
  }
}

function Publish-PathBatches {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [string[]]$Paths,

    [Parameter(Mandatory = $true)]
    [string]$Label
  )

  $orderedPaths = @($Paths | Where-Object { $_ } | Sort-Object -Unique)
  if ($orderedPaths.Count -eq 0) {
    Write-Host "No changed $Label files."
    return
  }

  $batch = [System.Collections.Generic.List[string]]::new()
  [long]$batchBytes = 0
  $batchNumber = 0

  foreach ($path in $orderedPaths) {
    $nativePath = $path.Replace('/', [IO.Path]::DirectorySeparatorChar)
    $fullPath = Join-Path $repo $nativePath
    [long]$fileBytes = 0
    if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
      $fileBytes = (Get-Item -LiteralPath $fullPath).Length
    }

    if ($batch.Count -gt 0 -and ($batchBytes + $fileBytes) -gt $MaxBatchBytes) {
      $batchNumber++
      Add-PathsChecked -Paths $batch.ToArray()
      $null = Commit-And-UploadStaged -Message "Publish $Label batch $batchNumber for run $RunId"
      $batch.Clear()
      $batchBytes = 0
    }

    $batch.Add($path)
    $batchBytes += $fileBytes
  }

  if ($batch.Count -gt 0) {
    $batchNumber++
    Add-PathsChecked -Paths $batch.ToArray()
    $null = Commit-And-UploadStaged -Message "Publish $Label batch $batchNumber for run $RunId"
  }
}

Invoke-GitChecked -Arguments @('config', 'user.name', 'github-actions[bot]')
Invoke-GitChecked -Arguments @('config', 'user.email', 'github-actions[bot]@users.noreply.github.com')
Invoke-GitChecked -Arguments @('config', 'http.version', 'HTTP/1.1')
Invoke-GitChecked -Arguments @('config', 'core.autocrlf', 'false')
Invoke-GitChecked -Arguments @('config', 'core.eol', 'lf')
Invoke-GitChecked -Arguments @('config', 'core.quotepath', 'false')

$pagesBase = Get-GitValue -Arguments @('rev-parse', 'HEAD')

$allDataChanges = @(Get-ChangedPaths -Root 'docs/data')
$metadataPaths = @(
  Get-ChangedPaths -Root '.gitattributes'
  Get-ChangedPaths -Root 'docs/iphone'
  Get-ChangedPaths -Root 'docs/assets'
  $allDataChanges | Where-Object {
    $parent = Split-Path -Parent $_
    $parent.Replace('\', '/') -eq 'docs/data'
  }
)
Publish-PathBatches -Paths $metadataPaths -Label 'public metadata'

Publish-PathBatches -Paths @(Get-ChangedPaths -Root 'docs/data/vod-detail') -Label 'VOD detail'
Publish-PathBatches -Paths @(Get-ChangedPaths -Root 'docs/data/vod-index') -Label 'VOD index'
Publish-PathBatches -Paths @(Get-ChangedPaths -Root 'docs/data/vod-search') -Label 'VOD search index'
Publish-PathBatches -Paths @(Get-ChangedPaths -Root 'docs/data/vod-query') -Label 'query shard'
Publish-PathBatches -Paths @(Get-ChangedPaths -Root 'docs/data/quantum-lzi') -Label 'quantum index'

$remaining = @(& git -C $repo status --porcelain --untracked-files=all -- `
  '.gitattributes' 'docs/iphone' 'docs/assets' `
  ':(glob)docs/data/*.json' ':(glob)docs/data/*.csv' `
  'docs/data/vod-detail' 'docs/data/vod-index' 'docs/data/vod-search' `
  'docs/data/vod-query' 'docs/data/quantum-lzi')
if ($LASTEXITCODE -ne 0) {
  throw 'Unable to verify the final Pages worktree status.'
}
if ($remaining.Count -gt 0) {
  throw "Pages publishing left unstaged content:`n$($remaining -join "`n")"
}

if (-not $uploadedAny) {
  Write-Host 'No GitHub Pages public data changes.'
  return
}

Invoke-GitChecked -Arguments @('commit', '--allow-empty', '-m', 'Publish auto refreshed OKTV data')
Push-UploadHead

$publishCommit = Get-GitValue -Arguments @('rev-parse', 'HEAD')
if ($CompactPublishedHistory) {
  $finalTree = Get-GitValue -Arguments @('rev-parse', 'HEAD^{tree}')
  $compactMessage = "Publish current OKTV snapshot for run $RunId (bounded history)"
  $publishCommit = @($compactMessage | & git -C $repo commit-tree $finalTree | Select-Object -Last 1)[0].Trim()
  if ($LASTEXITCODE -ne 0 -or -not $publishCommit) {
    throw 'Unable to create the bounded-history Pages snapshot commit.'
  }
}

Invoke-GitChecked -Arguments @('fetch', $RemoteName, $PagesBranch)
$remotePagesHead = Get-GitValue -Arguments @('rev-parse', "$RemoteName/$PagesBranch")
if ($remotePagesHead -ne $pagesBase) {
  throw "The remote $PagesBranch branch changed during upload; refusing a non-atomic overwrite."
}

$published = $false
for ($attempt = 1; $attempt -le $PushAttempts; $attempt++) {
  if ($CompactPublishedHistory) {
    & git -C $repo push $RemoteName "--force-with-lease=$pagesRef`:$pagesBase" "$publishCommit`:$pagesRef"
  } else {
    & git -C $repo push $RemoteName "$publishCommit`:$pagesRef"
  }
  if ($LASTEXITCODE -eq 0) {
    $published = $true
    break
  }
  if ($attempt -lt $PushAttempts) {
    Write-Warning "Atomic $PagesBranch update failed on attempt $attempt; retrying."
    Start-Sleep -Seconds (15 * $attempt)
  }
}
if (-not $published) {
  throw "Atomic $PagesBranch update failed after $PushAttempts attempts."
}

& git -C $repo push $RemoteName --delete $uploadBranch
if ($LASTEXITCODE -ne 0) {
  Write-Warning "Published successfully, but temporary branch $uploadBranch could not be removed."
}

Write-Host "Published $PagesBranch atomically after batched uploads (bounded history: $CompactPublishedHistory)."
