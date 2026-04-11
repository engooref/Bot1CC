import { Router, RequestHandler } from 'express';
import  BotManager  from '../../BotManager.js';

export default function createGeneralRouter(bot: BotManager): Router {
    const router = Router();

    router.post('/updateParam', async (_req, res, next) => {
        try {
        await bot.refreshParameters();
        res.json({});
        } catch (err) {
        next(err);
        }
    });

    return router;
}