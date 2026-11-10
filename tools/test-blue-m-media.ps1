param([string]$AndroidHome=$env:ANDROID_HOME,[string]$JavaHome=$env:JAVA_HOME)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
if(!$AndroidHome -or !$JavaHome){throw 'Set ANDROID_HOME and JAVA_HOME.'}
$androidJar=Join-Path $AndroidHome 'platforms/android-36/android.jar'
$out=Join-Path ([System.IO.Path]::GetTempPath()) ('yingshi-media-test-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $out | Out-Null
try {
  & (Join-Path $JavaHome 'bin/javac.exe') -encoding UTF-8 -cp $androidJar -d $out (Join-Path $root 'mobile/yingshi-car/app/src/main/java/tw/com/sylong/tvcar/BlueMLiveMedia.java') (Join-Path $root 'tests/java/tw/com/sylong/tvcar/BlueMLiveMediaTest.java')
  if($LASTEXITCODE -ne 0){throw 'Media test compilation failed.'}
  & (Join-Path $JavaHome 'bin/java.exe') -cp ($out+[System.IO.Path]::PathSeparator+$androidJar) tw.com.sylong.tvcar.BlueMLiveMediaTest
  if($LASTEXITCODE -ne 0){throw 'Media checks failed.'}
} finally {
  $resolved=[System.IO.Path]::GetFullPath($out)
  $expected=[System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if($resolved.StartsWith($expected,[System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'yingshi-media-test-*') {Remove-Item -LiteralPath $resolved -Recurse -Force}
}
