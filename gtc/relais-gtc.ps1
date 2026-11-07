<#
  Relais GTC : PcVue (réseau Eurexpo) -> Firebase (appli Consommations halls, onglet GTC)

  Lit les index des compteurs déclarés dans config-gtc.json (PDL 1, PDL 2, gaz...) par l'API web de PcVue
  (Web Services Toolkit REST), puis les envoie dans Firebase (collection ConsoGTC).
  Prévu pour Windows PowerShell 5.1 (déjà présent sur Windows 10/11) : rien à installer.

  Utilisation (dans le dossier du script) :
    powershell -ExecutionPolicy Bypass -File relais-gtc.ps1 -Explorer            # liste les dossiers/variables PcVue
    powershell -ExecutionPolicy Bypass -File relais-gtc.ps1 -Explorer "SITE.TGBT" # liste le contenu d'un dossier
    powershell -ExecutionPolicy Bypass -File relais-gtc.ps1 -Test                # lit les compteurs, n'envoie rien
    powershell -ExecutionPolicy Bypass -File relais-gtc.ps1                      # lit et envoie (tâche planifiée)
#>
param(
  [switch]$Test,
  [switch]$Explorer,
  [Parameter(Position = 0)][string]$Branche = ''
)

$ErrorActionPreference = 'Stop'
$Dossier = Split-Path -Parent $MyInvocation.MyCommand.Path
$FichierConfig = Join-Path $Dossier 'config-gtc.json'
$FichierEtat = Join-Path $Dossier 'etat-relais.json'   # jeton Firebase du relais (créé tout seul)
$FichierLog = Join-Path $Dossier 'relais-gtc.log'

$FB_CLE = 'AIzaSyARtP0RMkulG6c53-bnazwpGTspl0LgAhk'      # clé publique Firebase (pas un secret)
$FB_DOCS = 'projects/equipe-batiment/databases/(default)/documents'
$FB_URL = 'https://firestore.googleapis.com/v1/' + $FB_DOCS
$VERSION = '1.0'

