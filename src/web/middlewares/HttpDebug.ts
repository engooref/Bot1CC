import type { Request, Response, NextFunction } from "express";
import { logHttpIn, logHttpOut, httpLogger } from "../../logger.js";

export function httpDebug(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();

  logHttpIn({
    reqId: req.header("X-Request-Id") || "no-id",
    method: req.method,
    url: req.originalUrl,
    contentType: req.header("content-type") || undefined,
    signature: !!req.header("X-Signature"),
    bodySize: req.socket.bytesRead,
  });
  httpLogger.debug({
    direction: "in",
    method: req.method,
    url: req.originalUrl,
    requestId: req.header("X-Request-Id"),
    signature: req.header("X-Signature") ? "yes" : "no",
    contentType: req.header("content-type"),
    // Attention: en multipart, req.body peut être vide ici (multer passe après)
    body: req.body,
  }, "BOT HTTP IN");

  res.on("finish", () => {
    logHttpOut({
      reqId: req.header("X-Request-Id") || "no-id",
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
    httpLogger.debug({
      direction: "out",
      status: res.statusCode,
      durationMs: Date.now() - start,
    }, "BOT HTTP OUT");
  });

  next();
}
