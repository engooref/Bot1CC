import { Router } from 'express';
export function createGeneralRouter(bot) {
    const router = Router();
    const updateParamHandler = async (_req, res, next) => {
        try {
            await bot.refreshParameters();
            res.json({});
        }
        catch (err) {
            next(err);
        }
    };
    const pingHandler = (_req, res) => {
        res.json({});
    };
    router.get('/updateParam', updateParamHandler);
    router.get('/ping', pingHandler);
    return router;
}
//# sourceMappingURL=GeneralRouter.js.map