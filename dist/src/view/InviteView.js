import { ButtonStyle, ButtonBuilder, ActionRowBuilder } from "discord.js";
import { BaseComponentView, ViewHandlers } from "./BaseView.js";
import { ComponentType } from "../entities/ViewContext.js";
/**
   * View pour l'invitation à un événement.
   * Construit ses propres boutons et leur customIds, puis appelle le super.
   */
export class InviteView extends BaseComponentView {
    constructor(bot, eventId, withRole = false) {
        // Définit les customIds pour cette view
        const customIds = [
            `accepted_${eventId}`,
            `declined_${eventId}`,
            `tentative_${eventId}`,
        ];
        if (withRole) {
            customIds.push(`role_${eventId}`);
        }
        // Construit les boutons manuellement
        const buttons = customIds.map(id => {
            const [type] = id.split('_');
            let style = ButtonStyle.Primary;
            switch (type) {
                case 'accepted':
                    style = ButtonStyle.Success;
                    break;
                case 'declined':
                    style = ButtonStyle.Danger;
                    break;
                case 'tentative':
                    style = ButtonStyle.Primary;
                    break;
                case 'role':
                    style = ButtonStyle.Secondary;
                    break;
            }
            return new ButtonBuilder()
                .setCustomId(id)
                .setLabel(type.charAt(0).toUpperCase() + type.slice(1))
                .setStyle(style);
        });
        const rows = [new ActionRowBuilder().addComponents(buttons)];
        super(bot, customIds, ViewHandlers.InviteViewHandler, ComponentType.Button, rows);
        this.eventId = eventId;
    }
    getData(customId) {
        const [responseType] = customId.split('_');
        return { eventId: this.eventId, responseType };
    }
}
//# sourceMappingURL=InviteView.js.map