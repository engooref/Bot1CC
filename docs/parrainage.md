# Parrainage Discord

Le rôle **Parrain** identifie les volontaires chargés de faire découvrir l’ensemble du 1CC : organisation, pôles, usages et esprit collectif. Ce module ne calcule pas l’XP, ne décide pas de l’officialisation et n’ajoute aucune récompense cosmétique.

## Installation

1. Le schéma des tables du recrutement (`recruitment_application`, `recruitment_mentorship`, `recruitment_mentor_preference`) est géré par Site1CC : le bot ne les migre plus. Appliquer la migration du site (Site1CC #79) avant de démarrer ce bot ; voir la documentation du site.
2. Ajouter les deux paramètres ci-dessous dans le registre du site, puis renseigner le rôle. Un exemple au format du registre existant est fourni dans `docs/app_settings/bot_parrainage.json`.
3. Attribuer manuellement le rôle Parrain aux volontaires retenus. La capacité initiale est de deux candidats, limitée par le plafond RH. Les préférences sont initialisées à la première consultation ou sélection.
4. Redémarrer le bot : la commande `/parrain` est enregistrée par le chargeur JSON existant.

| Clé | Type | Valeur |
| --- | --- | --- |
| `bot.recrutement.role_parrain` | entity / discord_role | Rôle des parrains ; requis pour sélectionner ou gérer un parrain |
| `bot.recrutement.parrain_capacity_max` | string (entier) | 2 par défaut, valeur comprise entre 1 et 100 |

Une configuration absente ou invalide ne bloque pas le passage Candidat. Les attributions restent indisponibles tant que le rôle n’est pas configuré. Une absence temporaire du paramètre ne met pas fin aux accompagnements existants. Le cache des paramètres conserve le fonctionnement existant.

Le bot doit pouvoir consulter les membres, modifier les permissions individuelles des tickets et écrire dans les tickets et le salon/fil RH. Le salon RH reste privé. Le rôle Parrain ne doit pas ouvrir globalement la catégorie d’admission : les accès sont attribués individuellement.

## Parcours RH

Après validation de l’entretien, un panneau permet de choisir un parrain ou de différer l’attribution. Fermer ce panneau ne remet pas en cause le passage Candidat. La fiche publique aux RH dispose de **Gérer le parrainage** et **Gérer les parrains**.

Le sélecteur affiche les volontaires disponibles et leur charge, avec pagination par 25. Les bots, le candidat lui-même, les parrains en pause ou complets sont exclus. La disponibilité est revérifiée à la confirmation. Un formulaire recueille un motif facultatif avant l’attribution ou le remplacement.

Un seul accompagnement actif est autorisé par candidat. Un remplacement conserve l’ancien accompagnement et ses bilans. Le retrait peut laisser le candidat en attente. La clôture manuelle nécessite un motif et termine le suivi : elle ne permet pas une nouvelle attribution sur ce dossier dans cette version.

Le scheduler vérifie les situations au démarrage et toutes les cinq minutes :

- Une attente de `bot.recrutement.mentor_wait_days` jours (2 par défaut, soit 48 heures) produit une seule relance RH par période d’attente. Les nouveaux dossiers démarrent leur délai au passage Candidat ; les anciens au premier contrôle.
- À 14 jours révolus depuis `candidateAt` (validation de l’entretien), une notification mentionne les RH avec un lien vers le dossier. Elle ne valide pas le candidat, ne clôture pas le parrainage et ne vérifie aucune XP. Le rappel est unique par dossier, y compris après redémarrage ou réattribution. Les dossiers existants déjà au-delà de 14 jours sont signalés au prochain contrôle ; une date absente n’est pas inventée.
- La perte du rôle Parrain ou le départ du parrain termine l’attribution et alerte les RH pour son remplacement.
- Le rôle Membre officiel ou le départ du candidat clôture le suivi et libère la place.
- Les fiches RH sont actualisées par la reprise existante, au plus tard au passage suivant du scheduler.

## Espace personnel

`/parrain`, sans argument, envoie directement le panneau personnel complet en MP, comme le formulaire des opérations. Une confirmation éphémère est affichée sur le serveur. Si les MP sont fermés, le bouton **Mon espace** permet de continuer dans une réponse éphémère sur le serveur. Le lancement direct de la commande en MP n’est pas pris en charge.

Les boutons, menus et retours de formulaires mettent à jour le même panneau privé, sans créer une réponse à chaque clic. Les vues candidat disposent de retours vers la liste et l’accueil. La modification d’un bilan préremplit le commentaire précédent. Un bouton utilisé sur la fiche RH partagée ouvre toujours une réponse privée et ne remplace jamais cette fiche.

- **Pause / reprise** : suspend uniquement les nouvelles attributions. Les accompagnements actuels restent à la charge du parrain.
- **Retour prévu** : date facultative `JJ/MM/AAAA`, fuseau Europe/Paris. Un rappel invite à confirmer la reprise ; aucune reprise automatique. Si les MP sont fermés, le rappel est transmis aux RH.
- **Capacité** : de 1 au plafond RH. Une réduction ne supprime aucun accompagnement existant.
- **Mes candidats** : accès au ticket et dépôt d’un bilan favorable, à prolonger ou défavorable. Le commentaire est obligatoire. Le bilan concerne l’intégration, l’esprit et la découverte globale du corps ; il reste visible au parrain actif et aux RH, jamais publié dans le ticket. Les versions antérieures restent dans l’historique RH. Chaque dépôt et chaque modification déclenche une notification mentionnant les RH, avec l’avis, le commentaire et un lien vers la fiche. Une notification échouée reste en attente pour reprise. Les anciens bilans ne sont pas renotifiés rétroactivement.
- **Demander un relais** : sélectionner un ou plusieurs candidats sur la page courante, puis saisir éventuellement un motif. Le parrain est mis en pause ; les RH sont alertés. Les attributions restent actives jusqu’à leur intervention. Pour plus de 25 candidats, utiliser plusieurs pages.

Les RH peuvent modifier les préférences d’un parrain depuis leur répertoire. Les modifications sont historisées avec l’auteur et la date. Ils peuvent consulter les bilans mais ne peuvent pas rédiger celui du parrain à sa place.

## Persistance et limites

Les préférences sont stockées dans `recruitment_mentor_preference`, l’historique dans `recruitment_mentorship` et l’état global dans le JSON `mentorship` du dossier. Aucun profil membre ou accès à l’XP n’est nécessaire.

Les décisions et la sauvegarde des permissions précèdent les modifications Discord. Une réattribution restaure uniquement les permissions de ticket modifiées par le module, sans supprimer les droits provenant d’un rôle ou d’autres permissions. Les changements non synchronisés sont repris après redémarrage ; une nouvelle attribution attend la fin d’une synchronisation en cours.

Les interactions vérifient leur propriétaire, le serveur, les rôles actuels et l’attribution active, y compris en MP. Les mutations verrouillent le dossier ; les attributions verrouillent également la capacité du parrain. Un formulaire d’attribution obsolète est refusé.

Discord et SQL ne forment pas une transaction atomique. Un arrêt après l’envoi d’un message mais avant l’enregistrement de son succès peut produire un doublon d’annonce ou de rappel à la reprise. Les permissions antérieures sont sauvegardées dans une transaction distincte pour survivre à un arrêt brutal.

## Validation

`npm run test:parrainage` compile et exécute les tests sans réseau. Les tests simulent la persistance transactionnelle et Discord ; ils ne remplacent pas une validation des verrous avec MySQL ni des permissions sur un serveur réel.

Sur un serveur de test : vérifier attribution immédiate et différée, remplacement, retrait, confidentialité des bilans, commande éphémère, panneau MP, MP fermés, pause/reprise, capacité, relais multiples, perte de rôle, départ et clôture au rôle Membre. Contrôler aussi une reprise après erreur Discord et une attribution simultanée de la dernière place depuis deux sessions RH.

## Récupération des membres

Le contrôle RH et les sélecteurs de parrains utilisent la liste REST paginée (1 000 membres par page), sans requête Gateway opcode 8. Les appels simultanés partagent la même récupération ; les contrôles individuels de rôles restent actualisés. Un échec de la liste globale ne bloque plus le traitement des dossiers RH déjà connus ni des parrainages.

Les rappels des 14 jours et les marqueurs de notification des bilans utilisent les colonnes JSON existantes : aucune nouvelle migration pour ces ajouts. Les permissions et rôles du candidat ne changent pas à l’échéance.
