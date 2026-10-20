# Diplomatie

L’ajout du rôle ambassadeur ouvre une demande persistée dans `diplomatie_demande`, un fil privé avec le candidat et les diplomates, puis une notification avec boutons dans le fil de suivi. Une demande en attente déjà présente est réutilisée dans ce processus, y compris après redémarrage. Les notifications du premier squelette contenant le candidat et le fil sont converties lors de leur première utilisation.

## Configuration

Les paramètres sont fournis par le service de settings existant :

| Clé | Valeur |
| --- | --- |
| `bot.diplomatie.role_ambassadeur` | Rôle déclenchant la candidature |
| `bot.diplomatie.role` | Rôle autorisé à examiner et traiter les demandes |
| `bot.diplomatie.channel_demande` | Salon textuel accueillant les fils privés de candidature |
| `bot.diplomatie.channel` | Salon textuel accueillant le fil de suivi des demandes |
| `bot.diplomatie.category_corporations` | **Nouveau** : catégorie où créer les salons de corporation |

Le bot doit pouvoir voir les salons, écrire, lire l’historique, créer et gérer les fils, créer les salons et gérer leurs permissions. Les représentants reçoivent individuellement Voir le salon, Envoyer des messages et Voir les anciens messages. Les nouveaux salons sont privés, avec accès pour le bot et le rôle diplomate. Les administrateurs Discord conservent leurs accès habituels.

La catégorie n’est requise que pour créer un nouveau salon. Un salon existant doit être textuel, appartenir au même serveur et être privé pour `@everyone` ; ses permissions existantes sont conservées. Vérifier les autres rôles ayant accès au salon avant de l’associer.

## Parcours

- **Accepter** ouvre un choix privé de corporations, par pages de 25. La sélection mène à une confirmation avant attribution de l’accès.
- **Créer / associer une corporation** ouvre un formulaire : nom obligatoire, ID du salon existant facultatif. Soumettre ce formulaire crée ou retrouve la corporation et accepte la demande. Laisser l’ID vide pour créer un salon dans la catégorie configurée. Un même nom sur le serveur réutilise la corporation existante ; un salon ne peut pas être associé à deux corporations.
- **Refuser** demande confirmation, enregistre le refus et informe le candidat. Aucun rôle du candidat n’est retiré.
- Une décision validée met à jour la notification avec son responsable et, si acceptée, sa corporation. Le fil reçoit le résultat et le lien du salon, puis est verrouillé et archivé. Les boutons de décision disparaissent.
- Si la clôture du fil échoue, la décision reste enregistrée et un bouton **Réessayer la clôture** permet de reprendre. Les anciens boutons et formulaires revérifient toujours le statut en base.

Les décisions sont protégées par un verrou SQL sur la demande. Une erreur d’attribution des permissions laisse la demande en attente. Une erreur SQL déclenche une tentative de restauration des permissions modifiées et de suppression du salon nouvellement créé. Si Discord refuse aussi cette restauration, le détail est journalisé pour correction manuelle. Les appels Discord et la transaction SQL ne forment pas une transaction atomique : un arrêt brutal entre les deux peut nécessiter cette vérification.

## Mise en service et vérification

Appliquer la migration `Migration20260912000000` qui crée `diplomatie_corporation` et `diplomatie_demande` avant d’activer le parcours. Elle n’est pas appliquée automatiquement par ce changement. Le chemin des migrations compilées est `dist/src/migrations`, conformément à la sortie de TypeScript.

Lancer `npm run test:diplomatie` pour compiler et exécuter les tests avec Discord et la base simulés. Ils couvrent les autorisations, la sélection, la création et l’association de salons, les décisions concurrentes, les erreurs d’accès ou de commit et la reprise de clôture.

Vérification sur un serveur de test : attribuer le rôle ambassadeur, accepter une première demande en créant une corporation, accepter un second représentant dans cette corporation, puis vérifier un refus et les permissions avec un compte sans rôle diplomate. Vérifier aussi une corporation existante importée et une reprise après redémarrage.
