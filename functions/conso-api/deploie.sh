#!/bin/bash
# Déploie conso-api et conso-quotidien, puis la tâche du matin. Lancer dans Cloud Shell : bash deploie.sh [domaine FusionSolar]
set -e
DOM=${1:-eu5.fusionsolar.huawei.com}
gcloud config set project equipe-batiment >/dev/null 2>&1
rm -rf ~/conso && git clone -q --depth 1 https://github.com/Eurexpobatiment/conso ~/conso && cd ~/conso/functions/conso-api
gcloud functions deploy conso-api --gen2 --region=europe-west9 --runtime=nodejs22 --source=. --entry-point=api --trigger-http --allow-unauthenticated \
  --memory=256Mi --max-instances=3 --timeout=120s \
  --set-secrets=METEO_CLE=meteo-cle:latest,FS_USER=fusionsolar-user:latest,FS_CODE=fusionsolar-code:latest \
  --set-env-vars=FS_DOMAIN=$DOM,FS_STATION=NE=370904290
gcloud pubsub topics describe conso-quotidien >/dev/null 2>&1 || gcloud pubsub topics create conso-quotidien
gcloud functions deploy conso-quotidien --gen2 --region=europe-west9 --runtime=nodejs22 --source=. --entry-point=quotidien --trigger-topic=conso-quotidien \
  --memory=256Mi --max-instances=1 --timeout=120s --set-secrets=METEO_CLE=meteo-cle:latest
gcloud scheduler jobs describe conso-meteo-quotidien --location=europe-west1 >/dev/null 2>&1 || \
  gcloud scheduler jobs create pubsub conso-meteo-quotidien --location=europe-west1 --schedule='17 8 * * *' --time-zone=Europe/Paris --topic=conso-quotidien --message-body=meteo
echo OK-DEPLOIEMENT
