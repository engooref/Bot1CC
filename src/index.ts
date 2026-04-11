import 'source-map-support/register.js';
import 'dotenv/config';
import 'reflect-metadata';
import crypto from 'node:crypto';

import { BotManager } from './BotManager.js';
import { botLogger } from './logger.js';

if (!globalThis.crypto) globalThis.crypto = crypto as unknown as typeof globalThis.crypto;

process.on('uncaughtException', (err) => {
  void botLogger.error({ err }, '[Uncaught Exception]');
});
process.on('unhandledRejection', (reason) => {
  void botLogger.error({ reason }, '[Unhandled Rejection]');
});

(async () => {
  new BotManager();

  const shutdown = async () => {
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
