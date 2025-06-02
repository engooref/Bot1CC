import { Router, Request, Response, NextFunction } from 'express';
import BotManager from '../BotManager.js';
import { Event } from '../entities/Event.js';
import logger from '../logger.js';
import multer from 'multer';

// DTO du body pour créer/mettre à jour un event
export interface CreateEventDto {
  eventId?: number;
  search?: string;
  candId?: number;
}
const upload = multer({ storage: multer.memoryStorage() });

// on stocke la fonction dans une variable fléchée
async function getEventFromReq(
  eventId: number | undefined,
  bot: BotManager
) {
  if (!eventId) {
    throw new Error('eventId manquant');
  }
  
  const event = await bot.evMgr.em.findOne(Event, { 
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
  router.post('/setEvent', upload.none(), async (req: Request<{}, {}, CreateEventDto>, res, next) => {
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
  router.post('/suppEvent', upload.none(), async (req: Request<{}, {}, CreateEventDto>, res, next) => {
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
  router.post('/searchUserAttribution', upload.none(), (req: Request<{}, {}, CreateEventDto>, res) => {
    const result = bot.evMgr.searchUserAttribution(req.body.search || '');
    res.json(result);
  });

  // POST /setAttributionEvent
  router.post('/setAttributionEvent',  upload.any(), async (req: Request<{}, {}, CreateEventDto>, res, next) => {
    const { eventId } = req.body;
    const files = req.files as Express.Multer.File[];
    if (!files.length) {
      res.status(400).send('Aucun fichier reçu.');
      return 
    }

    try {
      const event = await getEventFromReq(eventId, bot)

      await bot.evMgr.attributionEvent(event, files);

      res.json({});
    } catch (err) {
      logger.error(`Erreur lors de /setAttributionEvent: ${err} / params: eventId -> ${eventId}`)

      next(err);
    }
  });

  // POST /acceptCandidatures
  router.post('/acceptCandidatures', upload.none(), async (req: Request<{}, {}, CreateEventDto>, res, next) => {
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
