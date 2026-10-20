# Définitions à ajouter au site

Copier `bot_environment.json` dans le dossier `config/app_settings/` du site. Le fichier définit le groupe principal `bot_environment` à la racine (`key`, `label`, `description`, `order`), cinq sous-groupes dans `groups` et dix paramètres dans `settings`. Chaque paramètre référence son sous-groupe via `group`. Ses valeurs par défaut reprennent les valeurs non secrètes du `.env` du bot au moment de la génération. Les personnalisations déjà présentes dans `app_setting` restent prioritaires.

Ne pas redéfinir les clés déjà existantes :

- `ROLE_ID` : réutiliser `site.roles.members`, après adaptation du bot aux rôles multiples.
- `ADMISSION_CATEGORY_ID` : réutiliser `bot.recrutement.category_admission`, après vérification de la catégorie configurée pour l'ancien parcours.

Les dix nouvelles clés sont maintenant lues via SettingsService, sans recours aux anciennes variables d’environnement. Installer ce JSON dans le registre du site avant de démarrer le bot, puis recharger les settings si le bot tourne déjà. Les valeurs personnalisées du site restent prioritaires et le cache du bot conserve sa durée de cinq minutes.

Les variables `RES_ID`, `GITHUB_DEV_ROLE_ID`, `VOICE_CREATE_CHANNEL_ID`, `EVENT_TAG`, `DAY_EVENT`, `HOURS_EVENT`, `MEETING_STT_MODEL`, `MEETING_STT_LANGUAGE`, `MEETING_KEEP_AUDIO` et `FIDELIS_RESP_IDS` ont été retirées du `.env`. Les trois variables inutilisées `TOKEN`, `AMBASSADES_CATEGORY_ID` et `ROLE_STAFF` avaient déjà été retirées.

Le scheduler relit ses paramètres à chaque vérification et valide le jour (`0` = dimanche, `1` = lundi) et l’heure `HH:mm`. Les responsables Fidelis sont des IDs utilisateurs séparés par des points-virgules, nettoyés, dédupliqués et validés avant notification. Les options explicites de transcription restent prioritaires sur les réglages du site.


`ROLE_RECRUE` reste en attente de correspondance, à la demande de l'utilisateur. L'appel historique restant dans UserManager bloque encore la compilation depuis la suppression de getParameter.

Pour le parrainage, ajouter `bot_parrainage.json` au même registre : il définit le rôle Parrain et le plafond de candidats par volontaire. Consulter `docs/parrainage.md` pour la migration préalable et le déploiement. Ne pas créer de seconde définition si ces clés existent déjà sur le site.
