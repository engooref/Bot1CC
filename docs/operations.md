# Opérations (OP) : icône calendrier et rappel de départ

Code : `src/managers/OperationManager.ts`, fonctions pures dans `src/utils/OperationReminder.ts`, planificateur `src/managers/schedulers/SchedulerOperation.ts`. Tests : `npm run test:operations`.

## Icône calendrier 📅 sur le canal

- À la création d'une OP, le bot ajoute 📅 à la fin du nom du canal (comme pour les événements), sauf si elle y est déjà.
- Quand un message d'OP est supprimé (archivage automatique 4 h après le départ **ou** suppression à la main), le bot retire 📅 **seulement si le canal ne contient plus aucune OP** (100 derniers messages).
- Le planificateur d'OP (toutes les 5 minutes) corrige aussi les canaux : icône ajoutée s'il y a une OP, retirée s'il n'y en a plus (par exemple si le bot était arrêté lors de la suppression).
- Le nettoyage hebdomadaire des événements ignore les canaux de la catégorie « Opérations » : l'icône de ces canaux n'est gérée que par ce module.
- Un message d'OP est reconnu à son auteur (le bot), à son pied d'embed (`OPERATION_FOOTER_TEXTS`) et à la date de départ de l'embed.
- Discord limite les renommages de canal (environ 2 par 10 minutes et par canal) : le bot ne renomme que lorsque c'est nécessaire.

## Rappel 30 minutes avant le départ

- Le délai est la constante `OPERATION_REMINDER_DELAY_MS` (30 minutes) dans `OperationReminder.ts`. Ce n'est pas un paramètre du site.
- Le rappel est posté **dans le fil de l'OP** et mentionne les membres qui ont réagi avec l'emoji de présence (lu au moment du rappel, bots exclus, mentions de membres seulement). Si personne n'a confirmé, rien n'est envoyé.
- **Aucun rappel** si l'OP a été créée moins de 30 minutes avant son départ.
- S'applique à toutes les OP, y compris les OP « jeux ».
- Un minuteur envoie le rappel à l'heure exacte. Si le bot a redémarré, le planificateur (toutes les 5 minutes) le rattrape, au plus tard au départ. Aucune base de données : le message de rappel, qui commence par `⏰ **Rappel de départ**`, sert de marqueur pour ne jamais envoyer deux rappels.
- Limite connue : après un redémarrage, un rappel peut arriver jusqu'à 5 minutes en retard, et une personne qui confirme après le rappel n'est pas prévenue.
