import { Router, Request } from 'express';
import { BotManager } from '../../BotManager.js';
import multer from 'multer';
import { MiningSession } from '../../entities/mining/MiningSession.js';


interface CreateOperationBody {
  miningSessionId?: string | number;
}

async function parseCreateOperationBody(bot: BotManager, body: CreateOperationBody): Promise<MiningSession | null> {
  const sessionIdRaw = body.miningSessionId;
  if (sessionIdRaw === undefined || sessionIdRaw === null || String(sessionIdRaw).trim() === '') {
    throw new Error('miningSessionId manquant');
  }

  const sessionId = Number(sessionIdRaw);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw new Error('miningSessionId invalide');
  }

  const repo = bot.db.getEm().getRepository(MiningSession);

  return await repo.findOne(
    { id: sessionId, operationCreated: false },
    { populate: ['defaultBody', 'createdBy'] }
  );
}

const upload = multer({ storage: multer.memoryStorage() });

export default function createOperationRouter(bot: BotManager): Router {
  const router = Router();

  router.post('/create', upload.none(), async (req: Request<{}, {}, CreateOperationBody>, res, next) => {
    try {
      const session = await parseCreateOperationBody(bot, req.body as CreateOperationBody);
      if (!session) {
        throw new Error('Session introuvable ou opération déjà créée');
      }
      const operation = await bot.operationManager.createOperationFromWeb(session);
      
      if (operation) {
        session.operationCreated = true;
        await bot.db.getEm().persist(session).flush();
      }
      
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}