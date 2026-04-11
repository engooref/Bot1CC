import express from "express";
import { verifyBotSignature } from "./middlewares/VerifyBotSignature.js";
import { idempotency } from "./middlewares/IdemPotency.js";
import { httpDebug } from "./middlewares/HttpDebug.js";

import createRankRouter from "./routes/RankRouter.js";
import createUserRouter from "./routes/UserRouter.js";
import createLeaderboardsRouter from "./routes/LeaderRoute.js";
import createEventRouter from "./routes/EventRouter.js";
import createGeneralRouter from "./routes/GeneralRouter.js";
import createOperationRouter from "./routes/OperationRouter.js";
import { BotManager } from "../BotManager.js";
import { httpLogger } from "../logger.js";

export default class WebServer {
  private app = express();

  constructor(private readonly bot: BotManager) {}

  public start(port: number): void {
    this.setupMiddlewares();
    this.setupRoutes();
    this.app.listen(port, () => httpLogger.info({ port }, `Bot listening on ${port}`));
  }

  private setupMiddlewares(): void {
    // PUBLIC (healthcheck)
    this.app.get("/", (_req, res) => res.json({ status: "online" }));

    // JSON + multipart
    this.app.use(express.json());

    // 👇 DEBUG GLOBAL
    this.app.use(httpDebug);

    // 🔐 sécurité
    this.app.use(verifyBotSignature);
    this.app.use(idempotency);
  }

  private setupRoutes(): void {
    this.app.use("/rank", createRankRouter(this.bot));
    this.app.use("/user", createUserRouter(this.bot));
    this.app.use("/leaderboards", createLeaderboardsRouter(this.bot));
    this.app.use("/event", createEventRouter(this.bot));
    this.app.use("/general", createGeneralRouter(this.bot));
    this.app.use("/operation", createOperationRouter(this.bot));
  }
}
