import { BotManager } from "../BotManager.js";
import { BaseComponentView, ViewHandlers } from "./BaseView.js";
import { ComponentType } from "../entities/ui/ViewContext.js";


export default class EngaView extends BaseComponentView {

    constructor(
        bot: BotManager,
    ) {
        super(bot, ViewHandlers.EngaHandler, ComponentType.Button, './src/view/definitions/enga.json')
    }

    protected getData(customId: string): Record<string, any> {
        return {};
    }


}

export async function sendEnga(bot: BotManager) {
    await bot.recrutementManager.publishEngagement();
}
