# Ciné Illimité

Appli perso : les séances UGC / MK2 (carte UGC Illimité) près de toi, avec affiches, bandes-annonces, recommandations et journal.

## Lancer en local (sur ce Mac)

    cd ~/cine-illimite
    node scripts/fetch.mjs          # recharge les séances (≈ 1 min)
    python3 -m http.server 8765     # puis ouvre http://localhost:8765

Le jeton TMDB (bandes-annonces) se met dans le fichier `.tmdb_token` (une seule ligne), il n'est jamais publié.

## Mettre en ligne (GitHub Pages, gratuit)

1. Crée un compte sur github.com puis un dépôt **public** nommé `cine-illimite`.
2. Envoie tout le contenu de ce dossier dans le dépôt (bouton « uploading an existing file », glisser-déposer), sauf `.tmdb_token`.
3. Dépôt › Settings › Secrets and variables › Actions :
   - onglet *Secrets* › New repository secret : nom `TMDB_TOKEN`, valeur = ton jeton TMDB ;
   - onglet *Variables* › New repository variable : nom `LETTERBOXD_USER`, valeur = ton pseudo Letterboxd (quand tu l'auras).
4. Settings › Actions › General › Workflow permissions : coche « Read and write permissions ».
5. Settings › Pages : Source « Deploy from a branch », branche `main`, dossier `/ (root)`.
6. Onglet Actions › « Mise à jour des séances » › Run workflow (première mise à jour).
7. L'appli est à l'adresse `https://<ton-pseudo>.github.io/cine-illimite/`. Sur iPhone : Safari › Partager › « Sur l'écran d'accueil ».

Ensuite les séances se mettent à jour toutes seules chaque nuit et le mercredi midi.

## Salles

Liste dans `cinemas.json` (code AlloCiné, nom, adresse, coordonnées). Pour ajouter une salle, trouve son code sur allocine.fr (adresse de la page de la salle, du type `csalle=C0146`).
