// src/index.ts
import 'source-map-support/register.js';
import 'dotenv/config';
import 'reflect-metadata';

import WebServer from './web/WebServer.js';
import BotManager from './BotManager.js';

(async () => {
  const bot = new BotManager();

  const webServer = new WebServer(bot);
  webServer.start(parseInt(process.env.PORT!, 10));
})();
