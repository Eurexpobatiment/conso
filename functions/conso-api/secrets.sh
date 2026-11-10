#!/bin/bash
# Secrets de conso-api (les valeurs sont demandées et ne s'affichent pas). Lancer dans Cloud Shell.
set -e
gcloud config set project equipe-batiment >/dev/null 2>&1
gcloud services enable cloudscheduler.googleapis.com
read -s -p 'Cle Meteo-France : ' K; echo
read -p 'Compte FusionSolar (FS_USER) : ' U
read -s -p 'Mot de passe FusionSolar (FS_CODE) : ' C; echo
for s in meteo-cle fusionsolar-user fusionsolar-code; do
  gcloud secrets describe $s >/dev/null 2>&1 || gcloud secrets create $s --replication-policy=user-managed --locations=europe-west9
done
printf '%s' "$K" | gcloud secrets versions add meteo-cle --data-file=-
printf '%s' "$U" | gcloud secrets versions add fusionsolar-user --data-file=-
printf '%s' "$C" | gcloud secrets versions add fusionsolar-code --data-file=-
unset K U C
SA=$(gcloud projects describe equipe-batiment --format='value(projectNumber)')-compute@developer.gserviceaccount.com
for s in meteo-cle fusionsolar-user fusionsolar-code; do
  gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor --quiet >/dev/null
done
echo OK-SECRETS
