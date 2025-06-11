// src/logger.ts
import pino, { LoggerOptions, Logger, stdSerializers } from 'pino';
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
  formatters: {
    level(label: string) {
      return { level: label };
    },
  },
  serializers: {
    err: stdSerializers.err,
  },
  base: {
    service: 'my-discord-bot',
    env: process.env.NODE_ENV || 'dev',
  },
};

let logger: Logger;

if (isProd) {
  // ============ PRODUCTION ============
  const fileStream = pino.destination({
    dest: path.resolve(process.cwd(), 'logs', 'bot.log'),
    sync: false,
  });

  const prettyTransport = pino.transport({
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
      ignore: 'pid,hostname',
      singleLine: true,
      levelFirst: true,
      errorProps: 'stack',
    },
  });

  logger = pino(
    baseOptions,
    pino.multistream([
      { stream: fileStream },
      { stream: prettyTransport },
    ])
  );
} else {
  // ============ DÉVELOPPEMENT ============
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
        errorProps: 'stack',
      },
    },
  });
}

export default logger;
