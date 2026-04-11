import type { Request, Response, NextFunction } from "express";
import { logHttpIn, logHttpOut } from "../../logger.js";

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
  console.log("────────────────────────────────────");
  console.log("📥 BOT HTTP IN");
  console.log("➡️ ", req.method, req.originalUrl);
  console.log("🔑 Request-Id:", req.header("X-Request-Id"));
  console.log("🔐 Signature:", req.header("X-Signature") ? "yes" : "no");
  console.log("📦 Content-Type:", req.header("content-type"));


  // Attention: en multipart, req.body peut être vide ici (multer passe après)
  console.log("📄 Raw body (pre-route):", req.body);
  

  res.on("finish", () => {
    console.log("⬅️ BOT HTTP OUT");
    console.log("⏱️ ", Date.now() - start, "ms");
    console.log("📤 Status:", res.statusCode);
    console.log("────────────────────────────────────");
    logHttpOut({
      reqId: req.header("X-Request-Id") || "no-id",
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });

  next();
}
