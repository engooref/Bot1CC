import BotManager from "../BotManager.js";
import { BaseComponentView, ViewHandlers } from "./BaseView.js";
import { ComponentType } from "../entities/ViewContext.js";

export default class DuelView extends BaseComponentView {
    duelId: number;
    constructor(
        bot: BotManager,
        duelId: number,

    ) {
        super(bot, ViewHandlers.DuelHandler, ComponentType.Button, './src/view/definitions/duel.json')
        this.duelId = duelId;
    }

    protected getData(customId: string): Record<string, any> {
        return { duelId: this.duelId };
    }
    
}
