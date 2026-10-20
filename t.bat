#!/usr/bin/env bash

SECRET="02AC1EAD36FDD75EDA0BE2353AA5F770"
URL="http://localhost:5000"
PATH_URL="/user/sync"

REQUEST_ID="$(uuidgen)"
BODY='{"discordId":"339800670985125890"}'

BODY_HASH="$(
  printf '%s' "$BODY" \
  | openssl dgst -sha256 \
  | awk '{print $2}'
)"

SIGNATURE="$(
  printf '%s' "${REQUEST_ID}|${PATH_URL}|${BODY_HASH}" \
  | openssl dgst -sha256 -hmac "$SECRET" \
  | awk '{print $2}'
)"

curl -X POST "${URL}${PATH_URL}" \
  -H "Content-Type: application/json" \
  -H "X-Request-Id: ${REQUEST_ID}" \
  -H "X-Body-Hash: ${BODY_HASH}" \
  -H "X-Signature: ${SIGNATURE}" \
  --data-raw "$BODY"