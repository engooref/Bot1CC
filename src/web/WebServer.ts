import express, { Application, Request, Response, NextFunction } from 'express';
import { createEventRouter } from './EventRouter.js';
import { createGeneralRouter} from './GeneralRouter.js';
import { createUserRouter } from './UserRouter.js';
import  BotManager  from '../BotManager.js';
import logger from '../logger.js';
import { RequestContext } from '@mikro-orm/core';

export default class AppExpress {
  public app: Application;
  private bot: BotManager;

  constructor(bot: BotManager) {
    this.app = express();
    this.bot = bot;
    this.setupMiddlewares();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddlewares(): void {
    this.app.use(express.json());
    this.app.use((req, res, next) => {
      RequestContext.create(this.bot.dbMgr.getEm(), () => next());
    });
  }

  private setupRoutes(): void {
    // route racine
    this.app.get('/', (_req, res) => {
      res.send('👋 WebServer up and running!');
    });

    // routes évènements
    this.app.use('/', createGeneralRouter(this.bot));
    this.app.use('/', createEventRouter(this.bot));
    this.app.use('/user', createUserRouter(this.bot));

  }

  private setupErrorHandling(): void {
    this.app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      logger.error(err);
      res.status(400).json({ error: (err as Error).message });
    });
  }

  public start(port: number): void {
    this.app.listen(port, '0.0.0.0', () => {
      logger.debug(`Express server listening on http://localhost:${port}`);
    });
  }
}