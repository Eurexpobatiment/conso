# Fonctions Firebase « conso-api » et « conso-quotidien »

Appels d'API de l'appli Consommations halls, à la place des scripts Google :
- **Météo-France (DPClim)** : bouton « Mettre à jour » de l'onglet Météo, et chaque matin à 8 h 17 (Cloud Scheduler).
  Les jours sont écrits dans Firestore `ConsoMeteo/{année}` (champ `j`) ; l'appli les ajoute à ceux du classeur
  (Firebase l'emporte). La saisie manuelle d'un jour va aussi dans `ConsoMeteo`.
- **FusionSolar** (PV du hall 4.3) : bouton « Actualiser FusionSolar » de l'onglet PV (remplace le relais Google
  « Relais FusionSolar PV 4.3 » et sa clé RELAY_KEY). Les jours relevés sont encore enregistrés dans le classeur (pvEnregistrer).
- Agregio : pas encore d'API (import JSON de l'onglet PV) ; à ajouter ici quand l'accès sera ouvert.

Tant que la fonction n'est pas déployée, l'appli repasse automatiquement par les scripts Google.

- Région : europe-west9 (Paris) · URL : https://europe-west9-equipe-batiment.cloudfunctions.net/conso-api
- Accès : appareil qui a donné le code des réglages (jeton Firebase + `ConsoSessions`) ; jeton App Check vérifié s'il est
  présent (le rendre obligatoire : variable `REQUIRE_APP_CHECK=1`).
- Clés : secrets `meteo-cle`, `fusionsolar-user`, `fusionsolar-code` (Secret Manager). Jamais dans le code ni dans Firebase.

## Mise en place (une fois, dans Cloud Shell du projet equipe-batiment)

1. Secrets (les valeurs sont demandées et ne s'affichent pas). Clé Météo-France : celle du portail-api.meteofrance.fr
   (onglet Parametres du classeur, ligne MeteoCle). Identifiants FusionSolar : propriétés FS_USER / FS_CODE du projet
   Apps Script « Relais FusionSolar PV 4.3 ».
```
gcloud config set project equipe-batiment
read -s -p 'Clé Météo-France : ' K && echo && read -p 'Compte API FusionSolar (FS_USER) : ' U && read -s -p 'Mot de passe API FusionSolar (FS_CODE) : ' C && echo && for s in meteo-cle fusionsolar-user fusionsolar-code; do gcloud secrets describe $s >/dev/null 2>&1 || gcloud secrets create $s --replication-policy=user-managed --locations=europe-west9; done && printf '%s' "$K" | gcloud secrets versions add meteo-cle --data-file=- && printf '%s' "$U" | gcloud secrets versions add fusionsolar-user --data-file=- && printf '%s' "$C" | gcloud secrets versions add fusionsolar-code --data-file=- ; unset K U C
SA=$(gcloud projects describe equipe-batiment --format='value(projectNumber)')-compute@developer.gserviceaccount.com; for s in meteo-cle fusionsolar-user fusionsolar-code; do gcloud secrets add-iam-policy-binding $s --member=serviceAccount:$SA --role=roles/secretmanager.secretAccessor --quiet >/dev/null; done; echo OK
```

2. Déploiement (même commande pour les mises à jour). Remplacer le domaine si FusionSolar n'est pas sur eu5
   (propriété FS_DOMAIN du relais Google).
```
rm -rf ~/conso && git clone -q --depth 1 https://github.com/Eurexpobatiment/conso ~/conso && cd ~/conso/functions/conso-api && gcloud functions deploy conso-api --gen2 --region=europe-west9 --runtime=nodejs22 --source=. --entry-point=api --trigger-http --allow-unauthenticated --memory=256Mi --max-instances=3 --timeout=120s --set-secrets=METEO_CLE=meteo-cle:latest,FS_USER=fusionsolar-user:latest,FS_CODE=fusionsolar-code:latest --set-env-vars=FS_DOMAIN=eu5.fusionsolar.huawei.com,FS_STATION=NE=370904290 && gcloud pubsub topics describe conso-quotidien >/dev/null 2>&1 || gcloud pubsub topics create conso-quotidien; gcloud functions deploy conso-quotidien --gen2 --region=europe-west9 --runtime=nodejs22 --source=. --entry-point=quotidien --trigger-topic=conso-quotidien --memory=256Mi --max-instances=1 --timeout=120s --set-secrets=METEO_CLE=meteo-cle:latest
```

3. Tâche du matin (une fois) :
```
gcloud scheduler jobs create pubsub conso-meteo-quotidien --location=europe-west1 --schedule='17 8 * * *' --time-zone=Europe/Paris --topic=conso-quotidien --message-body=meteo
```

4. Règles Firestore : ajouter le bloc `ConsoMeteo` de `v2/firestore-conso.rules`, puis Publier.

5. Ensuite, dans le script Google de l'appli Consommations, supprimer le déclencheur quotidien `majMeteo`
   (la fonction le remplace) ; le relais Google FusionSolar peut être gardé en secours ou archivé.

Changer la clé Météo-France plus tard :
```
read -s -p 'Clé Météo-France : ' K && echo && printf '%s' "$K" | gcloud secrets versions add meteo-cle --data-file=- ; unset K; for f in conso-api conso-quotidien; do gcloud run services update $f --region=europe-west9 --update-labels=maj=$(date +%s) --quiet; done
```
