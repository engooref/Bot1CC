#!/usr/bin/env bash
# Déploiement du bot sur le serveur de production.
#
# Ce script s'exécute SUR LE SERVEUR, avec l'utilisateur qui fait tourner le service.
# Il est lancé par .github/workflows/deploy.yml (par SSH, avec une clé limitée à ce script)
# ou à la main :
#
#   bash scripts/deploy.sh <sha complet d'un commit de main>
#
# Étapes : mise à jour du code (avance rapide uniquement) -> dépendances si elles ont changé
# -> compilation -> redémarrage du service -> contrôle de santé.
# Si une étape échoue, le serveur revient à la version précédente et le script se termine en erreur.
# Les migrations de base de données ne sont JAMAIS appliquées ici (voir docs/deploiement.md).
#
# Ne jamais afficher le contenu du .env ni les variables d'environnement du service.

set -uo pipefail

# PATH minimal garanti sous SSH non interactif, sans masquer un Node installé par l'utilisateur.
export PATH="${PATH:-}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

SERVICE="${BOT_SERVICE:-bot1CC.service}"
BRANCH="${DEPLOY_BRANCH:-main}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/bot1cc-deploy.lock}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEPS_TOUCHED=0
RESTARTED=0

log() { printf '[deploiement %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { log "ERREUR : $*" >&2; exit 1; }

# Installe les dépendances seulement si package.json / package-lock.json ont changé entre
# deux commits (ou si node_modules manque). `npm ci` supprime node_modules : on évite de le
# faire sous les pieds du bot quand ce n'est pas nécessaire.
install_deps() {
  local from="$1" to="$2"
  if [ -d node_modules ] && git diff --quiet "$from" "$to" -- package.json package-lock.json; then
    log "Dépendances inchangées."
    return 0
  fi
  log "Installation des dépendances (npm ci)."
  DEPS_TOUCHED=1
  npm ci --include=dev --no-audit --no-fund
}

build() {
  log "Compilation (npm run build)."
  npm run build
}

restart_service() {
  log "Redémarrage de ${SERVICE}."
  RESTARTED=1
  sudo -n systemctl restart "$SERVICE"
}

# Port du serveur Express : celui que le service utilise réellement (lu dans l'environnement
# du processus, sans rien afficher d'autre), sinon BOT_PORT, sinon le .env du dépôt.
find_port() {
  local pid port=""
  if [ -n "${BOT_PORT:-}" ]; then printf '%s' "$BOT_PORT"; return 0; fi
  pid="$(systemctl show -p MainPID --value "$SERVICE" 2>/dev/null || true)"
  if [ -n "$pid" ] && [ "$pid" != "0" ] && [ -r "/proc/$pid/environ" ]; then
    port="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^PORT=//p' | head -n 1)"
  fi
  if [ -z "$port" ] && [ -f "$ROOT/.env" ]; then
    port="$(sed -n 's/^[[:space:]]*PORT=//p' "$ROOT/.env" | tail -n 1 | tr -d "\"'\r")"
  fi
  case "$port" in
    ''|*[!0-9]*) return 0 ;;
    *) printf '%s' "$port" ;;
  esac
}

# Santé : le service est actif et la route / (sans signature) répond {"status":"online"}.
wait_healthy() {
  local deadline=$(( SECONDS + HEALTH_TIMEOUT )) port body
  while (( SECONDS < deadline )); do
    sleep 3
    systemctl is-active --quiet "$SERVICE" || continue
    port="$(find_port)"
    if [ -z "$port" ]; then
      log "ATTENTION : port du bot introuvable, contrôle HTTP impossible (service actif seulement)."
      sleep 15
      systemctl is-active --quiet "$SERVICE" && return 0
      return 1
    fi
    body="$(curl -fsS --max-time 3 "http://127.0.0.1:${port}/" 2>/dev/null || true)"
    case "$body" in
      *'"status":"online"'*) log "Contrôle de santé OK (port ${port})."; return 0 ;;
    esac
  done
  log "Le bot ne répond pas après ${HEALTH_TIMEOUT} s."
  return 1
}

# Retour à la version précédente après un échec. $1 = ancien commit, $2 = commit visé.
rollback() {
  local prev="$1" target="$2"
  log "ÉCHEC : retour à la version précédente (${prev:0:7})."
  git reset --hard --quiet "$prev" || { log "Impossible de revenir en arrière (git reset)."; return 1; }
  if [ "$DEPS_TOUCHED" = 1 ] || ! git diff --quiet "$target" "$prev" -- package.json package-lock.json; then
    log "Réinstallation des dépendances de la version précédente."
    npm ci --include=dev --no-audit --no-fund || { log "npm ci a échoué pendant le retour arrière."; return 1; }
  fi
  build || { log "La compilation de la version précédente a échoué."; return 1; }
  if [ "$RESTARTED" = 1 ]; then
    restart_service || return 1
    wait_healthy || { log "La version précédente ne répond pas non plus : intervention manuelle nécessaire."; return 1; }
  fi
  log "Version précédente rétablie."
  return 0
}

main() {
  local sha="${1:-${SSH_ORIGINAL_COMMAND:-}}" prev
  sha="${sha//[[:space:]]/}"
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "un identifiant de commit complet (40 caractères hexadécimaux) est attendu."

  exec 9>"$LOCK_FILE" || die "impossible d'ouvrir le verrou ${LOCK_FILE}."
  flock -n 9 || die "un autre déploiement est déjà en cours."

  cd "$ROOT" || die "dossier introuvable : ${ROOT}."
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "${ROOT} n'est pas un dépôt git."
  if ! git diff --quiet HEAD --; then
    die "des fichiers suivis par git ont été modifiés sur le serveur ; déploiement annulé, rien n'a été touché."
  fi

  prev="$(git rev-parse HEAD)"
  log "Version actuelle ${prev:0:7}, version visée ${sha:0:7}. Node $(node -v 2>/dev/null || echo introuvable)."

  git fetch --quiet origin "$BRANCH" || die "git fetch a échoué."
  git merge-base --is-ancestor "$sha" "origin/${BRANCH}" 2>/dev/null \
    || die "le commit demandé ne fait pas partie de origin/${BRANCH}."

  if [ "$sha" != "$prev" ] && git merge-base --is-ancestor "$sha" "$prev"; then
    log "Le serveur a déjà une version plus récente que ${sha:0:7} : rien à faire."
    return 0
  fi
  if [ "$sha" != "$prev" ]; then
    git merge --ff-only --quiet "$sha" || die "mise à jour impossible en avance rapide (historique divergent)."
  else
    log "Même version : recompilation et redémarrage."
  fi

  if install_deps "$prev" "$sha" && build && restart_service && wait_healthy; then
    log "Déploiement terminé : ${sha:0:7}."
    return 0
  fi

  rollback "$prev" "$sha" || true
  die "le déploiement de ${sha:0:7} a échoué."
}

# Tout le script est lu avant l'exécution : un `git merge` qui remplace ce fichier pendant
# le déploiement ne le perturbe pas. Une modification de ce script ne prend effet qu'au
# déploiement suivant.
main "$@"; exit $?
