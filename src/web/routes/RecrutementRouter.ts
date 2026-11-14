import { Router } from 'express';
import multer from 'multer';
import { BotManager } from '../../BotManager.js';
import {
  PLANNED_SITE_ACTIONS, RECRUITMENT_STATUSES, SITE_ACTIONS, SiteActionError, siteActionReason,
  type SiteAction, type SiteDecision,
} from '../../managers/RecrutementManager.js';
import type { RecrutementStatus } from '../../entities/recrutement/RecrutementDemande.js';

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

  /** Actions RH demandées depuis la fiche du site : validation RSI, validation d'entretien, refus avec motif. */
  router.post('/action', upload.none(), async (req, res, next) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const discordId = String(body.discordId ?? '').trim();
      const actorId = String(body.actorId ?? '').trim();
      const action = String(body.action ?? '').trim();
      const expectedStatus = String(body.expectedStatus ?? '').trim();
      if (!SNOWFLAKE.test(discordId) || !SNOWFLAKE.test(actorId)) {
        return res.status(400).json({ success: false, message: 'discordId et actorId doivent être des identifiants Discord' });
      }
      if ((PLANNED_SITE_ACTIONS as readonly string[]).includes(action)) {
        return res.status(400).json({ success: false, message: 'action non disponible' });
      }
      if (!(SITE_ACTIONS as readonly string[]).includes(action)) {
        return res.status(400).json({ success: false, message: `action doit valoir ${SITE_ACTIONS.map((a) => `'${a}'`).join(', ')}` });
      }
      if (!(RECRUITMENT_STATUSES as readonly string[]).includes(expectedStatus)) {
        return res.status(400).json({ success: false, message: 'expectedStatus est obligatoire et doit être un statut de candidature connu' });
      }
      siteActionReason(action as SiteAction, body.reason);
      if (!await bot.recrutementManager.isSiteActorStaff(actorId)) {
        return res.status(403).json({ success: false, message: 'Action réservée aux RH et administrateurs du serveur Discord' });
      }
      const result = await bot.recrutementManager.applySiteAction(discordId, action as SiteAction, actorId, expectedStatus as RecrutementStatus, body.reason);
      res.json({ success: true, ...result });
    } catch (err) {
      if (err instanceof SiteActionError) {
        return res.status(err.httpStatus).json({ success: false, message: err.message });
      }
      next(err);
    }
  });

  return router;
}
