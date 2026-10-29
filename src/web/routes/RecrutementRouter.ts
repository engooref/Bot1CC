import { Router } from 'express';
import multer from 'multer';
import { BotManager } from '../../BotManager.js';
import type { SiteDecision } from '../../managers/RecrutementManager.js';

const upload = multer({ storage: multer.memoryStorage() });
const SNOWFLAKE = /^\d{17,20}$/;

/** Décisions prises sur le site (onglet RH > Candidatures), répercutées sur la demande de recrutement. */
export default function createRecrutementRouter(bot: BotManager): Router {
  const router = Router();

  router.post('/decision', upload.none(), async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const discordId = String(body.discordId ?? '').trim();
      const decision = String(body.decision ?? '').trim();
      const actorId = String(body.actorId ?? '').trim() || bot.user!.id;
      if (!SNOWFLAKE.test(discordId) || !SNOWFLAKE.test(actorId)) {
        return res.status(400).json({ success: false, message: 'discordId (et actorId si fourni) doit être un identifiant Discord' });
      }
      if (decision !== 'accepted' && decision !== 'rejected') {
        return res.status(400).json({ success: false, message: "decision doit valoir 'accepted' ou 'rejected'" });
      }
      const result = await bot.recrutementManager.applySiteDecision(discordId, decision as SiteDecision, actorId);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
