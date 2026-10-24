# Déploiement en production

Chaque fusion d'une PR dans `main` met le serveur de production à jour, automatiquement. La production, c'est `main` : il n'y a pas de branche `production`.

Seul le propriétaire fusionne. Les agents ne touchent ni à ces fichiers ni au serveur (voir `CLAUDE.md`).

## Ce qui se passe à chaque fusion

1. `deploy.yml` relance la CI (`ci.yml` : compilation et tests) sur `main`. Si elle échoue, rien n'est déployé.
2. Le workflow se connecte au serveur par SSH et envoie l'identifiant du commit.
3. Le serveur exécute `scripts/deploy.sh`, qui :
   - refuse de partir si des fichiers suivis par git ont été modifiés à la main sur le serveur ;
   - met le code à jour en avance rapide (jamais de fusion ni de réécriture d'historique) ;
   - réinstalle les dépendances **seulement** si `package.json` ou `package-lock.json` ont changé ;
   - compile (`npm run build`), redémarre le service systemd `bot1CC.service`, puis attend que la route `/` réponde `{"status":"online"}` (90 s au maximum) ;
   - **revient à la version précédente** si une de ces étapes échoue, et fait alors échouer le workflow (la fusion apparaît en rouge dans GitHub).
4. Un seul déploiement à la fois : une fusion pendant un déploiement attend son tour.

Le workflow peut aussi être lancé à la main (Actions → Déploiement → Run workflow, sur `main`) pour recompiler et redémarrer sans nouveau commit.

## Les migrations restent manuelles

Le script n'applique **jamais** de migration. Elles ne sont pas versionnées de façon fiable (voir `docs/prise-en-main.md`) : `git pull` ne les apporte pas, et `migrate:up` sur la production ne doit pas partir sans que tu l'aies décidé. Quand une PR a besoin d'une migration, applique-la toi-même sur le serveur, au bon moment par rapport à la fusion, avant de fusionner si l'ancien code la supporte, après sinon.

## Installation unique sur le serveur

À faire une fois, dans cet ordre. Les commandes ci-dessous n'ont pas été exécutées par l'auteur de la PR : relis-les avant de les lancer.

1. **Node 22.** La production doit tourner comme la CI. Installe Node 22 de façon globale (par exemple avec le dépôt NodeSource), puis, dans le dossier du bot : `npm ci`, `npm run build`, `sudo systemctl restart bot1CC.service` et vérifie que le bot se reconnecte. Le module vocal `@discordjs/opus` doit avoir un binaire pour Node 22 ; il échoue avec Node 24.
2. **Rien à faire pour le script à ce stade** : `scripts/deploy.sh` n'existe sur `main` qu'après la fusion de la PR qui l'apporte. L'étape 8 dit quand le récupérer sur le serveur. Les étapes 3 à 7 peuvent être faites avant la fusion : la ligne `command=` peut pointer vers un fichier qui n'existe pas encore.
3. **Autoriser le redémarrage, et lui seul.** Avec `sudo visudo -f /etc/sudoers.d/deploiement-bot`, une seule ligne (adapte le chemin de `systemctl` avec `command -v systemctl`) :

   ```
   <utilisateur> ALL=(root) NOPASSWD: /usr/bin/systemctl restart bot1CC.service
   ```

   Contrôle ensuite avec `sudo -n systemctl restart bot1CC.service` : aucun mot de passe ne doit être demandé.
4. **Créer une clé SSH réservée au déploiement**, sur ta machine : `ssh-keygen -t ed25519 -N "" -C deploiement-bot1cc -f ./deploiement_bot1cc`.
5. **Limiter cette clé à ce script.** Ajoute dans `~/.ssh/authorized_keys` de l'utilisateur du service, sur une seule ligne, la clé publique (`deploiement_bot1cc.pub`) précédée des options :

   ```
   restrict,command="<dossier-du-bot>/scripts/deploy.sh" ssh-ed25519 AAAA... deploiement-bot1cc
   ```

   Avec `command=`, la clé ne peut rien faire d'autre que lancer ce script, même si le secret GitHub fuitait. Le texte envoyé par le workflow arrive au script dans `SSH_ORIGINAL_COMMAND` ; le script n'accepte qu'un identifiant de commit de 40 caractères hexadécimaux appartenant à `main`.
6. **Créer l'environnement GitHub `production`** (Settings → Environments), restreint à la branche `main`, sans approbation manuelle : le déploiement part tout seul à la fusion. Pour ajouter une validation plus tard, il suffit d'y cocher « Required reviewers », sans toucher au workflow.
7. **Enregistrer les secrets de cet environnement :**

   | Secret | Contenu |
   | --- | --- |
   | `DEPLOY_SSH_KEY` | la clé **privée** (`deploiement_bot1cc`), puis supprime le fichier de ta machine |
   | `DEPLOY_KNOWN_HOSTS` | la ligne de clé d'hôte du serveur, obtenue avec `ssh-keyscan -t ed25519 <hôte>` ; compare son empreinte avec `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` lancé sur le serveur |
   | `DEPLOY_HOST` | adresse ou nom du serveur |
   | `DEPLOY_USER` | utilisateur du service |
   | `DEPLOY_PORT` | port SSH (facultatif, 22 par défaut) |

   Les dépôts sont publics : ne mets ni hôte, ni utilisateur, ni clé dans un fichier, un ticket ou une PR.
8. **Après la fusion de la PR**, sur le serveur : `git pull --ff-only` dans le dossier du bot, pour que `scripts/deploy.sh` existe. Si tu le fais après le premier déploiement automatique, celui-ci échoue (la clé lance un fichier absent) sans rien toucher : relance-le ensuite depuis GitHub (Actions → Déploiement → Run workflow). Fais ensuite un **premier essai à la main** : `git fetch origin main` puis `bash scripts/deploy.sh $(git rev-parse origin/main)`. Le script doit finir par « Déploiement terminé » (le bot redémarre pendant l'essai). Lance enfin le workflow depuis GitHub pour tester la chaîne complète.

## Si un déploiement échoue

- Le workflow est rouge et le journal indique l'étape. Le serveur est revenu à la version précédente : vérifie avec `systemctl status bot1CC.service`.
- Si le journal dit que le bot ne répond pas non plus après le retour arrière, intervention manuelle : `journalctl -u bot1CC.service -n 100`, puis `git log -1` pour savoir sur quel commit est le serveur.
- Pour revenir volontairement à une version : fusionne un `revert` dans `main`. Ne force jamais l'historique de `main` : le script n'accepte que les avances rapides.

## Limites connues

- **Coupure courte.** Le bot est arrêté le temps du redémarrage. `/usr/local/bin/launch.sh` (hors dépôt) lance `npm run start`, qui recompile avant de démarrer : la compilation a donc lieu deux fois par déploiement. Si tu veux raccourcir la coupure, ce script pourrait lancer `node dist/src/index.js` directement ; le déploiement compile déjà avant le redémarrage.
- **Compilation sur un bot en marche.** `npm run build` efface `dist/` avant de recompiler, pendant que l'ancienne version tourne encore. Le risque est faible (le code est déjà chargé en mémoire) mais réel pour un chargement tardif de module.
- **Changer `deploy.sh`** : la nouvelle version ne s'exécute qu'au déploiement suivant celui qui l'apporte.
- **Contrôle de santé.** Il vérifie que le serveur Express répond, pas que toutes les fonctions Discord marchent. Le port est lu dans l'environnement du service ; sans port, seul l'état du service est contrôlé.
- **Le site** (Site1CC) est sur la même machine mais n'est pas concerné par ce workflow.
