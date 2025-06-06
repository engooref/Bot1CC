// src/logger.ts
import pino, { LoggerOptions, Logger } from 'pino';
import path from 'path';
import fs from 'fs';

const isProd = process.env.NODE_ENV! === 'prod';

// S’assure que le dossier logs existe (en prod)
if (isProd) {
  const logsDir = path.resolve(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

// Options de base pour Pino
const baseOptions: LoggerOptions = {
  level: isProd ? 'info' : 'debug',
  timestamp: pino.stdTimeFunctions.isoTime,
  // On ajoute un formatter pour que le "level" soit écrit en chaîne plutôt qu'en code
  formatters: {
    level(label: string) {
      return { level: label };
    },
  },
  base: {
    service: 'my-discord-bot',
    env: process.env.NODE_ENV || 'dev',
  },
};

let logger: Logger;

if (isProd) {
  // ============ PRODUCTION ============
  // 1. Destination vers le fichier JSON (bot.log)
  const fileStream = pino.destination({
    dest: path.resolve(process.cwd(), 'logs', 'bot.log'),
    sync: false,
  });

  // 2. Transport “pino-pretty” pour la console (stdout)
  const prettyTransport = pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: true,        // chaque log sur une seule ligne
      levelFirst: true,        // afficher le niveau en début de ligne
    },
  });

  // 3. Multistream : fichier JSON + console “pretty”
  logger = pino(
    baseOptions,
    pino.multistream([
      { stream: fileStream },         // JSON brut dans logs/bot.log
      { stream: prettyTransport },     // “pretty” dans console
    ])
  );
} else {
  // ============ DÉVELOPPEMENT ============
  // En dev, on veut juste du “pretty-print” dans la console, pas de fichier.
  logger = pino({
    ...baseOptions,
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
        ignore: 'pid,hostname',
        singleLine: true,
        levelFirst: true,
      },
    },
  });
}

export default logger;
