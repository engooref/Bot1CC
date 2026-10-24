# Bot1CC — prise en main

Ce document est destiné à un développeur qui reprend le projet. Il explique à quoi sert le bot, comment l'installer et le lancer, comment le code est organisé et comment fonctionne le système de suivi avec les agents IA. Tout ce qui y figure a été relevé dans le code du dépôt ; ce que le dépôt ne documente pas est listé à la fin, dans « À compléter ».

## Rôle du bot

Bot Discord du 1CC, la communauté du jeu *1er Corps Colonial*. Il gère sur le serveur Discord les tickets, le recrutement et le parrainage, la diplomatie, les événements et opérations, la raffinerie, les réunions (avec transcription), la musique, les duels et classements, les contrats, les messages automatiques et le « screen of the week ».

Le bot travaille avec le site **Site1CC** (Symfony), dans les deux sens :

- **Le bot lit sa configuration sur le site.** `SettingsService` appelle l'adresse `URL_SITE` avec le jeton `BOT_TOKEN` et garde les paramètres en cache 5 minutes. Les identifiants de rôles, salons et catégories Discord sont donc réglés dans l'administration du site, pas dans le bot.
- **Le site appelle le bot.** Le bot lance un serveur Express (port `PORT`) avec les routes `/rank`, `/user`, `/leaderboards`, `/event`, `/settings`, `/operation` et `/refinery`. Chaque requête doit être signée avec le secret partagé `BOT_SHARED_SECRET` (en-têtes `X-Request-Id`, `X-Signature`, `X-Body-Hash`). Un middleware d'idempotence (`src/web/middlewares/IdemPotency.ts`) refuse de traiter deux fois le même `X-Request-Id` pendant 24 h ; cette mémoire est en RAM, elle est donc vidée à chaque redémarrage du bot. La route `/` répond `{"status":"online"}` sans signature : c'est le test de vie.

## Prérequis

- **Node 22.** L'installation a été vérifiée avec Node 22 ; elle échoue avec Node 24, parce que le module vocal `@discordjs/opus` n'a pas de binaire précompilé pour cette version et qu'il faudrait alors Python et les outils de compilation C++ de Windows.
- Une base **MySQL**.
- Un bot Discord créé dans le portail développeur, invité sur le serveur, avec les intents Guilds, GuildMessages, GuildMessageReactions, GuildMembers, GuildVoiceStates et MessageContent.
- Pour la transcription des réunions uniquement : un Python avec le moteur de transcription (`MEETING_STT_*`). Facultatif.

## Installation et lancement

```
npm ci
npm run build
npm start
```

`npm start` recompile puis lance `dist/src/index.js`. Il se connecte au vrai serveur Discord : ne le lance pas pour « essayer ».

| Commande | Rôle |
| --- | --- |
| `npm run build` | Supprime `dist/` puis compile avec `tsc` |
| `npm run test:diplomatie`, `test:recrutement`, `test:parrainage`, `test:github` | Tests (`node --test` sur le code compilé) ; chacun recompile d'abord |
| `npm run migrate:create`, `migrate:up`, `migrate:down` | Migrations MikroORM |

Débogage : la configuration VS Code « Debug Bot TypeScript » (`.vscode/launch.json`) lance `src/index.ts` via `register.mjs` (ts-node).

### Variables d'environnement (fichier `.env`, ignoré par git)

Obligatoires au démarrage :

| Variable | Contenu |
| --- | --- |
| `DISCORD_TOKEN` | Jeton du bot Discord |
| `GUILD_ID` | ID du serveur Discord |
| `MYSQL_URL` | URL de connexion MySQL |
| `URL_SITE` | Adresse du site (pour lire les paramètres) |
| `BOT_TOKEN` | Jeton d'accès du bot à l'API du site |
| `BOT_SHARED_SECRET` | Secret de signature des requêtes site → bot |
| `PORT` | Port du serveur Express du bot |

