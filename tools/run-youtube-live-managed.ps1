[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$RepoRoot,
  [int]$MaxChannels = 0,
  [switch]$DryRun,
  [switch]$PublishOnly
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = (Resolve-Path -LiteralPath $RepoRoot).Path
$marker = Join-Path $repo '.oktv-youtube-managed-checkout'
if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -ne $repo) {
  throw 'This updater requires a dedicated, explicitly marked automation checkout.'
}
$stateDir = Join-Path $repo '.patch-work'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$logPath = Join-Path $stateDir 'youtube-live-managed.log'
$statusPath = Join-Path $stateDir 'youtube-live-managed-status.json'
$lockPath = Join-Path $stateDir 'youtube-live-managed.lock'
$pages = Join-Path (Split-Path -Parent $repo) 'OKTVLivePages'

function Write-Status([string]$State, [string]$Message, [int]$Playable = 0) {
  $status = [ordered]@{
    checkedAt = [DateTimeOffset]::UtcNow.ToString('o')
    state = $State
    message = $Message
    playableHls = $Playable
    mainRevision = (& git -C $repo rev-parse --short HEAD)
    log = $logPath
  }
  [IO.File]::WriteAllText($statusPath, (($status | ConvertTo-Json -Depth 3) + "`n"), [Text.UTF8Encoding]::new($false))
  Write-Host "$State`: $Message"
}

function Invoke-GitManaged([string[]]$GitArgs) {
  & git -C $repo @GitArgs
  if ($LASTEXITCODE -ne 0) { throw "git $($GitArgs -join ' ') failed with exit code $LASTEXITCODE" }
}

function Prepare-ManagedCheckout {
  Invoke-GitManaged @('fetch', 'origin', 'main')
  Invoke-GitManaged @('reset', '--hard', 'origin/main')
  Invoke-GitManaged @('config', 'user.name', 'OKTV local updater')
  Invoke-GitManaged @('config', 'user.email', 'oktv-local-updater@example.local')
  Invoke-GitManaged @('config', 'core.autocrlf', 'false')
  Invoke-GitManaged @('config', 'core.eol', 'lf')
}

function Resolve-YtDlpBinary {
  $toolDir = Join-Path $repo '.tools'
  New-Item -ItemType Directory -Path $toolDir -Force | Out-Null
  $binary = Join-Path $toolDir 'yt-dlp.exe'
  $refresh = -not (Test-Path -LiteralPath $binary) -or ((Get-Date) - (Get-Item -LiteralPath $binary).LastWriteTime).TotalDays -ge 7
  if ($refresh) {
    $download = Join-Path $toolDir 'yt-dlp-download.exe'
    try {
      Invoke-WebRequest -Uri 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' -OutFile $download -UseBasicParsing
      if ((Get-Item -LiteralPath $download).Length -lt 1000000) { throw 'Downloaded yt-dlp is unexpectedly small.' }
      Move-Item -LiteralPath $download -Destination $binary -Force
      Write-Host 'yt-dlp refreshed.'
    } catch {
      if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download -Force }
      if (-not (Test-Path -LiteralPath $binary)) { throw }
      Write-Warning "yt-dlp refresh failed; using the existing binary: $($_.Exception.Message)"
    }
  }
  return $binary
}

