<#
  Crée la tâche planifiée « Relais GTC Eurexpo » : lance relais-gtc.ps1 toutes les heures (à hh:02).
  À lancer UNE fois, en administrateur, dans le dossier du relais :
    powershell -ExecutionPolicy Bypass -File installer-tache.ps1
  Pour l'enlever : powershell -ExecutionPolicy Bypass -File installer-tache.ps1 -Retirer
#>
param([switch]$Retirer)
$Nom = 'Relais GTC Eurexpo'
$Dossier = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($Retirer) { Unregister-ScheduledTask -TaskName $Nom -Confirm:$false; Write-Host 'Tâche retirée.'; exit 0 }
$Script = Join-Path $Dossier 'relais-gtc.ps1'
$Action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $Script + '"') -WorkingDirectory $Dossier
$Debut = (Get-Date).Date.AddHours((Get-Date).Hour + 1).AddMinutes(2)
$Declencheur = New-ScheduledTaskTrigger -Once -At $Debut -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration (New-TimeSpan -Days 3650)
$Reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
$Compte = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $Nom -Action $Action -Trigger $Declencheur -Settings $Reglages -Principal $Compte -Force | Out-Null
Write-Host ('Tâche « ' + $Nom + ' » créée : toutes les heures à partir de ' + $Debut.ToString('HH:mm') + ' (compte SYSTEM, même session fermée).')
Write-Host 'Premier envoi tout de suite...'
Start-ScheduledTask -TaskName $Nom