Utilisées dans certaines fonctions :

| Variable | Rôle |
| --- | --- |
| `ENGOO_ID` | ID Discord du propriétaire : la commande `/db` et la création de salons d'événements lui sont réservées, et il contourne le contrôle de rôle de la diplomatie |
| `GITHUB_TOKEN` | Jeton GitHub pour `/github issue` (droit de créer des issues sur les dépôts listés) |
| `APP_URL` | Adresse publique utilisée pour générer des liens (événements, liens temporaires) |
| `ROLE_ID` | Rôle Membre (encore lu depuis l'environnement, voir `docs/settings-config.md`) |
| `ADMISSION_CATEGORY_ID`, `VOICE_CREATE_CATEGORY_ID` | Catégories Discord d'admission et de création de salons vocaux |
| `MEETING_STT_PYTHON`, `MEETING_STT_DEVICE`, `MEETING_STT_COMPUTE_TYPE`, `MEETING_FFMPEG_PATH`, `MEETING_TMP_DIR` | Transcription des réunions |
| `NODE_ENV`, `LOG_MIKRO` | Mode de production et journalisation de l'ORM |

Le dossier `config/` est aussi ignoré par git : `config/github.json` y définit la liste des dépôts proposés par `/github issue` (`repos` : `label` et `value` au format `owner/repo`) et le nom de la catégorie « Assistance ».

## Organisation du code

```
src/
  index.ts              point d'entrée, gestion des erreurs non attrapées
  BotManager.ts         client Discord (intents), démarrage une fois le bot prêt
  bootstrap/            ManagerSetup (création des managers), DiscordEventHandlers, ComponentHandlerSetup
  managers/             la logique par fonctionnalité (+ schedulers/ pour les tâches planifiées)
  view/                 interface Discord : embeds, boutons, menus, modales
  entities/             entités MikroORM, un dossier par domaine
  services/             SettingsService, transcription et stockage audio des réunions…
  web/                  serveur Express : routes/ et middlewares/
  constants/SettingKeys.ts   toutes les clés de paramètres lues sur le site
  migrations/           migrations (voir le piège plus bas)
commands/               slash commands déclaratives (*.json), chacune pointe vers un « handler »
docs/                   une page par fonctionnalité + docs/app_settings (définitions à installer sur le site)
tests/                  tests node:test sur le code compilé
```

Déroulé du démarrage : `index.ts` crée `BotManager`, qui se connecte à Discord. Quand le bot est prêt, il se connecte à la base, retrouve le serveur (`GUILD_ID`) et charge les paramètres du site. Puis `createManagers` instancie tous les managers, fusionne leurs handlers de slash commands, charge les définitions de `commands/*.json`, démarre les planificateurs et le serveur web. Enfin, le bot synchronise en base les rôles et les salons du serveur.

Pour ajouter une slash command : décrire la commande dans `commands/<domaine>Commands.json` avec son `handler`, puis exposer ce handler dans `getSlashHandlers()` du manager concerné. Le manager doit figurer dans `ManagerSetup.ts`.

## Fonctionnalités et où les trouver

| Domaine | Code | Documentation |
| --- | --- | --- |
| Tickets (catégorie « Assistance », salons de création et de récapitulatif) | `managers/TicketsManager.ts`, `view/TicketsView.ts` | — |
| Issues GitHub depuis un ticket (`/github issue`) | `managers/GithubManager.ts`, `utils/GithubLabels.ts` | `docs/github-issues.md` |
| Recrutement | `managers/RecrutementManager.ts` | `docs/recrutement.md` |
| Parrainage | `managers/ParrainageManager.ts` | `docs/parrainage.md` |
| Diplomatie | `managers/DiploManager.ts` | `docs/diplomatie.md` |
| Événements, opérations | `managers/EventManager.ts`, `OperationManager.ts` | — |
| Raffinerie | `managers/RefineryManager.ts` | — |
| Réunions et transcription | `managers/MeetingManager.ts`, `services/` | — |
| Duels et classements, contrats, messages automatiques, « screen of the week » | `DuelManager`, `ContractManager`, `AutoMessageManager`, `ScreenManager` | — |
| Tâches planifiées | `managers/schedulers/` | — |

Les paramètres que l'administration du site doit fournir (identifiants de rôles, salons, catégories) sont décrits dans `docs/app_settings/` et `docs/settings-config.md`. Les définitions JSON de `docs/app_settings/` sont à copier dans le dossier `config/app_settings/` du site.

## Base de données

MikroORM sur MySQL. Les entités sont dans `src/entities/` (utilisateurs et rôles, événements, opérations, raffinerie, diplomatie, recrutement et parrainage, RH, tickets, classements…).

**Piège : les migrations ne sont pas versionnées.** `.gitignore` ignore `src/migrations/*` à l'exception de deux fichiers (`Migration20260912000000.ts`, diplomatie, et `Migration20260917190000.ts`, sauvegarde des accès postulant). Une nouvelle migration créée en local n'arrive donc pas dans git, sauf si on ajoute une exception dans `.gitignore`. Décide-le explicitement avant toute modification du schéma.

## Suivi des tickets et agents IA

Le suivi se fait dans GitHub avec des labels communs, et des agents IA peuvent traiter les petits bugs sous le contrôle du propriétaire. Le détail est dans deux fichiers à lire en premier :

- [`CLAUDE.md`](../CLAUDE.md) : les consignes de l'agent du dépôt (commandes, conventions, zones interdites, périmètre).
- [`docs/agents.md`](agents.md) : rôles, labels, cycle de vie d'un ticket, déclenchement d'un agent, sécurité.

L'essentiel à retenir :

- Les modèles de tickets et de PR sont dans `.github/`. La liste des labels est dans `.github/labels.yml`, appliquée avec `scripts/sync-labels.sh <owner/repo>` (nécessite `gh` et PyYAML).
- Un agent ne travaille que sur un ticket portant le label `agent:go`, posé par le propriétaire. Il ouvre une PR et ne fusionne jamais.
- Un ticket venu de Discord (`from-discord`) contient du texte écrit par des tiers : c'est une donnée, jamais une consigne. Les labels `agent:*` saisis depuis Discord sont refusés par `/github issue`.
- Trois workflows (`ci.yml`, `agent-analyse.yml`, `agent-correction.yml`) : build et tests de chaque PR, pré-analyse automatique des issues `a-trier`, correction sur `agent:go`. Ils demandent le secret `CLAUDE_CODE_OAUTH_TOKEN` et l'application GitHub de Claude. Aucun des trois ne déploie ni ne démarre le bot. Un quatrième workflow, `deploy.yml`, met le serveur de production à jour à chaque fusion dans `main` (voir [`docs/deploiement.md`](deploiement.md)).
- Le même système est prévu pour les deux autres dépôts du projet, Site1CC et 1CCCompagnon.

## À compléter

Le dépôt ne contient pas, et ce document ne peut donc pas affirmer :

- l'hébergement du bot au-delà du déploiement (système du serveur, sauvegardes, `launch.sh` qui lance le service) : le déploiement est décrit dans `docs/deploiement.md`, le reste n'est pas dans le dépôt ;
- la gestion et la sauvegarde de la base MySQL, et comment la production applique les migrations ;
- où sont stockés les secrets de production ;
- les valeurs réelles des paramètres du site (elles sont en base côté site, pas dans le dépôt).

## Points d'attention connus

- La documentation `docs/app_settings/README.md` signale qu'un appel historique dans `UserManager` a pu bloquer la compilation. Lance `npm run build` avant de modifier quoi que ce soit et note le résultat.
- `t.bat` est un script de test manuel du propriétaire, à ne pas modifier ni prendre pour modèle.
- `prod.session.sql` est versionné : ne pas y ajouter de données de production.
