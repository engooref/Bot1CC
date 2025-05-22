import { Router, Request, Response, NextFunction } from 'express';
import BotManager from '../BotManager.js';
import { Event } from '../entities/Event.js';
import logger from '../logger.js';

// DTO du body pour créer/mettre à jour un event
export interface CreateEventDto {
  eventId?: number;
  search?: string;
  candId?: number;
}

// on stocke la fonction dans une variable fléchée
async function getEventFromReq(
  eventId: number | undefined,
  bot: BotManager
) {
  if (!eventId) {
    throw new Error('eventId manquant');
  }
  const event = await bot.dbMgr.getEm().findOne(Event, { 
    id: eventId
  }, {
    populate: ['*', 'responses.users'],
  });

  if(!event) throw new Error('Event non trouvé');
  return event
};

export function createEventRouter(bot: BotManager): Router {
  const router = Router();

  // POST /setEvent
  router.post('/setEvent', async (req: Request<{}, {}, CreateEventDto>, res: Response, next: NextFunction) => {
    const { eventId } = req.body;
    try {
      const event = await getEventFromReq(eventId, bot)

      await bot.evMgr.setEvent(event);
      res.json({});

    } catch (err) {
      logger.error(`Erreur lors de /setEvent: ${err} / params: eventId -> ${eventId}`)
      next(err);
    }
  });

  // POST /suppEvent
  router.post('/suppEvent', async (req: Request<{}, {}, CreateEventDto>, res, next) => {
    const { eventId } = req.body;
    try {
      const event = await getEventFromReq(eventId, bot)

      await bot.evMgr.suppEvent(event);
      res.json({});
    } catch (err) {
      logger.error(`Erreur lors de /suppEvent: ${err} / params: eventId -> ${eventId}`)

      next(err);
    }
  });

  // POST /searchUserAttribution
  router.post('/searchUserAttribution', (req: Request<{}, {}, CreateEventDto>, res) => {
    const result = bot.evMgr.searchUserAttribution(req.body.search || '');
    res.json(result);
  });

  // POST /setAttributionEvent
  router.post('/setAttributionEvent', async (req: Request<{}, {}, CreateEventDto>, res, next) => {
    const { eventId } = req.body;
    try {
      const event = await getEventFromReq(eventId, bot)

      await bot.evMgr.attributionEvent(event);

      res.json({});
    } catch (err) {
      logger.error(`Erreur lors de /setAttributionEvent: ${err} / params: eventId -> ${eventId}`)

      next(err);
    }
  });

  // POST /acceptCandidatures
  router.post('/acceptCandidatures', async (req: Request<{}, {}, CreateEventDto>, res, next) => {
    const idCand = req.body.candId;
    try {
      if (idCand == null) throw new Error('idCand manquant');
      const result = await bot.usrMgr.acceptCandidature(idCand);
      res.json(result);
    } catch (err) {
      logger.error(`Erreur lors de /acceptCandidatures: ${err} / params: idCand -> ${idCand}`)

      next(err);
    }
  });

  return router;
}

