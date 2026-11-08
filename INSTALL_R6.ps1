$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = Join-Path $env:LOCALAPPDATA 'Programs\MichbasotEilatService'
$static = Join-Path $root 'app\static'
$lib = Join-Path $static 'p2p-apk-lib.js'
$html = Join-Path $static 'p2p-apk-office.html'
$officeController = Join-Path $static 'p2p-apk-office.js'
$source = Join-Path $PSScriptRoot 'p2p-apk-lib.js'
$backup = Join-Path $root ('P2P_R6_BACKUP_'+(Get-Date -Format 'yyyyMMdd_HHmmss'))
$result = Join-Path $env:TEMP 'MICHBASOT_R6_INSTALL_RESULT.txt'
$oldHash = '23a3470cb5bd7c7ee9668cccfb0a248d3fd2c58fc3ca9160c2fca10815db7f64'
$newHash = '7c9b33f24b35b8698ec99f256b80c018942650a83c50ebbc8df39e66c1e00491'
$enc = New-Object System.Text.UTF8Encoding($false)
$log = New-Object System.Collections.Generic.List[string]
function Say([string]$line){Write-Host $line; [void]$log.Add($line)}
function Hash([string]$path){return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()}
function Read([string]$path){return [IO.File]::ReadAllText($path,[Text.Encoding]::UTF8)}
$backedUp = $false
$success = $false
try {
 Say 'MICHBASOT | P2P R6 | bounded retry and tracker ACK'
 Say 'Close the office program before running this update.'
 foreach($f in @($lib,$html,$officeController,$source)){
   if(-not(Test-Path -LiteralPath $f -PathType Leaf)){throw ('STOP: missing file '+$f)}
 }
 if((Hash $source) -ne $newHash){throw 'STOP: update archive checksum mismatch'}
 $currentHash = Hash $lib
 if(@($oldHash,$newHash) -notcontains $currentHash){throw ('STOP: office P2P engine version not recognized: '+$currentHash)}
 $officeJs = Read $officeController
 if(-not $officeJs.Contains('MB_CHAIN_END_TO_END_20261108_R5') -or -not $officeJs.Contains('apk_otp_sent')){
   throw 'STOP: office controller is not the supported R5 OTP version'
 }
 $originalHtml = Read $html
 if(-not $originalHtml.Contains('p2p-apk-lib.js') -or -not $originalHtml.Contains('p2p-apk-office.js')){
   throw 'STOP: office P2P HTML is not the supported version'
 }
 $newHtml = [regex]::Replace($originalHtml,'(?<=p2p-apk-lib\.js)(?:\?[^"''\s<>]*)?','?v=p2p-r6-20261108')
 if(-not $newHtml.Contains('p2p-apk-lib.js?v=p2p-r6-20261108')){throw 'STOP: office HTML cache version could not be set'}
 New-Item -ItemType Directory -Path $backup -Force | Out-Null
 Copy-Item -LiteralPath $lib -Destination (Join-Path $backup 'p2p-apk-lib.js') -ErrorAction Stop
 Copy-Item -LiteralPath $html -Destination (Join-Path $backup 'p2p-apk-office.html') -ErrorAction Stop
 $backedUp = $true
 Say ('BACKUP: '+$backup)
 Copy-Item -LiteralPath $source -Destination ($lib+'.r6tmp') -Force
 Copy-Item -LiteralPath ($lib+'.r6tmp') -Destination $lib -Force
 [IO.File]::WriteAllText($html,$newHtml,$enc)
 if((Hash $lib) -ne $newHash){throw 'STOP: new library hash mismatch after copy'}
 if(-not (Read $html).Contains('p2p-apk-lib.js?v=p2p-r6-20261108')){throw 'STOP: cache version mismatch'}
 Say 'SUCCESS: P2P R6 engine and office cache version installed.'
 Say 'UNCHANGED: SMS bridge, server.py, office OTP, monitor, user data, APK files, app roles.'
 Say 'NEXT: restart the office app. Upload the four GITHUB files to Pages, then try the existing invite link.'
 Say 'NOTE: This update cannot overcome NAT configurations requiring TURN.'
 $success = $true
} catch {
 Say ('STOP: '+$_.Exception.Message)
 if($backedUp){
   try {
     Copy-Item -LiteralPath (Join-Path $backup 'p2p-apk-lib.js') -Destination $lib -Force -ErrorAction Stop
     Copy-Item -LiteralPath (Join-Path $backup 'p2p-apk-office.html') -Destination $html -Force -ErrorAction Stop
     Say 'ROLLBACK: Original office files restored.'
   }catch{Say ('ROLLBACK WARNING: restore manually from '+$backup)}
 }
} finally {
 Remove-Item -LiteralPath ($lib+'.r6tmp') -Force -ErrorAction SilentlyContinue
 try{[IO.File]::WriteAllLines($result,$log.ToArray(),$enc);Start-Process -FilePath notepad.exe -ArgumentList @('"'+$result+'"')}catch{}
}
if(-not $success){exit 1}
exit 0
