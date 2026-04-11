import { Router, Request, Response, NextFunction } from 'express';
import { BotManager } from '../../BotManager.js';
import { Event } from '../../entities/event/Event.js';
import { httpLogger } from '../../logger.js';
import multer from 'multer';

export interface CreateEventDto {
  eventId?: number | string;
  search?: string;
  candId?: number | string;
}

const upload = multer({ storage: multer.memoryStorage() });

function parseNumberOpt(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  if (!Number.isFinite(n)) throw new Error('invalid number');
  return n;
}

async function getEventFromReq(bot: BotManager, req: Request<{}, {}, CreateEventDto>): Promise<Event> {
  const eventId = parseNumberOpt((req.body as any).eventId);
  if (!eventId) throw new Error('eventId manquant');

  const em = bot.db.getEm();
  return await em.findOneOrFail(
    Event, 
    { 
      id: eventId 
    }, 
    {
      populate: ['*', 'responses.users'],
    }
  );
}

export default function createEventRouter(bot: BotManager): Router {
  const router = Router();

  router.post('/setEvent', upload.none(), async (req: Request<{}, {}, CreateEventDto>, res, next) => {
    try {
      const event = await getEventFromReq(bot, req);
      await bot.eventManager.setEvent(event);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/suppEvent', upload.none(), async (req: Request<{}, {}, CreateEventDto>, res, next) => {
    try {
      const event = await getEventFromReq(bot, req);
      await bot.eventManager.suppEvent(event);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/refreshEvent', upload.none(), async (req: Request<{}, {}, CreateEventDto>, res, next) => {
    try {
      const event = await getEventFromReq(bot, req);
      await bot.schedulerManager.appEvent.updateOrCancelProgrammedEvent(event);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/searchUserAttribution', upload.none(), (req: Request<{}, {}, CreateEventDto>, res) => {
    try {
      const search = String((req.body as any).search ?? '').trim();
      const result = bot.eventManager.searchUserAttribution(search);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post(
    '/setAttributionEvent',
    upload.fields([{ name: 'files', maxCount: 10 }, { name: 'files[]', maxCount: 10 }]),
    async (req: Request<{}, {}, CreateEventDto>, res, next) => {
      try {
        const event = await getEventFromReq(bot, req);

        const filesMap = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
        const files = [
          ...(filesMap['files'] ?? []),
          ...(filesMap['files[]'] ?? []),
        ];

        await bot.eventManager.attributionEvent(event, files);
        res.json({ success: true });
      } catch (err) {
        next(err);
      }
    }
  );

  router.post('/acceptCandidatures', upload.none(), async (req: Request<{}, {}, CreateEventDto>, res, next) => {
    const candIdRaw = (req.body as any).candId;
    try {
      const candId = parseNumberOpt(candIdRaw);
      if (candId == null) throw new Error('idCand manquant');

      const result = await bot.userManager.acceptCandidature(candId);
      res.json(result);
    } catch (err) {
      await httpLogger.error({ msg: 'EventRouter → acceptCandidatures error:', err, candId: candIdRaw });
      next(err);
    }
  });

  return router;
}
