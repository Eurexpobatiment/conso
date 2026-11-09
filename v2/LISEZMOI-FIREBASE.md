# Consommations halls – version Firebase

Même appli (mêmes onglets, mêmes calculs, mêmes rapports PDF), avec les données dans **Firebase**
(projet `equipe-batiment`, comme les applis Équipe, Températures et Relevés compteurs) au lieu du Google Sheet :
ouverture instantanée, consultation et saisie des index même sans réseau (envoi automatique au retour du réseau).

Adresse : https://eurexpobatiment.github.io/conso/ (version Firebase en service depuis le 6 nov. 2026 ; /v2/ redirige ici).
Mise en place faite le 6 nov. 2026 : règles publiées, ConsoSecret/code et CONSO_CODE créés, classeur copié (133 lignes, 27 salons),
script en version 58, bascule faite (installerFirebase). Le classeur n'est plus qu'une copie de Firebase.

## Ce qui change pour toi
- **Réglages modifiables dans l'appli**, plus dans le Google Sheet : paramètres de calcul, surfaces des halls,
  correspondance des températures et **lignes de comptage** (TGBT, nom de ligne, nombre de compteurs 1 à 5,
  coefficient de chaque compteur, compteurs comptés dans le total élec, usage CVC / FM / ECL / PV, ligne active ou non).
  Une ligne qui a déjà des index ne se supprime pas : on la passe en inactive (elle sort des calculs, ses index restent).
- **Code des réglages** : demandé une fois par appareil pour modifier les réglages. La saisie des index et des salons reste libre.
- **Clés API** : la clé Météo-France reste dans le script Google (onglet Parametres), jamais dans Firebase.
  Le champ « Clé API Météo-France » des Réglages l'envoie directement au script (avec le code des réglages).
- **Températures** : lues directement dans l'appli Températures (Firebase), en direct.

## Mise en route (une seule fois)
1. **Console Firebase › equipe-batiment › Firestore Database › Règles** : coller le bloc de `firestore-conso.rules`
   juste avant les deux dernières `}`, puis **Publier**.
2. **Firestore Database › Données** : créer la collection **ConsoSecret**, document **code**, champ **code** (chaîne) = le code des réglages choisi.
3. **Script Google de l'appli Consommations** (script.google.com) :
   - **Paramètres du projet › Propriétés du script** : ajouter `CONSO_CODE` = le même code ;
   - ajouter un fichier **Firebase** (il doit être le dernier de la liste) et y coller `Firebase.gs`, enregistrer ;
   - exécuter `copierVersFirebase` (copie de tout le classeur dans Firebase) ;
   - **Déployer › Gérer les déploiements › crayon › Version : Nouvelle version › Déployer** (même adresse).
4. Ouvrir https://eurexpobatiment.github.io/conso/v2/ et vérifier.
   Avant la bascule, `copierVersFirebase` peut être relancée : elle remplace ce qui est dans Firebase par le classeur.

## Bascule (quand la version Firebase est validée)
1. Exécuter `installerFirebase` dans le script : Firebase devient la référence. Une fois par nuit vers 3 h (`copieNuitFirebase`),
   et avant chaque rapport PDF ou export CSV, le classeur est recopié depuis Firebase ; toutes les 10 minutes (`majFirebase`),
   la météo, les DJU, Conso_Site et le PV sont republiés (sans relire Firebase).
   Depuis le 9 nov. 2026 : la copie du classeur ne se fait plus toutes les 10 minutes (≈ 17 000 lectures Firebase par jour,
   un tiers du quota gratuit), mais une fois par nuit (≈ 120 lectures).
   À partir de là, ne plus rien modifier dans le classeur ni dans l'ancienne version (ce serait écrasé).
2. Remplacer l'appli de la racine du dépôt par celle de `v2/`.
Retour en arrière possible : `desinstallerFirebase` (le classeur redevient la référence).

## Fonctionnement
- `ConsoConfig/params`, `halls`, `lignes`, `corr` : réglages (écriture avec le code des réglages).
- `ConsoSalons/{id}` : un document par salon ; `ConsoReleves/{id salon}` : les index du salon, ligne par ligne (champ `l`).
- `ConsoServeur/donnees` : publié par le script (météo, DJU historiques, Conso_Site, PV parking et hall 4.3, état de la clé) ;
  `ConsoServeur/logo` : le logo.
- Calculs : `metier.js`, reprise à l'identique du script (vérifié sur le classeur du 6 nov. 2026 : mêmes résultats pour les
  27 salons et pour l'aide à la saisie des index).
- Toujours faits par le script Google : météo Météo-France, rapports PDF salon et PV, onglet PV, charte, export CSV, onglet Eau.
