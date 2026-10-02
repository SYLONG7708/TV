param(
    [string]$InputApk = "",
    [string]$OutputApk = "",
    [string]$VodUrl = "",
    [string]$LiveUrl = "",
    [string]$VodName = "點播",
    [string]$LiveName = "直播",
    [string]$AndroidSdk = "",
    [switch]$KeepWork
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-FullPath([string]$Path) {
    return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

function Require-File([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label not found: $Path"
    }
}

function Require-UrlText([string]$Value, [string]$Label) {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Label is empty." }
    if ($Value -notmatch '^https?://') { throw "$Label must start with http:// or https://." }
    if ($Value.Contains('"')) { throw "$Label cannot contain double quotes." }
}

function Find-BuildTools([string]$AndroidSdk) {
    $candidates = @(
        $AndroidSdk,
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA "Android\Sdk"),
        (Join-Path $env:USERPROFILE "Desktop\codex-test\tools\android-sdk")
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

    foreach ($sdk in $candidates) {
        $buildToolsRoot = Join-Path $sdk "build-tools"
        if (-not (Test-Path -LiteralPath $buildToolsRoot -PathType Container)) { continue }
        $dirs = Get-ChildItem -LiteralPath $buildToolsRoot -Directory | Sort-Object Name -Descending
        foreach ($dir in $dirs) {
            $zipalign = Join-Path $dir.FullName "zipalign.exe"
            $apksigner = Join-Path $dir.FullName "apksigner.bat"
            if ((Test-Path -LiteralPath $zipalign) -and (Test-Path -LiteralPath $apksigner)) {
                return [pscustomobject]@{
                    Sdk = $sdk
                    Dir = $dir.FullName
                    Zipalign = $zipalign
                    Apksigner = $apksigner
                }
            }
        }
    }
    throw "Android build-tools not found. Install Android SDK build-tools, or pass -AndroidSdk C:\path\to\android-sdk."
}

function Download-IfMissing([string]$Url, [string]$OutFile) {
    if (Test-Path -LiteralPath $OutFile -PathType Leaf) { return }
    Write-Host "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
}

function Ensure-SmaliTools([string]$ToolsDir) {
    New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
    $deps = @(
        @("smali-3.0.3.jar", "https://dl.google.com/dl/android/maven2/com/android/tools/smali/smali/3.0.3/smali-3.0.3.jar"),
        @("smali-baksmali-3.0.3.jar", "https://dl.google.com/dl/android/maven2/com/android/tools/smali/smali-baksmali/3.0.3/smali-baksmali-3.0.3.jar"),
        @("smali-dexlib2-3.0.3.jar", "https://dl.google.com/dl/android/maven2/com/android/tools/smali/smali-dexlib2/3.0.3/smali-dexlib2-3.0.3.jar"),
        @("smali-util-3.0.3.jar", "https://dl.google.com/dl/android/maven2/com/android/tools/smali/smali-util/3.0.3/smali-util-3.0.3.jar"),
        @("antlr-runtime-3.5.2.jar", "https://repo1.maven.org/maven2/org/antlr/antlr-runtime/3.5.2/antlr-runtime-3.5.2.jar"),
        @("jcommander-1.78.jar", "https://repo1.maven.org/maven2/com/beust/jcommander/1.78/jcommander-1.78.jar"),
        @("guava-31.1-jre.jar", "https://repo1.maven.org/maven2/com/google/guava/guava/31.1-jre/guava-31.1-jre.jar"),
        @("failureaccess-1.0.1.jar", "https://repo1.maven.org/maven2/com/google/guava/failureaccess/1.0.1/failureaccess-1.0.1.jar"),
        @("listenablefuture-9999.0-empty-to-avoid-conflict-with-guava.jar", "https://repo1.maven.org/maven2/com/google/guava/listenablefuture/9999.0-empty-to-avoid-conflict-with-guava/listenablefuture-9999.0-empty-to-avoid-conflict-with-guava.jar"),
        @("jsr305-3.0.2.jar", "https://repo1.maven.org/maven2/com/google/code/findbugs/jsr305/3.0.2/jsr305-3.0.2.jar"),
        @("error_prone_annotations-2.16.jar", "https://repo1.maven.org/maven2/com/google/errorprone/error_prone_annotations/2.16/error_prone_annotations-2.16.jar"),
        @("checker-qual-3.21.2.jar", "https://repo1.maven.org/maven2/org/checkerframework/checker-qual/3.21.2/checker-qual-3.21.2.jar"),
        @("j2objc-annotations-1.3.jar", "https://repo1.maven.org/maven2/com/google/j2objc/j2objc-annotations/1.3/j2objc-annotations-1.3.jar")
    )

    foreach ($dep in $deps) {
        Download-IfMissing -Url $dep[1] -OutFile (Join-Path $ToolsDir $dep[0])
    }

    return ($deps | ForEach-Object { Join-Path $ToolsDir $_[0] }) -join ";"
}

function New-ConfigMethod([string]$MethodName, [string]$Url, [string]$Name, [int]$Type) {
    $typeHex = [Convert]::ToString($Type, 16)
    return @"
.method public static $MethodName()Lcom/fongmi/android/tv/bean/Config;
    .registers 3

    const-string v0, "$Url"

    const-string v1, "$Name"

    const/4 v2, 0x$typeHex

    invoke-static {v0, v1, v2}, Lcom/fongmi/android/tv/bean/Config;->find(Ljava/lang/String;Ljava/lang/String;I)Lcom/fongmi/android/tv/bean/Config;

    move-result-object v0

    return-object v0
.end method
"@
}

function Replace-ConfigMethod([string]$Text, [string]$MethodName, [string]$Replacement) {
    $pattern = "(?s)\.method public static $MethodName\(\)Lcom/fongmi/android/tv/bean/Config;.*?\.end method"
    $matches = [System.Text.RegularExpressions.Regex]::Matches($Text, $pattern)
    if ($matches.Count -ne 1) {
        throw "Expected one $MethodName method in Config.smali, found $($matches.Count)."
    }
    return [System.Text.RegularExpressions.Regex]::Replace(
        $Text,
        $pattern,
        [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $Replacement },
        1
    )
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$sourceConfig = Join-Path $repoRoot "sources\current-sources.json"

if ([string]::IsNullOrWhiteSpace($InputApk)) {
    $InputApk = Join-Path $repoRoot "releases\OKTV_5.1.6_builtin_sources.apk"
}
if ([string]::IsNullOrWhiteSpace($OutputApk)) {
    $OutputApk = Join-Path $repoRoot "releases\OKTV_5.1.6_custom_sources.apk"
}
if (([string]::IsNullOrWhiteSpace($VodUrl) -or [string]::IsNullOrWhiteSpace($LiveUrl)) -and (Test-Path -LiteralPath $sourceConfig)) {
    $cfg = Get-Content -LiteralPath $sourceConfig -Raw -Encoding UTF8 | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($VodUrl)) { $VodUrl = $cfg.vod.url }
    if ([string]::IsNullOrWhiteSpace($LiveUrl)) { $LiveUrl = $cfg.live.url }
    if ($cfg.vod.name) { $VodName = $cfg.vod.name }
    if ($cfg.live.name) { $LiveName = $cfg.live.name }
}

$InputApk = Get-FullPath $InputApk
$OutputApk = Get-FullPath $OutputApk
Require-File $InputApk "Input APK"
Require-UrlText $VodUrl "Vod URL"
Require-UrlText $LiveUrl "Live URL"
if ($InputApk -eq $OutputApk) { throw "Output APK must be different from Input APK." }

$java = Get-Command java -ErrorAction SilentlyContinue
if (-not $java) { throw "Java was not found. Install JDK 17 or newer and make sure java is in PATH." }
$buildTools = Find-BuildTools -AndroidSdk $AndroidSdk
$toolsDir = Join-Path $repoRoot ".tools"
$cp = Ensure-SmaliTools -ToolsDir $toolsDir

$workDir = Join-Path $repoRoot ".patch-work"
if (Test-Path -LiteralPath $workDir) { Remove-Item -LiteralPath $workDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $workDir | Out-Null
$smaliDir = Join-Path $workDir "smali"
$dexOriginal = Join-Path $workDir "classes.dex"
$dexPatched = Join-Path $workDir "classes_patched.dex"
$unsigned = Join-Path $workDir "unsigned.apk"
$aligned = Join-Path $workDir "aligned.apk"
$keystore = Join-Path $repoRoot "debug.keystore"

Write-Host "Extracting classes.dex"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($InputApk)
try {
    $entry = $zip.GetEntry("classes.dex")
    if (-not $entry) { throw "classes.dex not found in APK." }
    $in = $entry.Open()
    $out = [System.IO.File]::Create($dexOriginal)
    $in.CopyTo($out)
    $out.Dispose()
    $in.Dispose()
} finally {
    $zip.Dispose()
}

Write-Host "Disassembling classes.dex"
& $java.Source -cp $cp com.android.tools.smali.baksmali.Main disassemble -o $smaliDir $dexOriginal

$configSmali = Join-Path $smaliDir "com\fongmi\android\tv\bean\Config.smali"
Require-File $configSmali "Config.smali"
$text = Get-Content -LiteralPath $configSmali -Raw -Encoding UTF8
$text = Replace-ConfigMethod -Text $text -MethodName "vod" -Replacement (New-ConfigMethod -MethodName "vod" -Url $VodUrl -Name $VodName -Type 0)
$text = Replace-ConfigMethod -Text $text -MethodName "live" -Replacement (New-ConfigMethod -MethodName "live" -Url $LiveUrl -Name $LiveName -Type 1)
[System.IO.File]::WriteAllText($configSmali, $text, [System.Text.UTF8Encoding]::new($false))

Write-Host "Assembling patched classes.dex"
& $java.Source -cp $cp com.android.tools.smali.smali.Main assemble -o $dexPatched $smaliDir
Require-File $dexPatched "Patched classes.dex"

Write-Host "Repacking APK"
Copy-Item -LiteralPath $InputApk -Destination $unsigned -Force
$zip = [System.IO.Compression.ZipFile]::Open($unsigned, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    $remove = New-Object System.Collections.Generic.List[object]
    foreach ($entry in $zip.Entries) {
        if ($entry.FullName -eq "classes.dex" -or $entry.FullName -match '^META-INF/(MANIFEST\.MF|[^/]+\.(SF|RSA|DSA|EC))$') {
            $remove.Add($entry)
        }
    }
    foreach ($entry in $remove) { $entry.Delete() }
    $newEntry = $zip.CreateEntry("classes.dex", [System.IO.Compression.CompressionLevel]::Optimal)
    $in = [System.IO.File]::OpenRead($dexPatched)
    $out = $newEntry.Open()
    $in.CopyTo($out)
    $out.Dispose()
    $in.Dispose()
} finally {
    $zip.Dispose()
}

if (-not (Test-Path -LiteralPath $keystore -PathType Leaf)) {
    Write-Host "Creating debug keystore"
    keytool -genkeypair -v -keystore $keystore -storepass android -alias androiddebugkey -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US" | Out-Null
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutputApk) | Out-Null
Write-Host "Zipalign"
& $buildTools.Zipalign -p -f 4 $unsigned $aligned
Write-Host "Signing"
& $buildTools.Apksigner sign --ks $keystore --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out $OutputApk $aligned
Write-Host "Verifying"
& $buildTools.Apksigner verify --verbose $OutputApk

if (-not $KeepWork) {
    Remove-Item -LiteralPath $workDir -Recurse -Force
}

Write-Host ""
Write-Host "Done: $OutputApk"
Write-Host "Vod : $VodUrl"
Write-Host "Live: $LiveUrl"