[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Log([string]$t) {
  $l = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $t
  Write-Host $l
  try {
    Add-Content -Path $FichierLog -Value $l -Encoding UTF8
    $f = Get-Item $FichierLog
    if ($f.Length -gt 1MB) { $x = Get-Content $FichierLog -Encoding UTF8 | Select-Object -Last 2000; Set-Content $FichierLog $x -Encoding UTF8 }
  } catch {}
}

function LireJson([string]$p) { return (Get-Content -Path $p -Raw -Encoding UTF8 | ConvertFrom-Json) }

if (-not (Test-Path $FichierConfig)) { Log "config-gtc.json absent : copier config-gtc.exemple.json en config-gtc.json et le remplir."; exit 1 }
$C = LireJson $FichierConfig
$PV = $C.pcvue
$BASE = ([string]$PV.url).TrimEnd('/')
$URL_JETON = [string]$PV.url_jeton
if (-not $URL_JETON) { $URL_JETON = $BASE + '/OAuth/token' }

# Certificat HTTPS de PcVue souvent auto-signé : accepté pour le seul serveur PcVue si verifier_certificat = false
if ($PV.verifier_certificat -eq $false) {
  if (-not ('GtcCert' -as [type])) {
    Add-Type -TypeDefinition @'
using System; using System.Net; using System.Net.Security; using System.Security.Cryptography.X509Certificates;
public static class GtcCert {
  public static string Hote;
  public static bool Valider(object s, X509Certificate c, X509Chain ch, SslPolicyErrors e) {
    if (e == SslPolicyErrors.None) return true;
    HttpWebRequest r = s as HttpWebRequest;
    return r != null && Hote != null && string.Equals(r.RequestUri.Host, Hote, StringComparison.OrdinalIgnoreCase);
  }
}
'@
  }
  [GtcCert]::Hote = ([Uri]$BASE).Host
  [Net.ServicePointManager]::ServerCertificateValidationCallback = [Delegate]::CreateDelegate([Net.Security.RemoteCertificateValidationCallback], [GtcCert].GetMethod('Valider'))
}

# Proxy internet éventuel (pour joindre Firebase), ex. "http://proxy:8080"
$FbOpt = @{}
if ($C.firebase.proxy) { $FbOpt = @{ Proxy = [string]$C.firebase.proxy; ProxyUseDefaultCredentials = $true } }

function Detail($err) {
  $m = $err.Exception.Message
  try { if ($err.ErrorDetails -and $err.ErrorDetails.Message) { $m += ' - ' + $err.ErrorDetails.Message } } catch {}
  return $m
}

# ======================= PcVue =======================
function JetonPcVue {
  $corps = @{ grant_type = 'password'; client_id = [string]$PV.client_id; client_secret = [string]$PV.client_secret
              username = [string]$PV.utilisateur; password = [string]$PV.mot_de_passe; scope = 'RealtimeData' }
  try { $r = Invoke-RestMethod -Method Post -Uri $URL_JETON -Body $corps -ContentType 'application/x-www-form-urlencoded' -TimeoutSec 30 }
  catch { throw ('Connexion à PcVue refusée (' + $URL_JETON + ') : ' + (Detail $_)) }
  if (-not $r.access_token) { throw 'PcVue n''a pas renvoyé de jeton.' }
  return [string]$r.access_token
}

function EnTetes($jeton) { return @{ Authorization = 'Bearer ' + $jeton } }

function ExplorerPcVue($jeton, [string]$br) {
  $u = $BASE + '/RealTimeData/v2/Variables'
  if ($br) { $morceaux = @((($br -replace '\.', '/') -split '/') | Where-Object { $_ } | ForEach-Object { [Uri]::EscapeDataString($_) }); $u += '/' + ($morceaux -join '/') }
  $r = Invoke-RestMethod -Method Get -Uri $u -Headers (EnTetes $jeton) -TimeoutSec 60
  Write-Host ''
  Write-Host ('Contenu de ' + $(if ($br) { $br } else { '(racine)' }) + ' :')
  Write-Host ($r | ConvertTo-Json -Depth 6)
  Write-Host ''
  Write-Host 'Pour descendre dans un dossier : relais-gtc.ps1 -Explorer "DOSSIER.SOUS_DOSSIER"'
  Write-Host 'Le nom complet d''une variable (avec des points) est à mettre dans config-gtc.json, champ "variable".'
}

function LireCompteurs($jeton) {
  $noms = @($C.compteurs | ForEach-Object { ([string]$_.variable) -replace '/', '.' })
  $corps = @{ Variables = $noms } | ConvertTo-Json -Depth 4
  if ($noms.Count -eq 1) { $corps = '{"Variables":["' + $noms[0] + '"]}' }
  try { $r = Invoke-RestMethod -Method Post -Uri ($BASE + '/RealTimeData/v2/BulkRead') -Headers (EnTetes $jeton) -Body ([Text.Encoding]::UTF8.GetBytes($corps)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 60 }
  catch { throw ('Lecture des variables PcVue impossible : ' + (Detail $_)) }

  # Deux formes de réponse possibles : objet { "NOM": { value, QualityValue... } } ou tableau [ { Description, value } ]
  $parNom = @{}
  if ($r -is [array]) {
    foreach ($x in $r) { $n = $x.VariableName; if (-not $n) { $n = $x.Description }; if ($n) { $parNom[[string]$n] = $x } }
  } else {
    foreach ($p in $r.PSObject.Properties) { $parNom[[string]$p.Name] = $p.Value }
  }
  $res = @{}; $pb = @()
  foreach ($k in $C.compteurs) {
    $n = ([string]$k.variable) -replace '/', '.'
    $x = $parNom[$n]
    if ($null -eq $x) { $pb += ($k.nom + ' : variable introuvable (' + $n + ')'); continue }
    $v = $x.value; if ($null -eq $v) { $v = $x.Value }
    $q = $x.QualityValue
    if ($null -ne $q -and [int]$q -lt 192) { $pb += ($k.nom + ' : qualité ' + $q + ' (valeur non fiable, ignorée)'); continue }
    $d = 0.0
    if (-not [double]::TryParse(([string]$v).Replace(',', '.'), [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$d)) { $pb += ($k.nom + ' : valeur non numérique (' + $v + ')'); continue }
    $coef = 1.0; if ($null -ne $k.coef -and [string]$k.coef -ne '') { $coef = [double]$k.coef }
    $res[[string]$k.id] = [Math]::Round($d * $coef, 3)
  }
  return @{ valeurs = $res; problemes = $pb }
}

# ======================= Firebase =======================
function JetonFirebase {
  $code = [string]$C.firebase.code
  if (-not $code) { throw 'config-gtc.json : firebase.code (code des réglages de l''appli) manquant.' }
  $tok = $null
  if (Test-Path $FichierEtat) {
    try {
      $e = LireJson $FichierEtat
      $r = Invoke-RestMethod -Method Post -Uri ('https://securetoken.googleapis.com/v1/token?key=' + $FB_CLE) -Body @{ grant_type = 'refresh_token'; refresh_token = [string]$e.refresh } -TimeoutSec 30 @FbOpt
      $tok = @{ id = [string]$r.id_token; uid = [string]$r.user_id; refresh = [string]$r.refresh_token }
    } catch { $tok = $null }
  }
  if (-not $tok) {
    try { $r = Invoke-RestMethod -Method Post -Uri ('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + $FB_CLE) -Body '{"returnSecureToken":true}' -ContentType 'application/json' -TimeoutSec 30 @FbOpt }
    catch { throw ('Connexion à Firebase impossible (internet / proxy ?) : ' + (Detail $_)) }
    $tok = @{ id = [string]$r.idToken; uid = [string]$r.localId; refresh = [string]$r.refreshToken }
  }
  @{ refresh = $tok.refresh; uid = $tok.uid } | ConvertTo-Json | Set-Content -Path $FichierEtat -Encoding UTF8
  # session « code des réglages » (comme le script Google), nécessaire pour écrire dans ConsoGTC
  $s = @{ fields = @{ code = @{ stringValue = $code }; at = @{ stringValue = (Get-Date).ToUniversalTime().ToString('o') } } } | ConvertTo-Json -Depth 5
  try { Invoke-RestMethod -Method Patch -Uri ($FB_URL + '/ConsoSessions/' + $tok.uid) -Headers @{ Authorization = 'Bearer ' + $tok.id } -Body ([Text.Encoding]::UTF8.GetBytes($s)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 30 @FbOpt | Out-Null }
  catch { throw ('Code refusé par Firebase : firebase.code doit être le code des réglages de l''appli (' + (Detail $_) + ')') }
  return $tok.id
}

function ValeurFb($v) {
  if ($null -eq $v) { return @{ nullValue = $null } }
  if ($v -is [bool]) { return @{ booleanValue = $v } }
  if ($v -is [int] -or $v -is [long] -or $v -is [double] -or $v -is [decimal] -or $v -is [single]) { return @{ doubleValue = [double]$v } }
  if ($v -is [hashtable]) { $f = @{}; foreach ($k in $v.Keys) { $f[[string]$k] = ValeurFb $v[$k] }; return @{ mapValue = @{ fields = $f } } }
  if ($v -is [array]) { return @{ arrayValue = @{ values = @($v | ForEach-Object { ValeurFb $_ }) } } }
  return @{ stringValue = [string]$v }
}

function EcrireFb($jeton, [string]$chemin, [hashtable]$champs, [string[]]$masque) {
  $f = @{}; foreach ($k in $champs.Keys) { $f[$k] = ValeurFb $champs[$k] }
  $u = $FB_URL + '/' + $chemin
  if ($masque) { $u += '?' + (($masque | ForEach-Object { 'updateMask.fieldPaths=' + $_ }) -join '&') }
  $corps = @{ fields = $f } | ConvertTo-Json -Depth 12
  Invoke-RestMethod -Method Patch -Uri $u -Headers @{ Authorization = 'Bearer ' + $jeton } -Body ([Text.Encoding]::UTF8.GetBytes($corps)) -ContentType 'application/json; charset=utf-8' -TimeoutSec 30 @FbOpt | Out-Null
}

function Compteurs { return ,@($C.compteurs | ForEach-Object { @{ id = [string]$_.id; nom = [string]$_.nom; unite = $(if ($_.unite) { [string]$_.unite } else { 'kWh' }); type = $(if ($_.type) { [string]$_.type } else { 'elec' }) } }) }

# ======================= Programme =======================
try {
  if ($Explorer) { ExplorerPcVue (JetonPcVue) $Branche; exit 0 }

  $maintenant = Get-Date
  $lu = LireCompteurs (JetonPcVue)
  foreach ($k in $lu.valeurs.Keys) { Log ('  ' + $k + ' = ' + $lu.valeurs[$k]) }
  foreach ($p in $lu.problemes) { Log ('  ⚠ ' + $p) }
  if ($Test) { Log 'Test terminé : rien n''a été envoyé à Firebase.'; exit 0 }

  $fb = JetonFirebase
  $iso = $maintenant.ToString('yyyy-MM-ddTHH:mm:sszzz')
  if ($lu.valeurs.Count -gt 0) {
    $releve = @{ t = $iso }; foreach ($k in $lu.valeurs.Keys) { $releve[$k] = $lu.valeurs[$k] }
    $cle = 'h' + $maintenant.ToString('HH')
    EcrireFb $fb ('ConsoGTC/j-' + $maintenant.ToString('yyyy-MM-dd')) @{ d = $maintenant.ToString('yyyy-MM-dd'); $cle = $releve } @('d', $cle)
  }
  $ok = ($lu.problemes.Count -eq 0)
  $msg = $(if ($ok) { '' } else { $lu.problemes -join ' ; ' })
  EcrireFb $fb 'ConsoGTC/etat' @{ at = $iso; ok = $ok; msg = $msg; version = $VERSION; poste = $env:COMPUTERNAME; compteurs = (Compteurs); dernier = $(if ($lu.valeurs.Count) { $releve } else { @{ t = $iso } }) } $null
  Log ('Envoyé à Firebase (' + $lu.valeurs.Count + ' compteur(s)).')
  exit 0
} catch {
  $m = $_.Exception.Message
  Log ('ERREUR : ' + $m)
  # on essaie de signaler l'erreur dans l'appli
  if (-not $Test -and -not $Explorer) {
    try { $fb = JetonFirebase; EcrireFb $fb 'ConsoGTC/etat' @{ at = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz'); ok = $false; msg = $m; version = $VERSION; poste = $env:COMPUTERNAME; compteurs = (Compteurs) } @('at', 'ok', 'msg', 'version', 'poste', 'compteurs') } catch {}
  }
  exit 1
}
