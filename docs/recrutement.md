# Recrutement Discord

## Paramètres

Toutes les clés utilisées par `settingsService` sont centralisées dans `src/constants/SettingKeys.ts`. Les appels utilisent `SettingKeys` et le service accepte le type `SettingKey`, ce qui permet à TypeScript de détecter une clé inconnue. Les canaux d’événements sont également définis explicitement dans ce fichier.

| Constante | Paramètre du site | Valeur |
| --- | --- | --- |
| `SettingKeys.bot.roles.postulant` | `bot.roles.postulant` | ID du rôle attribué par la réponse « Je postule » de l’onboarding |
| `SettingKeys.site.roles.rh` | `site.roles.rh` | ID du rôle RH sous forme de chaîne |
| `SettingKeys.bot.recrutement.categoryAdmission` | `bot.recrutement.category_admission` | ID de la catégorie des tickets privés |
| `SettingKeys.bot.channels.rh` | `bot.channels.rh` | ID du salon privé RH contenant le fil Candidatures |
| `SettingKeys.bot.recrutement.roleCandidat` | `bot.recrutement.role_candidat` | ID du rôle attribué après validation de l’entretien |
| `SettingKeys.bot.channels.enga` | `bot.channels.enga` | ID du salon de l’affiche Engagez-vous |

Les valeurs proviennent du site ; ce fichier définit leurs noms et ne crée pas les paramètres à distance. Le rôle Candidat doit être distinct des rôles Postulant et Membre.

## Configuration Discord

Dans les paramètres du serveur, activer/configurer l’onboarding et sa réponse « Je postule » pour attribuer le rôle Postulant. Le bot réagit au rôle ; il ne remplace pas l’onboarding natif de Discord. Les membres en attente de validation des règles ne reçoivent pas de ticket avant leur admission.

Le salon RH doit être privé pour `@everyone`. Placer le rôle du bot au-dessus des rôles Postulant et Candidat. Le bot doit pouvoir gérer les rôles, pseudos, salons, messages épinglés et fils, et envoyer des messages avec liens et pièces jointes. Le rôle RH configuré et les administrateurs peuvent prendre les décisions.

## Parcours

1. À l’arrivée d’un membre humain admis par les règles existantes du serveur, le bot ajoute `[A]` devant son pseudo. Le filtrage existant des comptes de moins de trois mois reste applicable.
2. Le choix « Je postule » dans l’onboarding, ou le bouton « Je postule » de l’annonce du salon d’engagement (`button_enga`), attribue le rôle Postulant (le bouton l’ajoute lui-même et répond en éphémère avec le lien du ticket). L’ajout de ce rôle crée une demande, remplace le préfixe par `[P]` et crée un ticket privé dans la catégorie configurée, accessible au demandeur, aux RH et au bot.
3. Un message épinglé fournit le lien https://robertsspaceindustries.com/orgs/1CC et explique le délai d’inactivité (7 jours par défaut, paramètre `bot.recrutement.ticket_inactivity_days`). Chaque message humain du demandeur ou d’un RH/administrateur dans le ticket relance ce délai. Les bots et les autres membres ne le relancent pas.
4. Dès l’ouverture, une fiche avec mention RH est publiée dans le fil Candidatures du salon RH. Elle comporte « Candidature RSI vérifiée et validée », « Refuser » et un lien vers le ticket. Le bouton facultatif du demandeur pour déclarer son dépôt ne conditionne pas la validation RH et ne stoppe pas l’expiration.
5. La validation RSI par un RH conserve `[P]` et supprime l’expiration. Le message du ticket invite à organiser un entretien vocal. Sur la même fiche RH, le bouton devient « Valider l’entretien → Candidat ».
6. Après l’entretien, le RH valide : le préfixe devient `[C-1CC]`, le rôle Candidat configuré est attribué et le rôle Postulant retiré. La fiche RH est mise à jour sur place.

Le refus est disponible dès l’ouverture et jusqu’à validation de l’entretien. Il demande une confirmation et propose un motif facultatif. Le comportement existant retire les rôles attribuables et le préfixe de recrutement ; le ticket est conservé.

Chaque dépôt RSI déclaré, validation RH ou refus produit un message du bot visible par tous les participants du ticket, avec la prochaine étape. Le message épinglé et la fiche RH sont mis à jour. L’ID de l’annonce est conservé dans la décision JSON pour éviter de la renvoyer lors d’une reprise normale ; aucune migration SQL supplémentaire n’est nécessaire.

## Accès des Postulants

Le rôle Postulant reste attribué dès l’onboarding, mais ses salons sont masqués individuellement au demandeur pendant l’attente RSI et la vérification RH. Les salons explicitement ouverts au rôle et ceux dont la visibilité dépend de ce rôle sont concernés ; le ticket et la catégorie d’admission restent accessibles. Les catégories, salons textuels, vocaux et forums sont traités, avec prise en compte de leurs permissions. Les administrateurs Discord contournent les restrictions de visibilité.

La validation RSI, qui ouvre l’étape entretien vocal, restaure les droits individuels antérieurs. Un refus ou une expiration retire les rôles selon le parcours puis nettoie les blocages temporaires. Les autres permissions individuelles sont préservées.

