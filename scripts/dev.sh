#!/usr/bin/env bash
# Environnement de TEST LOCAL du bot (Docker). Voir docs/test-local.md.
# Usage : scripts/dev.sh start | restart | down | logs | build | test | test-all | shell | init-tables [--run] | site-config | check | reset-all
set -euo pipefail
cd "$(dirname "$0")/.."

DC=(docker compose -f compose.dev.yaml)
BOT=("${DC[@]}" run --rm bot)

port_ouvert() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

verifier_poste() {
  local ko=0
  for outil in git docker; do
    if command -v "$outil" >/dev/null 2>&1; then echo "OK   $outil"; else echo "KO   $outil introuvable (voir docs/test-local.md)"; ko=1; fi
  done
  if command -v docker >/dev/null 2>&1; then
    if docker info >/dev/null 2>&1; then echo "OK   Docker est lancé"; else echo "KO   Docker ne répond pas : lance Docker Desktop et attends qu'il soit prêt"; ko=1; fi
    docker compose version >/dev/null 2>&1 && echo "OK   docker compose" || { echo "KO   docker compose introuvable (mets Docker Desktop à jour)"; ko=1; }
  fi
  # Le bot partage la base et les paramètres du site de développement : il doit tourner (Site1CC, « Dev: Lancer le site »).
  if port_ouvert 8000; then echo "OK   site de développement sur le port 8000"; else echo "KO   le site ne répond pas sur le port 8000 : lance d'abord Site1CC (« Dev: Lancer le site (tout faire) »)"; ko=1; fi
  if port_ouvert 3308; then echo "OK   base du site sur le port 3308"; else echo "KO   la base du site ne répond pas sur le port 3308 : lance d'abord Site1CC"; ko=1; fi
  if port_ouvert 3001; then echo "WARN le port 3001 est déjà utilisé (normal si le bot de test tourne déjà ; sinon libère-le)"; fi
  return $ko
}

# Lit une variable dans .env (sans la rendre à l'écran).
valeur_env() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r"' || true; }

verifier_env() {
  local manque=0
  for v in DISCORD_TOKEN GUILD_ID ROLE_ID; do
    if [ -z "$(valeur_env "$v")" ]; then echo "KO   $v est vide dans .env : renseigne la valeur de ton serveur et de ton bot de TEST"; manque=1; fi
  done
  return $manque
}

cmd="${1:-help}"
[ "$#" -gt 0 ] && shift

case "$cmd" in
  check) verifier_poste ;;
  start|setup|premier-demarrage|up)
    # Tout faire, de façon répétable : peut être relancé à tout moment (première fois comme chaque jour).
    verifier_poste || { echo "Corrige les points KO ci-dessus puis relance."; exit 1; }
    if [ ! -f .env ]; then
      cp docker/dev/env.dev .env
      echo ".env créé depuis docker/dev/env.dev : renseigne DISCORD_TOKEN, GUILD_ID, ROLE_ID (et ENGOO_ID) de ton serveur de TEST, puis relance."
      exit 1
    fi
    verifier_env || { echo "Complète .env puis relance."; exit 1; }
    echo "== Image Node (longue la toute première fois)"; "${DC[@]}" build bot
    echo "== Dépendances et compilation"
    "${BOT[@]}" sh -c '[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci; npm run build'
    echo "== Tables propres au bot (view_context, diplomatie_*) : créées seulement si absentes de la base locale"
    "${BOT[@]}" node scripts/dev-init-tables.mjs --run
    echo "== Démarrage du bot de test"; "${DC[@]}" up -d --wait bot
    echo
    echo "Prêt. Le bot de test est connecté à ton serveur de TEST et au site de développement."
    echo "Pour que le site (http://localhost:8000) puisse appeler le bot, vérifie son .env : scripts/dev.sh site-config"
    echo "Journaux en direct ci-dessous (Ctrl+C pour quitter ; le bot continue de tourner)."
    "${DC[@]}" logs -f --tail=50 bot
    ;;
  restart)
    # Recompile et relance le bot (le démarrage compile toujours).
    "${DC[@]}" up -d --force-recreate --wait bot
    "${DC[@]}" logs -f --tail=50 bot
    ;;
  site-config)
    # Valeurs à mettre dans le .env de Site1CC pour que le site appelle ce bot local.
    [ -f .env ] || cp docker/dev/env.dev .env
    echo "Dans le .env de Site1CC (fichier local, jamais commité) :"
    echo "BASE_URI=http://host.docker.internal"
    echo "BOT_PORT=$(valeur_env PORT)"
    echo "BOT_TOKEN=$(valeur_env BOT_TOKEN)"
    echo "BOT_SHARED_SECRET=$(valeur_env BOT_SHARED_SECRET)"
    echo "(Valeurs factices de développement. Sous Linux, le conteneur php du site doit aussi connaître host.docker.internal : voir docs/test-local.md.)"
    echo "Ensuite, dans le site : « Dev: Arrêter » puis « Dev: Lancer le site (tout faire) »."
    ;;
  down)     "${DC[@]}" down ;;
  logs)     "${DC[@]}" logs -f --tail=100 "${@:-bot}" ;;
  build)    "${BOT[@]}" sh -c '[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci; npm run build' ;;
  test)
    # Les mêmes scripts que la CI de GitHub.
    "${BOT[@]}" sh -c '[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci
      npm run test:diplomatie && npm run test:recrutement && npm run test:parrainage && npm run test:github && npm run test:operations'
    ;;
  test-all)
    # Tous les fichiers tests/*.test.mjs (certains ne sont pas lancés par la CI).
    "${BOT[@]}" sh -c '[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci; npm run test:all'
    ;;
  init-tables)
    # Sans --run : affiche seulement ce qui serait créé. Avec --run : crée les tables absentes.
    "${BOT[@]}" sh -c '[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci; npm run build'
    "${BOT[@]}" node scripts/dev-init-tables.mjs "$@"
    ;;
  shell)    "${BOT[@]}" bash ;;
  reset-all)
    read -r -p "Supprime le conteneur et les dépendances (node_modules) du bot de test ? La base du site n'est pas touchée. (oui/non) " rep
    [ "$rep" = "oui" ] || { echo "Annulé."; exit 1; }
    "${DC[@]}" down -v
    echo "Supprimé. Relance « Bot: Lancer le bot de test (tout faire) » pour tout reconstruire."
    ;;
  *) sed -n 2,3p "$0" ;;
esac
