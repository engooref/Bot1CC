import { Router, Request, Response, NextFunction } from 'express';
import { BotManager } from '../../BotManager.js';
import multer from 'multer';

export interface NotifyDto {
  userId: string;
  workOrdersIds: number[];
}

const upload = multer({ storage: multer.memoryStorage() });


export default function createRefineryRouter(bot: BotManager): Router {
  const router = Router();

  router.post('/notify', upload.none(),async (req: Request<{}, {}, NotifyDto>, res: Response, next: NextFunction) => {
    try {
      const userId = String(req.body?.userId).trim();
      const rawIds = req.body?.workOrdersIds;
      let parsedIds: unknown = rawIds;

      if (!userId) {
        res.status(400).json({ error: 'userId manquant.' });
        return;
      }

      try {
        if (typeof rawIds === 'string') {
          parsedIds = JSON.parse(rawIds);
        }
      } catch {
        parsedIds = [];
      }

      const workOrderIds: number[] = (Array.isArray(parsedIds) ? parsedIds : [])
        .map(Number)
        .filter(n => Number.isInteger(n) && n > 0);
        
      if (workOrderIds.length === 0) {
        res.status(400).json({ error: 'workOrderIds manquant ou invalide.' });
        return;
      }

      await bot.refineryManager.notifyUser(userId, workOrderIds);

      res.status(200).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
