# Recrutement Discord

## Paramètres

Toutes les clés utilisées par `settingsService` sont centralisées dans `src/constants/SettingKeys.ts`. Les appels utilisent `SettingKeys` et le service accepte le type `SettingKey`, ce qui permet à TypeScript de détecter une clé inconnue. Les canaux d’événements sont également définis explicitement dans ce fichier.

| Constante | Paramètre du site | Valeur |
| --- | --- | --- |
| `SettingKeys.bot.roles.postulant` | `bot.roles.postulant` | ID du rôle attribué par la réponse « Je postule » de l’onboarding |
| `SettingKeys.site.roles.rh` | `site.roles.rh` | ID du rôle RH sous forme de chaîne |
| `SettingKeys.bot.recrutement.categoryAdmission` | `bot.recrutement.category_admission` | ID de la catégorie des tickets privés |
| `SettingKeys.bot.recrutement.categoryMentora` | `bot.recrutement.category_mentora` | ID de la catégorie des tickets Mentora (un salon par dossier en attente de mentor) |
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
2. Le choix « Je postule » dans l’onboarding, ou le bouton « Je postule » de l’annonce du salon d’engagement (`button_enga`), attribue le rôle Postulant (le bouton l’ajoute lui-même et répond en éphémère avec le lien du ticket). L’ajout de ce rôle crée une demande, crée un ticket privé dans la catégorie configurée, accessible au demandeur, aux RH et au bot.
3. Un message épinglé fournit le lien https://robertsspaceindustries.com/orgs/1CC et explique le délai de sept jours. Chaque message humain du demandeur ou d’un RH/administrateur dans le ticket relance ce délai. Les bots et les autres membres ne le relancent pas.
4. Dès l’ouverture, une fiche avec mention RH est publiée dans le fil Candidatures du salon RH. Elle comporte « Candidature RSI vérifiée et validée », « Refuser » et un lien vers le ticket. Le bouton facultatif du demandeur pour déclarer son dépôt ne conditionne pas la validation RH et ne stoppe pas l’expiration.
5. La validation RSI par un RH pose `[P]` (avant, le pseudo ne change pas : `[A]` reste s’il est présent) et supprime l’expiration. Le message du ticket invite à organiser un entretien vocal. Sur la même fiche RH, le bouton devient « Valider l’entretien ».
6. Après l’entretien, le RH valide : le dossier passe à `awaiting_mentor` (« Entretien validé — en attente de mentor »). Aucun rôle ni pseudo ne change : le candidat reste Postulant `[P]`. Le bot ouvre un **ticket Mentora** (`mentora-<pseudo>`, sujet `mentora:<guilde>:<id de la demande>`) dans la catégorie `bot.recrutement.category_mentora`, visible du demandeur, du rôle Parrain (`bot.recrutement.role_parrain`, tous les mentors le voient), du rôle RH et du bot. Son identifiant et celui du message d’accueil sont gardés dans le JSON `mentorship` (`mentoraChannelId`, `mentoraMessageId`), sans migration.
7. Un mentor s’engage lui-même avec le bouton **« Je m’affecte »** du message d’accueil du ticket Mentora (réservé au rôle Parrain, même effet qu’une affectation RH), ou un RH affecte un parrain depuis « Gérer le parrainage » : le dossier passe à `candidate` — préfixe `[C-1CC]`, rôle Candidat configuré attribué, rôle Postulant retiré. Le rôle Parrain perd l’accès au ticket Mentora, seul le mentor affecté le garde (en cas de remplacement, l’ancien est retiré). La fiche RH est mise à jour sur place.

**Compte du site et profil RH** : le compte du site (`user`) est créé au passage `candidate`, une fois rôles et pseudo posés (`insertAndGetUser` sur le membre rechargé ; son nom est le pseudo Discord du moment, donc `[C-1CC] Nom`, mis à jour aux synchronisations suivantes). L’opération est rejouable par la reprise automatique. Aucun compte ni profil RH (`rhmember`) n’est créé aux étapes `review` et `postulant`, et le bot ne crée plus de profil RH `Candidatures` : le profil RH est créé à l’acceptation, par le site. Les anciens profils `Candidatures` existent encore et ne sont ni migrés ni supprimés.

