import type { Request, Response, NextFunction } from "express";

const seen = new Map<string, number>(); // requestId -> timestamp
const TTL_MS = 24 * 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [k, t] of seen.entries()) {
    if (now - t > TTL_MS) seen.delete(k);
  }
}, 60_000).unref();

export function idempotency(req: Request, res: Response, next: NextFunction) {
  const requestId = (req as any).botRequestId || req.header("X-Request-Id");
  if (!requestId) return res.status(401).json({ success: false, message: "Missing request id" });

  if (seen.has(requestId)) {
    return res.status(200).json({ success: true, alreadyProcessed: true });
  }

  // IMPORTANT: si tu veux “exactly once” plus strict, marque “seen” après succès seulement.
  // Ici on marque tout de suite pour éviter double call en concurrence.
  seen.set(requestId, Date.now());
  next();
}
