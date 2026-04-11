import BotManager from "../BotManager.js";
import { BaseComponentView, getDefinitions, ViewHandlers } from "./BaseView.js";
import { ComponentType} from "../entities/ViewContext.js";
import { JSONTypeComponent, JSONComponent } from "../utils/Type.js";


export default class PromotionsView extends BaseComponentView {

    constructor(
        bot: BotManager,
    ) {
        const closeButton: JSONComponent = {
            customId: "close_promotion",
            type: JSONTypeComponent.Button,
            label: "Fermer",
            style: "Danger", // Rouge
            disabled: false,
        };
        super(bot, ViewHandlers.PromotionsHandler, ComponentType.Button, [closeButton])
    }

    protected getData(customId: string): Record<string, any> {
        return {};
    }

    
}