# Spotithèque

Appli web personnelle pour mettre des **tags** sur les albums de sa bibliothèque Spotify, les retrouver par tags et **les lancer directement sur le Spotify de son iPhone**. Mono-utilisateur, installable sur l'écran d'accueil, hébergée gratuitement sur Cloudflare.

## Fonctionnalités

- Import et synchronisation des albums sauvegardés dans Spotify (les albums retirés gardent leurs tags).
- Tags libres avec couleur : création à la volée, renommage, fusion, suppression.
- Tag en masse (sélection multiple, « Tout sélectionner », annulation).
- Recherche par titre ou artiste, filtres par tags (ET / OU, exclusion par appui long), filtres « Sans tag » et « Retirés de Spotify », tri, « Surprends-moi ».
- Lecture d'un album sur un appareil Spotify (Spotify Connect), dans l'ordre. Si Spotify est fermé sur l'iPhone, l'album s'ouvre dans l'appli et la lecture démarre dès que le téléphone se connecte.
- Export / import des tags en JSON.

## Architecture

| Élément | Choix |
| --- | --- |
| Interface | React + TypeScript (Vite), PWA optimisée pour l'iPhone |
| Serveur | Cloudflare Worker (Hono) qui sert l'interface et l'API `/api/*` |
| Base de données | Cloudflare D1 (SQLite), migrations dans `migrations/` |
| Connexion | OAuth Spotify côté serveur ; seul le compte propriétaire est accepté |

La synchronisation lit la bibliothèque Spotify **depuis le navigateur**, avec un jeton temporaire fourni par le Worker : les réponses de Spotify sont trop lourdes pour la limite de 10 ms de CPU par requête de l'offre gratuite de Cloudflare.

```
src/       interface React (écrans, store, synchro)
worker/    API Hono (auth, bibliothèque, tags, lecture, sauvegarde)
shared/    types et règles communs aux deux
migrations/ schéma D1
scripts/   données fictives pour le développement
```

## Développement local

Prérequis : Node.js 22.12 ou plus.

```bash
npm install
cp .dev.vars.example .dev.vars   # renseigner SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET
npm run db:migrate               # crée la base SQLite locale
npm run db:seed                  # facultatif : 360 albums fictifs
npm run dev                      # http://127.0.0.1:5173
```

- Ouvrir **http://127.0.0.1:5173** et non `localhost` : Spotify refuse `localhost` comme adresse de retour.
- Sans compte Spotify, le lien « Connexion de développement » (activé par `DEV_LOGIN=1` dans `.dev.vars`) ouvre une session locale pour tester l'interface.
- `npm test` lance les tests unitaires, `npm run typecheck` vérifie les types.

## Mise en place (une seule fois)

1. **Cloudflare** : créer un compte gratuit, puis `npx wrangler login`.
2. **Base** : `npx wrangler d1 create spotitheque --location weur`, puis reporter l'identifiant obtenu dans `database_id` de `wrangler.jsonc`.
3. **App Spotify** sur [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) (API « Web API ») avec deux Redirect URIs :
   - `https://spotitheque.<sous-domaine>.workers.dev/api/auth/callback`
   - `http://127.0.0.1:5173/api/auth/callback`
4. Reporter le **Client ID** dans `vars.SPOTIFY_CLIENT_ID` de `wrangler.jsonc`, puis enregistrer le secret : `npx wrangler secret put SPOTIFY_CLIENT_SECRET`.
5. `npm run deploy`, ouvrir l'URL et se connecter : ce premier compte devient le propriétaire.

Le mode développement de Spotify exige que le propriétaire de l'app ait **Spotify Premium** ; l'autorisation expire au bout de 6 mois (l'appli propose alors de se reconnecter).

## Déploiement

```bash
npm run deploy
```

Applique les migrations D1 en attente, construit l'interface puis déploie le Worker. On peut aussi relier le dépôt à **Workers Builds** pour déployer à chaque push.

## Installer sur l'iPhone

Ouvrir l'URL dans Safari, bouton Partager, **« Sur l'écran d'accueil »**, puis se connecter avec Spotify depuis l'icône.
