# Correspondance avec la configuration du site

Vérification des cinq fichiers JSON de `/var/www/Site1CC/config/app_settings` : `bot_discord.json`, `site_channels.json`, `site_directories.json`, `site_general.json`, `site_roles.json`.

Toutes les clés définies dans ces fichiers figurent dans `src/constants/SettingKeys.ts`, sous leurs groupes `bot` et `site`.

## Alignements

- Le recrutement utilise `bot.channels.rh`, déjà défini dans le site, pour son fil RH. La clé supplémentaire `bot.recrutement.channel_rh` est supprimée.
- `site.roles.rh` est un ID Discord unique (`entity`, `discord_role`).
- `bot.contracts.fidelis_responsibles` est un tableau d’IDs (`entities`, `discord_user`) ; le bot utilise désormais `getList`.
- Les clés site pour les membres, les gestionnaires d’événements, les images, les badges, la synchronisation Discord et la certification capitaine sont aussi déclarées dans les constantes. Leur présence ne modifie pas automatiquement le comportement du bot ; le rôle Membre du bot est encore initialisé depuis `ROLE_ID`.

## Définitions ajoutées au site

Les sept clés suivantes ont été ajoutées dans les fichiers appropriés. Elles utilisent une valeur par défaut `null` : sélectionner les catégories, salons et rôles dans l’administration du site. Le registre PHP a validé les 39 paramètres ; aucune clé des constantes du bot ne manque désormais.

| Clé | Type attendu | Fichier et groupe |
| --- | --- | --- |
| `bot.recrutement.category_admission` | `entity` / `discord_category` | `bot_discord.json`, groupe recrutement |
| `bot.recrutement.role_candidat` | `entity` / `discord_role` | `site_roles.json`, groupe rôles du bot |
| `bot.diplomatie.role_ambassadeur` | `entity` / `discord_role` | `site_roles.json`, groupe rôles du bot |
| `bot.diplomatie.role` | `entity` / `discord_role` (staff diplomatique) | `site_roles.json`, groupe rôles du bot |
| `bot.diplomatie.channel` | `entity` / `discord_channel` (salon staff) | `site_channels.json` |
| `bot.diplomatie.channel_demande` | `entity` / `discord_channel` (salon des demandes) | `site_channels.json` |
| `bot.diplomatie.category_corporations` | `entity` / `discord_category` | `bot_discord.json`, groupe diplomatie |

## Valeurs à renseigner

Les douze clés `bot.channels.*`, `site.roles.members`, `site.roles.rh` et `bot.roles.postulant` ont toutes un défaut `null`. Il faut vérifier leurs valeurs enregistrées dans l’administration du site. Un défaut `null` ne prouve pas qu’une valeur enregistrée manque : les JSON décrivent les paramètres, les valeurs effectives peuvent être stockées en base.

Les fichiers `bot_discord.json`, `site_channels.json` et `site_roles.json` ont été modifiés. Les nouveaux groupes Recrutement et Diplomatie figurent dans `bot_discord.json`.
