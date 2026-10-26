# Issues GitHub depuis Discord

La commande `/github issue` crée une issue GitHub à partir d'un ticket Discord. Elle est réservée au rôle Dev (`bot.github.role_dev`) et ne fonctionne que dans la catégorie « Assistance ». Le bot a besoin de la variable `GITHUB_TOKEN`.

## Déroulement

1. Le Dev choisit le dépôt dans la liste définie par `config/github.json`.
2. Un formulaire demande le titre, la description, des labels, des assignés et les images du salon.
3. Le bot crée l'issue via l'API GitHub et répond avec un récapitulatif visible uniquement par le Dev.
4. Le bot écrit dans le salon du ticket un message de confirmation visible du membre : « Votre demande a été transmise à l'équipe technique (référence **Bot1CC#12**) ». Il ne contient pas de lien vers l'issue et ne mentionne personne. Si le message ne peut pas être envoyé (droits du salon), l'issue reste créée et un avertissement est journalisé.

## Numéro de ticket et titre

- Le numéro est celui de la base de données (`TicketBots.id`), retrouvé grâce au salon : c'est le même que « Ticket n°… » affiché dans le salon. Les salons s'appellent `tickets-<pseudo>` et leur nom ne contient pas de numéro fiable (`tickets-bob2000` n'est pas le ticket 2000).
- Si le salon n'a pas de ticket en base, le bot cherche `ticket`, `assistance` ou `support` suivi d'un nombre dans le nom du salon. Sinon le numéro est « non détecté » et le titre porte le nom du salon.
- Le titre de l'issue est `[Ticket #n] <titre saisi>`, tronqué à 256 caractères (limite de GitHub) : c'est le titre saisi qui est coupé, jamais le préfixe.
- Le corps de l'issue dit « Relayé par » (le Dev qui a lancé la commande), pas le membre. Le dépôt est public : l'identité du membre n'est pas écrite dans l'issue.

## Labels

- Chaque issue reçoit automatiquement `from-discord` et `a-trier`.
- Les labels saisis dans le formulaire sont ajoutés, sans doublon. Ils sont rapprochés des labels du dépôt **sans tenir compte de la casse ni des accents** (`amelioration` devient `amélioration` si ce label existe), car GitHub refuse sinon la création (422 `already_exists`).
- Un label saisi qui n'existe pas sur le dépôt n'est pas posé : il est signalé dans la réponse (« Labels inconnus »). Si la liste des labels du dépôt n'est pas lisible, le bot envoie les noms tels quels, comme avant.
- Les labels qui commencent par `agent:` sont **ignorés** et signalés dans la réponse. Ils pilotent les agents IA, et le feu vert (`agent:go`) ne doit pouvoir être donné que par le propriétaire du dépôt, sur GitHub.

## Marqueur de liaison

La fin du corps de l'issue contient un commentaire HTML invisible dans GitHub :

```
<!-- discord-ticket: guild=<id du serveur> channel=<id du salon> -->
```

Il permet de retrouver le salon Discord d'une issue sans table de liaison en base de données. Si le texte saisi par l'utilisateur contient lui-même un marqueur, le bon est toujours **le dernier** du corps : le bot l'ajoute après tout le reste.

## Limites actuelles

- Rien ne revient de GitHub vers Discord : le membre est prévenu de la transmission, pas de l'avancement ni de la clôture.
- Aucune protection contre les doublons : relancer la commande dans le même salon crée une autre issue.
- Le lien salon ↔ issue n'est pas enregistré en base. Seul le marqueur ci-dessus permet de le retrouver.
