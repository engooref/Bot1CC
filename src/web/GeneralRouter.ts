import { Router, RequestHandler } from 'express';
import  BotManager  from '../BotManager.js';

export function createGeneralRouter(bot: BotManager): Router {
    const router = Router();

    const updateParamHandler: RequestHandler = async (_req, res, next) => {
        try {
        await bot.refreshParameters();
        res.json({});
        } catch (err) {
        next(err);
        }
    };
    
    const pingHandler: RequestHandler = (_req, res) => {
        res.json({});
    };

    router.get('/updateParam',updateParamHandler);
    router.get('/ping', pingHandler);

    return router;
}