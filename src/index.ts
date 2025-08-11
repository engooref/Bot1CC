import 'source-map-support/register.js';
import 'dotenv/config';
import 'reflect-metadata';
import crypto from 'node:crypto';

import BotManager from './BotManager.js';

if (!globalThis.crypto) globalThis.crypto = crypto as any;

// Gestion des erreurs non catchées
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

(async () => {
  const bot = new BotManager();

  // Arrêt propre sur SIGINT/SIGTERM
  const shutdown = async () => {
    
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
})();