function Refresh-LiveData([string]$YtDlp) {
  $params = @{
    YtDlpPath = $YtDlp
    IncludeOriginalOnFailure = $true
    MaxChannels = $MaxChannels
    MaxHeight = 1080
    SocketTimeoutSec = 10
    ProcessTimeoutSec = 25
    StreamValidationTimeoutSec = 15
    SegmentProbeBytes = 262144
    MinSegmentBytes = 65536
    MinSegmentKbps = 900
    MinPlaylistEntries = $(if ($MaxChannels -gt 0) { 1 } else { 10 })
    RetryCount = 1
  }
  $cookieFile = Join-Path $repo 'youtube-cookies.txt'
  if (Test-Path -LiteralPath $cookieFile) { $params.CookiesFile = $cookieFile }
  & (Join-Path $repo 'tools\update-youtube-live.ps1') @params
  $report = Get-Content -LiteralPath (Join-Path $repo 'sources\live-youtube-report.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($report.outputsPreserved) { return $report }
  & node (Join-Path $repo 'tools\build-live-channels-json.mjs') --tvRoot $repo --input (Join-Path $repo 'sources\live-stable.txt') --output (Join-Path $repo 'docs\data\live-channels.json') --summary (Join-Path $repo 'docs\data\source-summary.json') --minValidSeconds 600
  if ($LASTEXITCODE -ne 0) { throw 'Unable to rebuild public live JSON.' }
  & node (Join-Path $repo 'tools\build-live-signal-index.mjs') --tvRoot $repo --json (Join-Path $repo 'sources\live-signal-sources.json') --csv (Join-Path $repo 'sources\live-signal-sources.csv')
  if ($LASTEXITCODE -ne 0) { throw 'Unable to rebuild the live signal index.' }
  return $report
}

function Publish-LivePages {
  Invoke-GitManaged @('fetch', '--filter=blob:none', '--depth=1', 'origin', 'gh-pages')
  if (-not (Test-Path -LiteralPath (Join-Path $pages '.git'))) {
    Invoke-GitManaged @('worktree', 'add', '--no-checkout', '--detach', $pages, 'origin/gh-pages')
    & git -C $pages sparse-checkout set --no-cone '/docs/data/live-channels.json' '/docs/data/source-summary.json'
    if ($LASTEXITCODE -ne 0) { throw 'Unable to configure sparse Pages worktree.' }
    & git -C $pages checkout
    if ($LASTEXITCODE -ne 0) { throw 'Unable to check out sparse Pages worktree.' }
  }
  & git -C $pages reset --hard origin/gh-pages
  if ($LASTEXITCODE -ne 0) { throw 'Unable to reset managed Pages worktree.' }
  Copy-Item -LiteralPath (Join-Path $repo 'docs\data\live-channels.json') -Destination (Join-Path $pages 'docs\data\live-channels.json') -Force
  Copy-Item -LiteralPath (Join-Path $repo 'docs\data\source-summary.json') -Destination (Join-Path $pages 'docs\data\source-summary.json') -Force
  $runId = [DateTimeOffset]::UtcNow.ToString('yyyyMMddHHmmss')
  & (Join-Path $repo 'tools\publish-gh-pages-batched.ps1') -RepositoryRoot $pages -RunId $runId -RunAttempt '1'
  if (-not $?) { throw 'Pages data publication failed.' }
  & gh workflow run deploy-oktv-pages.yml --repo SYLONG7708/TV --ref main
  if ($LASTEXITCODE -ne 0) { throw 'Unable to dispatch the Pages deployment.' }
}

$lock = $null
try {
  $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
} catch [IO.IOException] {
  Write-Host 'Another local YouTube update is already running.'
  exit 0
}
try {
  Start-Transcript -Path $logPath -Append | Out-Null
  Write-Status 'running' 'Checking YouTube channels and validating HLS streams.'
  if ($PublishOnly) {
    if ($DryRun) { throw 'PublishOnly and DryRun cannot be combined.' }
    Invoke-GitManaged @('fetch', 'origin', 'main')
    $localRevision = (& git -C $repo rev-parse HEAD).Trim()
    $remoteRevision = (& git -C $repo rev-parse origin/main).Trim()
    if ($localRevision -ne $remoteRevision) { throw 'The managed checkout is not at the latest main revision.' }
    $report = Get-Content -LiteralPath (Join-Path $repo 'sources\live-youtube-report.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($report.outputsPreserved -or [int]$report.playable -lt 10) { throw 'There are not enough validated HLS streams to publish.' }
    Publish-LivePages
    Write-Status 'updated' 'Validated HLS sources are available on main and Pages.' ([int]$report.playable)
    return
  }
  $binary = Resolve-YtDlpBinary
  for ($attempt = 1; $attempt -le 2; $attempt++) {
    Prepare-ManagedCheckout
    $report = Refresh-LiveData -YtDlp $binary
    $playable = [int]$report.playable
    if ($report.outputsPreserved) {
      Write-Status 'preserved' 'No sufficient fresh HLS streams; published data stays intact.' $playable
      return
    }
    if ($DryRun) {
      Write-Status 'dry-run' 'HLS extraction and JSON rebuild succeeded; nothing was published.' $playable
      return
    }
    Invoke-GitManaged @('add', '--', 'sources/live-stable.txt', 'sources/live-youtube-stable.txt', 'sources/live-youtube-report.json', 'sources/live-signal-sources.json', 'sources/live-signal-sources.csv', 'docs/data/live-channels.json', 'docs/data/source-summary.json')
    & git -C $repo diff --cached --quiet
    if ($LASTEXITCODE -eq 1) { Invoke-GitManaged @('commit', '-m', 'Auto refresh locally resolved YouTube live sources') }
    elseif ($LASTEXITCODE -gt 1) { throw 'Unable to check staged changes.' }
    & git -C $repo push origin HEAD:main
    if ($LASTEXITCODE -eq 0) {
      Publish-LivePages
      Write-Status 'updated' 'Fresh HLS sources were published to main and Pages.' $playable
      return
    }
    Write-Warning "Main changed during update; rebuilding from the latest main branch (attempt $attempt of 2)."
  }
  Write-Status 'deferred' 'Concurrent main updates prevented this refresh; the next scheduled run will rebuild it.' $playable
} catch {
  Write-Status 'error' $_.Exception.Message
  throw
} finally {
  Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
  if ($lock) { $lock.Dispose() }
}
