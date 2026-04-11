import { Router, Request } from 'express';
import { BotManager } from '../../BotManager.js';
import { WebOperationCreateInput } from '../../managers/OperationManager.js';
import multer from 'multer';


interface CreateOperationBody {
  userId?: string | number;
  responsableId?: string | number;
  discordId?: string | number;
  type?: string | number;
  minutes?: string | number;
  location?: string | number;
  games?: string | number;
  description?: string | number;
  equip?: string | number;
  reward?: string | number;
  url?: string | number;
  miningSessionUrl?: string | number;
  sessionUrl?: string | number;
  typeSpe?: string | number;
}

function optionalString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function parseCreateOperationBody(body: CreateOperationBody): WebOperationCreateInput {
  const userId = optionalString(body.userId ?? body.responsableId ?? body.discordId);
  if (!userId) {
    throw new Error('userId manquant');
  }

  const minutes = optionalString(body.minutes);
  if (!minutes) {
    throw new Error('minutes manquant');
  }

  return {
    userId,
    type: optionalString(body.type),
    minutes,
    location: optionalString(body.location) ?? '0.0.0',
    games: optionalString(body.games),
    description: optionalString(body.description),
    equip: optionalString(body.equip),
    reward: optionalString(body.reward),
    url: optionalString(body.url),
    miningSessionUrl: optionalString(body.miningSessionUrl ?? body.sessionUrl),
    typeSpe: optionalString(body.typeSpe),
  };
}

const upload = multer({ storage: multer.memoryStorage() });

export default function createOperationRouter(bot: BotManager): Router {
  const router = Router();

  router.post('/create', upload.none(), async (req: Request<{}, {}, CreateOperationBody>, res, next) => {
    try {
      const payload = parseCreateOperationBody(req.body as CreateOperationBody);
      const operation = await bot.operationManager.createOperationFromWeb(payload);
      res.json({ success: true, operation });
    } catch (err) {
      next(err);
    }
  });

  return router;
}