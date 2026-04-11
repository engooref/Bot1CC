import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { httpLogger } from "../../logger.js";

function timingSafeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function verifyBotSignature(req: Request, res: Response, next: NextFunction) {
  // Secret partagé (doit matcher Symfony)
  const secret = process.env.BOT_SHARED_SECRET;
  if (!secret) {
    return res.status(500).json({ success: false, message: "BOT_SHARED_SECRET missing on bot" });
  }

  // Headers
  const requestId = (req.header("X-Request-Id") || "").trim();
  const signature = (req.header("X-Signature") || "").trim();

  // Conseillé
  const bodyHash = (req.header("X-Body-Hash") || "").trim();

  if (!requestId || !signature) {
    httpLogger.warn({ requestId, path: req.path }, "AUTH FAIL: missing requestId or signature");
    return res.status(401).json({ success:false, message:"Missing X-Request-Id or X-Signature" });
  }
  if (!bodyHash) {
    httpLogger.warn({ requestId, path: req.path }, "AUTH FAIL: missing X-Body-Hash");
    return res.status(401).json({ success:false, message:"Missing X-Body-Hash" });
  }

  // IMPORTANT: path EXACTEMENT comme Symfony signe (ex: "/rank/up")
  const path = req.path; // si tes routes sont montées différemment, voir note plus bas

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${requestId}|${path}|${bodyHash}`)
    .digest("hex");

  if (!timingSafeEqual(signature, expected)) {
    return res.status(403).json({ success: false, message: "Invalid signature" });
  }

  (req as any).botRequestId = requestId;
  next();
}
