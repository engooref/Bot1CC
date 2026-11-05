# Tester le bot en réel, sans toucher à la production

Le bot de test tourne **dans Docker**, avec **son propre bot Discord** sur **un serveur Discord de test**, et il utilise la **base et les paramètres du site de développement** (Site1CC). Rien n'est partagé avec la production : ni jeton Discord, ni base, ni secret.

> Cet environnement a été écrit sans que son auteur puisse l'exécuter (pas de Docker dans son environnement). Si une étape échoue, note son numéro et le message d'erreur complet.

## Comment ça s'assemble

| Élément | En production | En test local |
| --- | --- | --- |
| Discord | bot et serveur du 1CC | **seconde application** du portail développeur, invitée sur un **serveur vide** que tu crées |
| Base MySQL | `1cc_prod` | MySQL de Site1CC en Docker (port 3308 de ta machine), la même base que le site de développement |
| Paramètres (rôles, salons, catégories) | administration du vrai site | administration du site local (<http://localhost:8000/admin/bot-settings>), avec les ID de ton serveur de test |
| Site → bot | `BASE_URI:BOT_PORT` | le site local appelle `http://host.docker.internal:3001` |
| Commandes slash | enregistrées globalement pour le bot de production | enregistrées globalement pour **ton** bot de test uniquement (autre application, aucun conflit) |

Le bot lit ses paramètres sur le site (`URL_SITE`, `BOT_TOKEN`) et partage ses tables avec lui : **le site de développement doit tourner avant le bot**.

## 1. Les outils

Les mêmes que pour le site : Git, Docker Desktop, VS Code (voir `docs/installation-locale.md` dans Site1CC). Le site de développement doit déjà fonctionner (`Dev: Lancer le site (tout faire)`).

## 2. Un bot et un serveur Discord de test

1. Sur Discord, crée un **serveur vide** (il servira uniquement aux essais).
2. Dans le [portail développeur](https://discord.com/developers/applications), crée une **nouvelle application** avec un bot. Active les intents *Server Members* et *Message Content* (et laisse les autres par défaut).
3. Invite ce bot sur ton serveur de test avec les permissions d'administrateur (ou les mêmes que le bot réel).
4. Note : le **jeton du bot** (`DISCORD_TOKEN`), l'**ID du serveur** (`GUILD_ID`), l'**ID du rôle « Membre »** du serveur de test (`ROLE_ID`) et ton **ID Discord** (`ENGOO_ID`). Active le mode développeur de Discord pour copier les ID.

N'utilise jamais le jeton du bot de production.

## 3. Premier démarrage

1. Lance le site : tâche `Dev: Lancer le site (tout faire)` dans Site1CC.
2. Dans Bot1CC, lance la tâche **`Bot: Lancer le bot de test (tout faire)`** (`Ctrl+Maj+B`). Équivalent terminal : `scripts/dev.sh start` (Linux, macOS) ou `.\scripts\dev.ps1 start` (Windows).
3. La première fois, elle crée `.env` depuis `docker/dev/env.dev` et **s'arrête** : ouvre `.env` et renseigne `DISCORD_TOKEN`, `GUILD_ID`, `ROLE_ID` et `ENGOO_ID`, puis relance la tâche.
4. Elle vérifie le poste (Docker, site sur le port 8000, base sur le port 3308), construit l'image, installe les dépendances, compile, crée les tables propres au bot si elles manquent (voir plus bas) et démarre le bot. Une ligne `KO` en tête de sortie signifie qu'un prérequis manque.
5. Les journaux défilent à la fin. Le bot doit afficher « Discord connecté en tant que » suivi du nom de ton bot de test.

La tâche est répétable : elle n'installe que ce qui a changé.

## 4. Brancher le site sur le bot local

Sans cette étape, le bot lit bien ses paramètres, mais le site ne peut pas lui envoyer d'ordres (promotions, décisions de recrutement…).

1. Lance la tâche `Bot: Valeurs à mettre dans le .env du site`. Elle affiche quatre lignes (`BASE_URI`, `BOT_PORT`, `BOT_TOKEN`, `BOT_SHARED_SECRET`).
2. Copie-les dans le `.env` de **Site1CC** (fichier local, jamais commité). `BASE_URI` doit rester **sans port** : le site colle `BASE_URI` et `BOT_PORT`.
3. Dans Site1CC : `Dev: Arrêter` puis `Dev: Lancer le site (tout faire)`.
4. Sous **Linux**, le conteneur `php` du site ne connaît pas `host.docker.internal` : ajoute `extra_hosts: ["host.docker.internal:host-gateway"]` à son service `php` dans ton exemplaire local de `compose.dev.yaml` (sous Windows et macOS, Docker Desktop le fournit).

Le bot et le site doivent partager `BOT_TOKEN` et `BOT_SHARED_SECRET` (valeurs factices ici).

## 5. Régler les paramètres du serveur de test

Connecte-toi au site local (<http://localhost:8000/dev/login>, `Admin Dev`), ouvre **/admin/bot-settings** et renseigne les ID de **rôles, salons et catégories de ton serveur de test** (voir `docs/settings-config.md` et `docs/app_settings/`). Le bot garde les paramètres en cache 5 minutes : relance-le (`Bot: Recompiler et relancer`) pour qu'il les relise tout de suite.

Les paramètres sont stockés dans la base **locale** : tu ne modifies pas ceux du vrai site.

## 6. Une journée type

1. Lance Docker Desktop, puis le site (`Dev: Lancer le site (tout faire)`).
2. Lance `Bot: Lancer le bot de test (tout faire)`.
3. Après une modification du code : `Bot: Recompiler et relancer` (le démarrage recompile toujours).
4. Avant une PR : `Bot: Tests (comme la CI)`.
5. Fin de journée : `Bot: Arrêter` puis `Dev: Arrêter` pour le site. Les données locales restent.

## 7. Les tâches

| Tâche | Commande | Rôle |
| --- | --- | --- |
| Lancer le bot de test (tout faire) | `start` | Tout ce qui précède, de façon répétable |
| Recompiler et relancer | `restart` | Recrée le conteneur ; le bot recompile et redémarre |
| Arrêter | `down` | Arrête le bot de test (la base du site n'est pas touchée) |
| Journaux | `logs` | Journaux du bot en direct |
| Tests (comme la CI) | `test` | Les cinq scripts de test lancés par la CI de GitHub |
| Tous les tests | `test-all` | Tous les `tests/*.test.mjs` (certains ne sont pas lancés par la CI) |
| Compiler | `build` | `npm run build` dans le conteneur |
| Voir les tables à créer | `init-tables` | Affiche, sans rien modifier, les tables propres au bot absentes de la base locale |
| Valeurs à mettre dans le .env du site | `site-config` | Les quatre lignes de l'étape 4 |
| Terminal dans le conteneur | `shell` | Un terminal pour lancer d'autres commandes npm |
| Tout supprimer et repartir de zéro | `reset-all` | Supprime le conteneur et `node_modules` du bot (pas la base) |

## Les tables du bot

Le schéma de la base est décrit par les migrations de Site1CC, y compris les tables du recrutement. Trois tables n'y figurent pas, parce que le bot les possède encore : `view_context`, `diplomatie_corporation` et `diplomatie_demande` (la liste de `src/FilteredMigrationGenerator.ts`). `scripts/dev-init-tables.mjs` les crée dans la base **locale** si elles manquent. Il refuse de s'exécuter si `MYSQL_URL` ne vise pas `host.docker.internal`, `localhost`, `127.0.0.1` ou `db`, ne modifie aucune table existante et ne supprime rien.

Il ne crée **pas** de migration et ne touche ni aux migrations existantes ni à `.gitignore`.

## Ce qui est volontairement désactivé

- `GITHUB_TOKEN` est vide : `/github issue` ne peut créer aucun ticket sur les dépôts publics. Pour l'essayer, utilise un jeton limité à un dépôt de test, jamais celui de production.
- Les valeurs de `BOT_TOKEN` et `BOT_SHARED_SECRET` sont factices et propres à cet environnement.
- `NODE_ENV=prod` dans `.env` veut seulement dire « code compilé » (l'ORM cherche alors les entités dans `dist/`). Ce n'est pas la production.

## Pièges

- **Ne mets jamais dans `.env` le jeton, le secret ou la base de production.** `.env` est ignoré par git, mais ne le colle nulle part.
- La connexion SQL `prod` de `.vscode/settings.json` vise la production : ne l'utilise pas pour les essais. Pour explorer la base locale, connecte-toi à `127.0.0.1:3308` (base `site1cc`, utilisateur `app`, mot de passe `app`).
- Le bot de test agit sur **ton serveur de test**, mais avec la vraie logique : il crée des salons, change des pseudos et des rôles. C'est le but ; garde ce serveur pour cela.
- Les ID de rôles et de salons du site local doivent être ceux du serveur de test. Si un rôle est introuvable, vérifie d'abord `/admin/bot-settings`.
- Les anciennes données du bot (candidatures, tickets) ne sont pas dans le dump anonymisé du site (tables vidées). Crée des candidatures de test à la main depuis le serveur de test.
- Si `npm ci` échoue à la compilation de `canvas` ou de `@discordjs/opus`, ouvre un terminal dans le conteneur (`Bot: Terminal dans le conteneur`) et relance-le pour lire l'erreur complète.
