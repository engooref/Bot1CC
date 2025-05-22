import express from 'express';
import { createEventRouter } from './EventRouter.js';
import { createGeneralRouter } from './GeneralRouter.js';
import logger from '../logger.js';
import { RequestContext } from '@mikro-orm/core';
export default class AppExpress {
    constructor(bot) {
        this.app = express();
        this.bot = bot;
        this.setupMiddlewares();
        this.setupRoutes();
        this.setupErrorHandling();
    }
    setupMiddlewares() {
        this.app.use(express.json());
        this.app.use((req, res, next) => {
            RequestContext.create(this.bot.dbMgr.getEm(), () => next());
        });
    }
    setupRoutes() {
        // route racine
        this.app.get('/', (_req, res) => {
            res.send('👋 WebServer up and running!');
        });
        // routes évènements
        this.app.use('/', createGeneralRouter(this.bot));
        this.app.use('/', createEventRouter(this.bot));
    }
    setupErrorHandling() {
        this.app.use((err, _req, res, _next) => {
            logger.error(err);
            res.status(400).json({ error: err.message });
        });
    }
    start(port) {
        this.app.listen(port, () => {
            logger.info(`Express server listening on http://localhost:${port}`);
        });
    }
}
//# sourceMappingURL=WebServer.js.map