Le ticket Mentora est créé après l’enregistrement du statut : si la catégorie ou le rôle Parrain est absent ou invalide, la transition n’est pas bloquée ; les RH sont alertés (fil de la fiche) et le scheduler retente. Tant que `awaiting_mentor`, les RH reçoivent un rappel unique après `bot.recrutement.mentor_wait_days` jours. Le ticket Mentora n’est jamais supprimé par le bot.

Le refus est disponible dès l’ouverture et jusqu’à validation de l’entretien ; il n’est plus possible depuis `awaiting_mentor` (le rejet depuis le site reste possible). Il demande une confirmation et propose un motif facultatif. Le comportement existant retire les rôles attribuables et le préfixe de recrutement ; le ticket est conservé.

Chaque dépôt RSI déclaré, validation RH ou refus produit un message du bot visible par tous les participants du ticket, avec la prochaine étape. Le message épinglé et la fiche RH sont mis à jour. L’ID de l’annonce est conservé dans la décision JSON pour éviter de la renvoyer lors d’une reprise normale ; aucune migration SQL supplémentaire n’est nécessaire.

## Accès des Postulants

Le rôle Postulant reste attribué dès l’onboarding, mais ses salons sont masqués individuellement au demandeur pendant l’attente RSI et la vérification RH. Les salons explicitement ouverts au rôle et ceux dont la visibilité dépend de ce rôle sont concernés ; le ticket et la catégorie d’admission restent accessibles. Les catégories, salons textuels, vocaux et forums sont traités, avec prise en compte de leurs permissions. Les administrateurs Discord contournent les restrictions de visibilité.

La validation RSI, qui ouvre l’étape entretien vocal, restaure les droits individuels antérieurs. Un refus ou une expiration retire les rôles selon le parcours puis nettoie les blocages temporaires. Les autres permissions individuelles sont préservées.

