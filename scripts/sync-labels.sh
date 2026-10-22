#!/usr/bin/env bash
# Crée ou met à jour les labels décrits dans .github/labels.yml.
# Usage : scripts/sync-labels.sh <owner/repo>
# Prérequis : gh (authentifié) et python3 avec PyYAML. Ne supprime aucun label existant.
set -euo pipefail

REPO="${1:?Usage: $0 <owner/repo>}"
FILE="$(cd "$(dirname "$0")/.." && pwd)/.github/labels.yml"

python3 - "$FILE" <<'PY' | while IFS=$'\t' read -r name color description; do
import sys, yaml
for l in yaml.safe_load(open(sys.argv[1])):
    print(f"{l['name']}\t{l['color']}\t{l.get('description', '')}")
PY
  gh label create "$name" --repo "$REPO" --color "$color" --description "$description" --force
done
