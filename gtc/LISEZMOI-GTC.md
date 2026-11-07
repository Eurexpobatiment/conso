# Onglet GTC : compteurs PDL 1, PDL 2 et gaz lus dans PcVue

PcVue est sur le réseau interne d'Eurexpo. Ni l'appli (GitHub Pages) ni le script Google ne peuvent le joindre.
Un **relais** tourne donc sur un PC Windows du site, allumé en permanence. Toutes les heures, il lit les index
dans PcVue (API web « Web Services Toolkit », la même base que WebVue) et les envoie dans Firebase (collection `ConsoGTC`).
L'onglet **GTC** de l'appli les affiche : index, conso du jour, de la veille et du mois, graphiques sur 30 jours et 12 mois,
profil horaire, conso de chaque salon (à comparer avec la fiche salon), export CSV.

## 1. Règles Firebase (une fois)
Console Firebase › equipe-batiment › Firestore Database › Règles : remplacer le bloc « Consommations halls »
par celui de `v2/firestore-conso.rules`. Ce bloc contient maintenant `match /ConsoGTC/{id}` : lecture libre,
écriture seulement avec le code des réglages. Puis cliquer sur **Publier**.

## 2. Ce qu'il faut demander à l'intégrateur PcVue / Dalkia
- l'**adresse du serveur web PcVue** (celle de WebVue, sans `/WebVue` à la fin) et l'adresse du jeton si elle n'est pas `…/OAuth/token` ;
- un **client OAuth** pour l'API REST du Web Services Toolkit : `client_id` et `client_secret` (créés dans la Web Deployment Console) ;
- un **compte PcVue en lecture seule** (utilisateur + mot de passe) qui a le droit de lire les données temps réel ;
- s'ils les connaissent, les **noms des variables** des index PDL 1, PDL 2 et gaz. Sinon, le mode Explorer les retrouve (étape 4).
- Vérifier aussi que les index sont **cumulés** (kWh qui ne font que monter), et pas une puissance instantanée.
  Pour le gaz, demander l'unité (kWh ou m³) et, en m³, le coefficient de conversion en kWh à mettre dans `coef`.

## 3. Installation sur le PC
1. Copier le dossier `gtc` sur le PC, par exemple dans `C:\RelaisGTC`.
2. Copier `config-gtc.exemple.json` en **`config-gtc.json`** et le remplir : adresse PcVue, identifiants, code des réglages de l'appli
   (champ `firebase.code`) et noms des variables. `config-gtc.json` contient des mots de passe : il reste sur ce PC et ne va jamais sur GitHub.
3. Si internet passe par un proxy, renseigner `firebase.proxy` (exemple : `http://proxy:8080`).

## 4. Essais (PowerShell, dans le dossier)
```
powershell -ExecutionPolicy Bypass -File relais-gtc.ps1 -Explorer               # dossiers de la racine PcVue
powershell -ExecutionPolicy Bypass -File relais-gtc.ps1 -Explorer "SITE.ENERGIE"  # descendre dans un dossier
powershell -ExecutionPolicy Bypass -File relais-gtc.ps1 -Test                   # lit les 3 compteurs, n'envoie rien
powershell -ExecutionPolicy Bypass -File relais-gtc.ps1                         # lit et envoie : l'onglet GTC se remplit
```

## 5. Lancement automatique
En administrateur : `powershell -ExecutionPolicy Bypass -File installer-tache.ps1`
Cette commande crée la tâche planifiée « Relais GTC Eurexpo », qui tourne toutes les heures à hh:02, même session fermée, et fait un premier envoi tout de suite.
Pour l'enlever : `installer-tache.ps1 -Retirer`. Le journal est dans `relais-gtc.log`.

## Bon à savoir
- L'historique commence le jour de l'installation : le relais ne remonte pas le passé.
  Si besoin, on pourra plus tard récupérer les courbes historisées de PcVue (API HistoricalData).
- Si le PC est éteint quelques heures, les consommations sont calculées entre deux relevés, en répartissant l'écart d'index sur les heures manquantes.
  Au-delà de 36 h sans relevé, la période est marquée `*` (incomplète).
- Le bandeau en haut de l'onglet passe en orange si le relais n'a rien envoyé depuis plus de 2 h 30, ou si PcVue a renvoyé une erreur.
- Pour ajouter un compteur, il suffit d'ajouter une ligne dans `compteurs` (identifiant court sans espace). L'appli l'affiche automatiquement.
