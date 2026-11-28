param(
    [string]$Output = "",
    [int]$MaxResultsPerQuery = 20
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = Join-Path $repoRoot ".patch-work\youtube-discovery-candidates.csv"
}

function Find-YtDlp {
    $local = Join-Path $repoRoot ".tools\yt-dlp.exe"
    if (Test-Path -LiteralPath $local) { return $local }
    $cmd = Get-Command yt-dlp.exe -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $cmd = Get-Command yt-dlp -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "yt-dlp not found."
}

function Get-VideoId([string]$Url) {
    if ($Url -match '[?&]v=([^&]+)') { return $Matches[1] }
    if ($Url -match 'youtu\.be/([^?&/]+)') { return $Matches[1] }
    return ""
}

$animeGroup = "YouTube" + [string]([char]0x52d5) + [string]([char]0x6f2b) + [string]([char]0x53f0)
$kidsGroup = "YouTube" + [string]([char]0x5152) + [string]([char]0x7ae5) + [string]([char]0x5361) + [string]([char]0x901a)
$movieGroup = "YouTube" + [string]([char]0x96fb) + [string]([char]0x5f71) + [string]([char]0x53f0)
$museQuery = "Muse " + [string]([char]0x6728) + [string]([char]0x68c9) + [string]([char]0x82b1) + " " + [string]([char]0x76f4) + [string]([char]0x64ad)
$animeLiveQuery = [string]([char]0x52d5) + [string]([char]0x6f2b) + " " + [string]([char]0x76f4) + [string]([char]0x64ad) + " anime live official"

$queries = @(
    [pscustomobject]@{ Group = $animeGroup; Query = $animeLiveQuery },
    [pscustomobject]@{ Group = $animeGroup; Query = $museQuery },
    [pscustomobject]@{ Group = $animeGroup; Query = "Ani-One Asia live anime" },
    [pscustomobject]@{ Group = $animeGroup; Query = "anileap anime song live official" },
    [pscustomobject]@{ Group = $animeGroup; Query = "Pokemon Kids TV live official" },
    [pscustomobject]@{ Group = $kidsGroup; Query = "cartoon live official kids 24/7" },
    [pscustomobject]@{ Group = $kidsGroup; Query = "WildBrain Kids live official cartoons" },
    [pscustomobject]@{ Group = $kidsGroup; Query = "Tayo live official cartoon" },
    [pscustomobject]@{ Group = $kidsGroup; Query = "Talking Tom live official cartoon" },
    [pscustomobject]@{ Group = $kidsGroup; Query = "Peppa Pig live official" },
    [pscustomobject]@{ Group = $kidsGroup; Query = "BabyBus live official cartoon" },
    [pscustomobject]@{ Group = $movieGroup; Query = "free movies live official YouTube" },
    [pscustomobject]@{ Group = $movieGroup; Query = "FilmRise Movies live official" },
    [pscustomobject]@{ Group = $movieGroup; Query = "Movie Central live free movies official" },
    [pscustomobject]@{ Group = $movieGroup; Query = "The Archive movies live official" },
    [pscustomobject]@{ Group = $movieGroup; Query = "classic movies live official" },
    [pscustomobject]@{ Group = $movieGroup; Query = "western movies live official YouTube" }
)

$museName = [string]([char]0x6728) + [string]([char]0x68c9) + [string]([char]0x82b1)
$trusted = "Muse|$museName|Ani-One|Anileap|KING AMUSEMENT|Pokemon|Pokemon|WildBrain|Tayo|Talking Tom|FilmRise|Movie Central|The Archive|Shout|Maverick|Popcornflix|Fawesome|RetroCrush|Kartoon|Moonbug|BabyBus|Peppa|PBS KIDS|Booba|Oddbods|LooLoo|Cocomelon|GundamInfo|Crunchyroll"
$blocked = "camrip|dvdrip|hdcam|pirated|full movie in hindi|new movie 202|hd movie 202"

$ytDlp = Find-YtDlp
$existingIds = @{}
$channelCsv = Join-Path $repoRoot "sources\youtube-live-channels.csv"
if (Test-Path -LiteralPath $channelCsv) {
    Import-Csv -LiteralPath $channelCsv -Encoding UTF8 | ForEach-Object {
        $id = Get-VideoId $_.Url
        if ($id) { $existingIds[$id] = $true }
    }
}

$candidates = [ordered]@{}
foreach ($query in $queries) {
    Write-Host "Searching: $($query.Query)"
    $searchUrl = "ytsearch$MaxResultsPerQuery`:$($query.Query)"
    $oldErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $rawLines = @(& $ytDlp --flat-playlist --dump-json $searchUrl 2>&1)
    } finally {
        $ErrorActionPreference = $oldErrorActionPreference
    }
    $lines = @($rawLines | ForEach-Object { [string]$_ } | Where-Object { $_.TrimStart().StartsWith("{") })
    foreach ($line in $lines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        try {
            $item = $line | ConvertFrom-Json
        } catch {
            continue
        }

        $id = [string]$item.id
        if ([string]::IsNullOrWhiteSpace($id)) { continue }
        if ($existingIds.ContainsKey($id)) { continue }
        if ($candidates.Contains($id)) { continue }
        if ($item.live_status -ne "is_live" -and -not [bool]$item.is_live) { continue }

        $haystack = "$($item.title) $($item.channel) $($item.uploader)"
        if ($haystack -notmatch $trusted) { continue }
        if ($haystack -match $blocked) { continue }

        $title = ([string]$item.title).Trim()
        $channel = ([string]$item.channel).Trim()
        $shortName = $title
        $shortName = $shortName -replace '\s+', ' '
        if ($shortName.Length -gt 48) { $shortName = $shortName.Substring(0, 48).Trim() }

        $candidates[$id] = [pscustomobject]@{
            Group = [string]$query.Group
            Name = $shortName
            Channel = $channel
            Url = "https://www.youtube.com/watch?v=$id"
            Id = $id
            Verified = [bool]$item.channel_is_verified
            Query = [string]$query.Query
        }
    }
}

$result = @($candidates.Values | Sort-Object Group, Channel, Name)
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Output) | Out-Null
$result | Export-Csv -LiteralPath $Output -NoTypeInformation -Encoding UTF8
$result | Format-Table Group, Name, Channel, Verified, Url -AutoSize
Write-Host "Candidate count: $($result.Count)"
Write-Host "Output: $Output"