La colonne JSON nullable `postulant_channel_access` de `recruitment_application` sauvegarde les états de visibilité. Le schéma des tables du recrutement est géré par Site1CC (migration du site, Site1CC #79) : le bot ne les migre plus. Les dossiers existants sont traités au prochain passage du scheduler.

## Expiration et reprise

`SchedulerRH`, enregistré dans `SchedulerManager`, vérifie les dossiers au démarrage puis toutes les cinq minutes. Un passage en cours empêche le chevauchement du suivant.

Après le délai d’inactivité du ticket (`bot.recrutement.ticket_inactivity_days`, 7 jours par défaut) sans activité admissible et avant validation RSI par les RH, le rôle Postulant est retiré et l’accès individuel au ticket est refusé. Le salon et l’historique restent disponibles aux RH. L’expiration peut donc intervenir jusqu’à cinq minutes après l’échéance. Si le demandeur a déjà le rôle Membre (acceptation faite sur le site) alors que sa demande est en `waiting_rsi`, `review` ou `awaiting_mentor`, le scheduler la passe au statut `integrated` au lieu de l’expirer : aucun message, aucun retrait de rôle, et la demande n’est pas rouverte. Si le candidat a quitté le serveur, le retrait du droit individuel est simplement ignoré (il n’y a plus d’accès à régler) et l’expiration aboutit. Avant d’expirer, le scheduler consulte l’historique pour tenir compte des messages du candidat ou du staff envoyés pendant un arrêt du bot.

Le scheduler retire aussi `[A]` après la durée `bot.recrutement.arrival_days` (7 jours par défaut) suivant l’arrivée, indépendamment du ticket, sans retirer `[P]` ou `[C-1CC]`. La création de la demande remplace immédiatement `[A]` par `[P]` s’il est encore présent.

### Délais paramétrables (en jours)

| Clé | Défaut | Rôle |
| --- | --- | --- |
| `bot.recrutement.arrival_days` | 7 | Durée du préfixe `[A]` |
| `bot.recrutement.ticket_inactivity_days` | 7 | Inactivité du ticket avant expiration |
| `bot.recrutement.mentor_wait_days` | 2 | Attente d’un parrain avant rappel aux RH |
| `bot.recrutement.candidate_period_days` | 30 | Durée de la période de candidat |
| `bot.recrutement.extension_days` | 14 | Durée de prolongation pré-remplie dans le formulaire « Prolonger » de la fiche RH (modifiable par le RH) |
| `bot.recrutement.mentor_reminder_days` | 3 | Intervalle des relances (mentor et RH) une fois la période échue |
| `bot.recrutement.closed_ticket_retention_days` | 30 | Conservation d’un ticket clos (voir « Tickets clos » ci-dessous). **0 ou négatif = suppression désactivée** |

Une valeur absente, nulle, négative ou non numérique retombe sur le défaut et est journalisée, sans erreur. Les messages du ticket affichent la durée configurée (« 1 jour » au singulier). Les clés sont déclarées côté site ; exemple au format du registre : `docs/app_settings/bot_recrutement_delais.json`.
Le scheduler retire aussi `[A]` sept jours après l’arrivée, indépendamment du ticket, sans retirer `[P]` ou `[C-1CC]`. `[P]` n’est posé qu’à la validation RSI par les RH ; avant, le pseudo n’est pas modifié.

Les demandes disposent d’une contrainte unique serveur/demandeur et d’un verrou SQL individuel. Les décisions sont enregistrées avant les changements Discord, avec reprise automatique après échec. Un dossier refusé ou expiré n’est pas rouvert automatiquement ; le demandeur doit contacter les RH. Les anciens profils RH `Candidatures` ne reçoivent pas de deuxième ticket : ces candidats, passés par l’ancien bouton, sont à migrer manuellement (le bouton leur répond qu’une demande est en cours). L’ancien circuit du bouton (fil RH, salon `admission-*` créé via `ADMISSION_CATEGORY_ID`) est supprimé.

### Tickets clos : suppression et annonce (ticket #41)

Décision du propriétaire : un ticket clos (refusé, expiré, intégré, ou candidat devenu membre) est **supprimé** `bot.recrutement.closed_ticket_retention_days` jours (30 par défaut) après la clôture. **L’historique du ticket est alors perdu.** Le passage du scheduler RH (`checkRH()`, toutes les 5 minutes) applique la règle ainsi :

- **Interrupteur** : paramètre à `0` ou négatif = aucune suppression et aucune annonce.
- **Plafond** : 5 suppressions au plus par passage. Au premier passage après le déploiement, tous les tickets clos depuis plus de 30 jours sont dus : ils partent par paquets de 5 (un passage toutes les 5 minutes) et n’ont jamais reçu l’annonce. Pour les épargner, mettre le paramètre à 0 sur le site avant la fusion. Un salon refusé par la vérification ci-dessous ne consomme pas le plafond.
- **Vérification du sujet** : le salon n’est supprimé que si son sujet est exactement `recrutement:<guilde>:<id du dossier>` (et s’il est textuel). Sinon rien n’est supprimé ni marqué (avertissement journalisé, nouvel essai au passage suivant). Un salon inconnu de Discord (supprimé à la main, erreur 10003) est considéré comme déjà supprimé : `ticketDeletedAt` est posé sans erreur.
- **Dossier rouvert** : la condition est revérifiée sous verrou SQL juste avant la suppression ; un dossier revenu à un statut ouvert n’est pas supprimé.
- **Journalisation** : l’identifiant du dossier uniquement (aucun pseudo ni identifiant Discord).
- **Erreur Discord** (permissions, panne) : rien n’est marqué, l’erreur est journalisée et la suppression est retentée au passage suivant ; un échec compte dans le plafond du passage.
- **Annonce du délai** : une phrase « Ce ticket sera supprimé le `<t:UNIX:D>`, N jours après la clôture du dossier. » est ajoutée au message `refused`, au message `expired` et à l’embed épinglé. Pour `integrated` (et le candidat devenu membre), elle figure dans l’embed épinglé seulement : pas de nouveau message, pas de mention. N vient du paramètre. Les messages déjà envoyés ne sont pas modifiés.
- **Parrainage** : `ParrainageManager.sync` ne touche plus au salon d’un dossier dont le ticket est supprimé (ni restauration de droits, ni message) et ne modifie pas `ticketDeletedAt`.

Détail des briques (lot 1) :

- Le paramètre : `0` ou une valeur négative désactive la suppression (interrupteur de sécurité) ; une valeur absente ou non numérique retombe sur 30 et est journalisée.
- `closedTicketDue(demande, now, days)` (fonction pure, `src/utils/ClosedTicket.ts`) : un ticket est dû si le dossier est clos depuis au moins `days` jours, si un `channelId` existe et si `mentorship.ticketDeletedAt` n’est pas posé. La date de clôture est l’`at` de la dernière décision vers `refused`, `expired` ou `integrated` ; pour un candidat devenu membre (statut `candidate`), c’est `mentorship.closedAt`. Sans date de clôture connue, ou pour un dossier rouvert (statut ouvert), rien n’est dû.
- Le marqueur `ticketDeletedAt` (clé optionnelle du JSON `mentorship`, sans migration) : une fois posé sur un dossier clos, `resume()` n’appelle plus `ensureTicket`, `syncWelcomeMessage` ni `syncTicketUpdate`, donc aucun salon ni message n’est recréé. La fiche RH reste mise à jour : le champ « Ticket de recrutement » affiche « Ticket supprimé » et le bouton « Ouvrir le ticket » (fiche RH et panneau du parrain) disparaît. « Accéder à mon ticket » répond « Votre demande est terminée » et ne renvoie jamais de lien vers un salon supprimé.
- `assign()` et `finish()` du parrainage conservent les clés existantes de `mentorship`, dont `ticketDeletedAt` (test).
- `ticketDeletedAt` est posé par `RecrutementManager.deleteClosedTicket` ; le salon n’est pas supprimé du dossier (`channelId` conservé), c’est le marqueur qui fait foi.

**Purge des comptes** : `purgeInvalidUsers` n'anonymise pas un compte du site dont le `discordId` a un dossier de recrutement **ouvert**, c'est-à-dire un statut autre que `refused`, `expired` et `integrated`, et un mentorat non clos (`mentorship.closedAt` absent). Un candidat refusé ou expiré, ou sans dossier, garde le comportement habituel. La règle historique reste en vigueur : un compte dont le profil RH a le statut `Candidatures` est aussi épargné. Le nombre de comptes épargnés est journalisé. Cette protection remplace celle qu’apportait la création anticipée du profil RH, supprimée (ticket #44, lot 2).

Les opérations Discord et SQL ne sont pas atomiques : le salon est retrouvé grâce à son marqueur de dossier, mais un arrêt entre l’envoi d’un message et l’enregistrement de son ID peut encore produire un doublon de message.

## Décisions prises sur le site

L'onglet RH > Candidatures du site accepte ou rejette un candidat. Le site prévient le bot par la route signée `POST /recrutement/decision` (mêmes en-têtes que les autres routes), avec `discordId`, `decision` (`accepted` ou `rejected`) et, facultativement, `actorId` (identifiant Discord du RH ; à défaut le bot lui-même). La réponse est `{ success, found, changed, status }`.

| Décision | Étape de la demande | Effet |
| --- | --- | --- |
| `accepted` | `waiting_rsi`, `review`, `postulant`, `awaiting_mentor` | `integrated` : aucun rôle retiré, aucun message « ticket fermé » |
| `accepted` | `candidate` | aucun changement : le suivi de parrainage clôt le dossier dès que le rôle Membre est présent |
| `rejected` | `waiting_rsi`, `review`, `postulant`, `awaiting_mentor` | `refused` : comportement du refus RH (rôles attribuables et préfixe retirés, ticket conservé) |
| `rejected` | `candidate` | suivi de parrainage clôturé puis `refused` |
| toute décision | `refused`, `expired`, `integrated` | aucun changement |

Pas de demande pour ce Discord (ancien circuit) : `found: false`, ce n'est pas une erreur. Comme pour les boutons RH, l'intention est enregistrée avant les changements Discord et reprise par le scheduler en cas d'échec. Une opération déjà en reprise fait répondre une erreur : le site peut réessayer.

## Actions demandées depuis le site (ticket #76, lot 1)

Le bot est le seul à écrire le statut d'un dossier : le site demande une action par la route signée `POST /recrutement/action` (formulaire, mêmes en-têtes que `/decision`). Champs : `discordId` (le candidat), `action`, `actorId` (le RH qui agit, **obligatoire**), `expectedStatus` (le statut affiché sur la fiche du site, **obligatoire**) et `reason`. L'acceptation reste celle de `/recrutement/decision`.

| Action | Depuis | Vers | Motif |
| --- | --- | --- | --- |
| `validate_rsi` | `waiting_rsi`, `review` | `postulant` | facultatif |
| `validate_interview` | `postulant` | `awaiting_mentor` (le ticket Mentora est ouvert par `resume()`) | facultatif |
| `refuse` | `waiting_rsi`, `review`, `postulant`, `awaiting_mentor`, `candidate` | `refused` | **obligatoire**, 500 caractères au plus, consigné dans `decisions` (un candidat voit d'abord son parrainage clos) |

`assign_mentor` et `reopen` sont prévus (lots 2 et 3) : ils répondent pour l'instant 400 « action non disponible ».

Réponse : `{ success: true, found, changed, status }`, ou `found: false` si le dossier n'existe pas. Erreurs, avec un `message` lisible :

- **400** : `discordId`, `actorId`, `action`, `expectedStatus` ou `reason` invalide (motif vide ou de plus de 500 caractères pour `refuse`) ; action non disponible.
- **403** : `actorId` absent du serveur, ou sans le rôle RH ni la permission administrateur (vérifié par le bot à chaque appel, pas seulement par le site).
- **409** : `expectedStatus` différent du statut réel, transition impossible depuis ce statut, ou opération déjà en reprise. Rien n'est modifié ; le site affiche le message et peut réessayer.

Comme pour les décisions, sous verrou, l'intention (`pendingStatus`, `needsSync`, entrée dans `decisions`) est enregistrée avant les changements Discord, appliqués par `resume()` et repris par le scheduler en cas d'échec. Les règles de transition sont dans la fonction pure `siteActionTarget(action, status)` (statut inconnu = pas de transition). Aucune migration, aucun paramètre ni variable d'environnement.

## Validation

`npm run test:recrutement` compile et teste le parcours sans connexion réelle à Discord, au site ou à MySQL. Après compilation, `node --test tests/diplomatie.test.mjs` vérifie la diplomatie.

Sur un serveur de test, vérifier l’attribution `[A]`, la réponse d’onboarding, les rôles et permissions du bot, le ticket privé, la mention RH dans le fil, les deux validations et le refus. La configuration effective de Discord et les valeurs disponibles sur le site ne sont pas vérifiées par les tests locaux.

## Parrainage après l’entretien

La validation de l’entretien ouvre désormais un panneau d’attribution immédiate ou différée. La fiche RH permet de gérer le parrainage et les volontaires ; `/parrain` ouvre leur espace personnel. Voir [Parrainage Discord](parrainage.md) pour les paramètres et les règles de suivi. L’XP et la décision d’officialisation restent indépendantes.
