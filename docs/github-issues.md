# Issues GitHub depuis Discord

La commande `/github issue` crée une issue GitHub à partir d'un ticket Discord. Elle est réservée au rôle Dev (`bot.github.role_dev`) et ne fonctionne que dans la catégorie « Assistance ». Le bot a besoin de la variable `GITHUB_TOKEN`.

## Déroulement

1. Le Dev choisit le dépôt dans la liste définie par `config/github.json`.
2. Un formulaire demande le titre, la description, des labels, des assignés et les images du salon.
3. Le bot crée l'issue via l'API GitHub et répond avec un récapitulatif visible uniquement par le Dev.

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

- Rien ne revient de GitHub vers Discord : le membre n'est pas prévenu quand l'issue avance ou se ferme.
- Le lien salon ↔ issue n'est pas enregistré en base. Seul le marqueur ci-dessus permet de le retrouver.
