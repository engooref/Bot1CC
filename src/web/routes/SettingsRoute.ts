import { Router } from 'express';
import { BotManager } from '../../BotManager.js';
import { settingsService } from '../../services/SettingsService.js';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

export default function createSettingsRouter(bot: BotManager): Router {
    const router = Router();

    router.post('/update', upload.none(), async (_req, res, next) => {
        try {
            await settingsService.reload();
            bot.schedulerManager.appEvent.resetScheduler();
            res.json({});
        } catch (err) {
            next(err);
        }
    });

    return router;
}