Appliquer la migration `Migration20260917190000` avant de démarrer cette version du bot : elle ajoute la colonne JSON nullable `postulant_channel_access` à `recrutement_demande` pour sauvegarder les états de visibilité. La migration n’est pas appliquée automatiquement au démarrage. Les dossiers existants sont traités au prochain passage du scheduler.

## Expiration et reprise

`SchedulerRH`, enregistré dans `SchedulerManager`, vérifie les dossiers au démarrage puis toutes les cinq minutes. Un passage en cours empêche le chevauchement du suivant.

Après le délai d’inactivité du ticket (`bot.recrutement.ticket_inactivity_days`, 7 jours par défaut) sans activité admissible et avant validation RSI par les RH, le rôle Postulant est retiré et l’accès individuel au ticket est refusé. Le salon et l’historique restent disponibles aux RH. L’expiration peut donc intervenir jusqu’à cinq minutes après l’échéance. Si le demandeur a déjà le rôle Membre (acceptation faite sur le site) alors que sa demande est en `waiting_rsi` ou `review`, le scheduler la passe au statut `integrated` au lieu de l’expirer : aucun message, aucun retrait de rôle, et la demande n’est pas rouverte. Avant d’expirer, le scheduler consulte l’historique pour tenir compte des messages du candidat ou du staff envoyés pendant un arrêt du bot.

Le scheduler retire aussi `[A]` après la durée `bot.recrutement.arrival_days` (7 jours par défaut) suivant l’arrivée, indépendamment du ticket, sans retirer `[P]` ou `[C-1CC]`. La création de la demande remplace immédiatement `[A]` par `[P]` s’il est encore présent.

### Délais paramétrables (en jours)

| Clé | Défaut | Rôle |
| --- | --- | --- |
| `bot.recrutement.arrival_days` | 7 | Durée du préfixe `[A]` |
| `bot.recrutement.ticket_inactivity_days` | 7 | Inactivité du ticket avant expiration |
| `bot.recrutement.mentor_wait_days` | 2 | Attente d’un parrain avant rappel aux RH |

Une valeur absente, nulle, négative ou non numérique retombe sur le défaut et est journalisée, sans erreur. Les messages du ticket affichent la durée configurée (« 1 jour » au singulier). Les clés sont déclarées côté site ; exemple au format du registre : `docs/app_settings/bot_recrutement_delais.json`.

Les demandes disposent d’une contrainte unique serveur/demandeur et d’un verrou SQL individuel. Les décisions sont enregistrées avant les changements Discord, avec reprise automatique après échec. Un dossier refusé ou expiré n’est pas rouvert automatiquement ; le demandeur doit contacter les RH. Les anciens profils RH `Candidatures` ne reçoivent pas de deuxième ticket : ces candidats, passés par l’ancien bouton, sont à migrer manuellement (le bouton leur répond qu’une demande est en cours). L’ancien circuit du bouton (fil RH, salon `admission-*` créé via `ADMISSION_CATEGORY_ID`) est supprimé.

Les opérations Discord et SQL ne sont pas atomiques : le salon est retrouvé grâce à son marqueur de dossier, mais un arrêt entre l’envoi d’un message et l’enregistrement de son ID peut encore produire un doublon de message.

## Décisions prises sur le site

L'onglet RH > Candidatures du site accepte ou rejette un candidat. Le site prévient le bot par la route signée `POST /recrutement/decision` (mêmes en-têtes que les autres routes), avec `discordId`, `decision` (`accepted` ou `rejected`) et, facultativement, `actorId` (identifiant Discord du RH ; à défaut le bot lui-même). La réponse est `{ success, found, changed, status }`.

| Décision | Étape de la demande | Effet |
| --- | --- | --- |
| `accepted` | `waiting_rsi`, `review`, `postulant` | `integrated` : aucun rôle retiré, aucun message « ticket fermé » |
| `accepted` | `candidate` | aucun changement : le suivi de parrainage clôt le dossier dès que le rôle Membre est présent |
| `rejected` | `waiting_rsi`, `review`, `postulant` | `refused` : comportement du refus RH (rôles attribuables et préfixe retirés, ticket conservé) |
| `rejected` | `candidate` | suivi de parrainage clôturé puis `refused` |
| toute décision | `refused`, `expired`, `integrated` | aucun changement |

Pas de demande pour ce Discord (ancien circuit) : `found: false`, ce n'est pas une erreur. Comme pour les boutons RH, l'intention est enregistrée avant les changements Discord et reprise par le scheduler en cas d'échec. Une opération déjà en reprise fait répondre une erreur : le site peut réessayer.

## Validation

`npm run test:recrutement` compile et teste le parcours sans connexion réelle à Discord, au site ou à MySQL. Après compilation, `node --test tests/diplomatie.test.mjs` vérifie la diplomatie.

Sur un serveur de test, vérifier l’attribution `[A]`, la réponse d’onboarding, les rôles et permissions du bot, le ticket privé, la mention RH dans le fil, les deux validations et le refus. La configuration effective de Discord et les valeurs disponibles sur le site ne sont pas vérifiées par les tests locaux.

## Parrainage après l’entretien

La validation de l’entretien ouvre désormais un panneau d’attribution immédiate ou différée. La fiche RH permet de gérer le parrainage et les volontaires ; `/parrain` ouvre leur espace personnel. Voir [Parrainage Discord](parrainage.md) pour la migration `Migration20260928120000`, les paramètres et les règles de suivi. L’XP et la décision d’officialisation restent indépendantes.
