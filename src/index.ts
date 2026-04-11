import 'source-map-support/register.js';
import 'dotenv/config';
import 'reflect-metadata';
import crypto from 'node:crypto';
import fs from 'fs';
import path from 'path';

import BotManager from './BotManager.js';
// import logger from './logger.js';

if (!globalThis.crypto) globalThis.crypto = crypto as any;

// Gestion des erreurs non catchées
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

// const LOCK_PATH = path.resolve('/tmp/bot1cc.lock');
// if (!fs.existsSync(LOCK_PATH)) {
//   fs.writeFileSync(LOCK_PATH, String(process.pid));
  
  (async () => {
    const bot = new BotManager();
    
    // Arrêt propre sur SIGINT/SIGTERM
    const shutdown = async () => {
      // try {
      //   // fs.unlinkSync(LOCK_PATH);
      // } catch {}
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })();
  
// } else {
//   logger.error('Bot déjà lancé dans un autre process. Arrêt.');
//   process.on('SIGINT', () => process.exit(1));
//   process.on('SIGTERM', () => process.exit(1));
// }
