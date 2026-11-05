# Environnement de TEST LOCAL du bot (Docker). Voir docs/test-local.md.
# Usage : .\scripts\dev.ps1 start | restart | down | logs | build | test | test-all | shell | init-tables [--run] | site-config | check | reset-all
param(
    [Parameter(Position = 0)][string]$Cmd = 'help',
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function DC { docker compose -f compose.dev.yaml @args; if ($LASTEXITCODE -ne 0) { throw "docker compose a échoué" } }
function BotRun { DC run --rm bot @args }
$NpmCi = '[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci'

function PortOuvert([int]$port) {
    $c = New-Object System.Net.Sockets.TcpClient
    try { $c.Connect('127.0.0.1', $port); return $true } catch { return $false } finally { $c.Close() }
}

function ValeurEnv([string]$nom) {
    if (-not (Test-Path .env)) { return '' }
    $l = Get-Content .env | Where-Object { $_ -match "^$nom=" } | Select-Object -First 1
    if (-not $l) { return '' }
    return ($l -replace "^$nom=", '').Trim('"', "`r")
}

function VerifierPoste {
    $ko = $false
    foreach ($o in 'git', 'docker') {
        if (Get-Command $o -ErrorAction SilentlyContinue) { Write-Host "OK   $o" } else { Write-Host "KO   $o introuvable (voir docs/test-local.md)"; $ko = $true }
    }
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        docker info *> $null
        if ($LASTEXITCODE -eq 0) { Write-Host "OK   Docker est lancé" } else { Write-Host "KO   Docker ne répond pas : lance Docker Desktop et attends qu'il soit prêt"; $ko = $true }
        docker compose version *> $null
        if ($LASTEXITCODE -eq 0) { Write-Host "OK   docker compose" } else { Write-Host "KO   docker compose introuvable (mets Docker Desktop à jour)"; $ko = $true }
    }
    # Le bot partage la base et les paramètres du site de développement : il doit tourner (Site1CC, « Dev: Lancer le site »).
    if (PortOuvert 8000) { Write-Host "OK   site de développement sur le port 8000" } else { Write-Host "KO   le site ne répond pas sur le port 8000 : lance d'abord Site1CC (« Dev: Lancer le site (tout faire) »)"; $ko = $true }
    if (PortOuvert 3308) { Write-Host "OK   base du site sur le port 3308" } else { Write-Host "KO   la base du site ne répond pas sur le port 3308 : lance d'abord Site1CC"; $ko = $true }
    if (PortOuvert 3001) { Write-Host "WARN le port 3001 est déjà utilisé (normal si le bot de test tourne déjà ; sinon libère-le)" }
    return (-not $ko)
}

function VerifierEnv {
    $ok = $true
    foreach ($v in 'DISCORD_TOKEN', 'GUILD_ID', 'ROLE_ID') {
        if (-not (ValeurEnv $v)) { Write-Host "KO   $v est vide dans .env : renseigne la valeur de ton serveur et de ton bot de TEST"; $ok = $false }
    }
    return $ok
}

switch ($Cmd) {
    'check' { if (-not (VerifierPoste)) { exit 1 } }
    { $_ -in 'start', 'setup', 'premier-demarrage', 'up' } {
        # Tout faire, de façon répétable : peut être relancé à tout moment (première fois comme chaque jour).
        if (-not (VerifierPoste)) { throw "Corrige les points KO ci-dessus puis relance." }
        if (-not (Test-Path .env)) {
            Copy-Item docker/dev/env.dev .env
            throw ".env créé depuis docker/dev/env.dev : renseigne DISCORD_TOKEN, GUILD_ID, ROLE_ID (et ENGOO_ID) de ton serveur de TEST, puis relance."
        }
        if (-not (VerifierEnv)) { throw "Complète .env puis relance." }
        Write-Host "== Image Node (longue la toute première fois)"; DC build bot
        Write-Host "== Dépendances et compilation"
        BotRun sh -c "$NpmCi; npm run build"
        Write-Host "== Tables propres au bot (view_context, diplomatie_*) : créées seulement si absentes de la base locale"
        BotRun node scripts/dev-init-tables.mjs --run
        Write-Host "== Démarrage du bot de test"; DC up -d --wait bot
        Write-Host ""
        Write-Host "Prêt. Le bot de test est connecté à ton serveur de TEST et au site de développement."
        Write-Host "Pour que le site (http://localhost:8000) puisse appeler le bot, vérifie son .env : .\scripts\dev.ps1 site-config"
        Write-Host "Journaux en direct ci-dessous (Ctrl+C pour quitter ; le bot continue de tourner)."
        docker compose -f compose.dev.yaml logs -f --tail=50 bot   # sans DC : Ctrl+C ne doit pas être traité comme une erreur
    }
    'restart' {
        # Recompile et relance le bot (le démarrage compile toujours).
        DC up -d --force-recreate --wait bot
        docker compose -f compose.dev.yaml logs -f --tail=50 bot
    }
    'site-config' {
        # Valeurs à mettre dans le .env de Site1CC pour que le site appelle ce bot local.
        if (-not (Test-Path .env)) { Copy-Item docker/dev/env.dev .env }
        Write-Host "Dans le .env de Site1CC (fichier local, jamais commité) :"
        Write-Host "BASE_URI=http://host.docker.internal"
        Write-Host "BOT_PORT=$(ValeurEnv 'PORT')"
        Write-Host "BOT_TOKEN=$(ValeurEnv 'BOT_TOKEN')"
        Write-Host "BOT_SHARED_SECRET=$(ValeurEnv 'BOT_SHARED_SECRET')"
        Write-Host "(Valeurs factices de développement.)"
        Write-Host "Ensuite, dans le site : « Dev: Arrêter » puis « Dev: Lancer le site (tout faire) »."
    }
    'reset-all' {
        $rep = Read-Host "Supprime le conteneur et les dépendances (node_modules) du bot de test ? La base du site n'est pas touchée. (oui/non)"
        if ($rep -ne 'oui') { Write-Host 'Annulé.'; return }
        DC down -v
        Write-Host "Supprimé. Relance « Bot: Lancer le bot de test (tout faire) » pour tout reconstruire."
    }
    'down'     { DC down }
    'logs'     { if ($Rest) { DC logs -f --tail=100 @Rest } else { DC logs -f --tail=100 bot } }
    'build'    { BotRun sh -c "$NpmCi; npm run build" }
    'test'     { BotRun sh -c "$NpmCi; npm run test:diplomatie && npm run test:recrutement && npm run test:parrainage && npm run test:github && npm run test:operations" }
    'test-all' { BotRun sh -c "$NpmCi; npm run test:all" }
    'init-tables' {
        # Sans --run : affiche seulement ce qui serait créé. Avec --run : crée les tables absentes.
        BotRun sh -c "$NpmCi; npm run build"
        BotRun node scripts/dev-init-tables.mjs @Rest
    }
    'shell'    { BotRun bash }
    default    { Get-Content $PSCommandPath -TotalCount 3 | Select-Object -Skip 1 }
}
