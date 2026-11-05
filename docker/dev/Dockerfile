# Image de DÉVELOPPEMENT uniquement (jamais utilisée en production).
FROM node:22

# Bibliothèques nécessaires si `canvas` ou `@discordjs/opus` ne trouvent pas de binaire précompilé (par exemple sur un Mac Apple Silicon).
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential python3 pkg-config libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
