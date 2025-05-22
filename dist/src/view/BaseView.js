import { InteractionContext } from '../entities/ViewContext.js';
export var ViewHandlers;
(function (ViewHandlers) {
    ViewHandlers["InviteViewHandler"] = "InviteHandler";
    ViewHandlers["SelectRoleHandler"] = "SelectRoleHandler";
})(ViewHandlers || (ViewHandlers = {}));
/**
 * Classe de base pour les views utilisant des boutons persistés.
 * Ne connaît pas la nature exacte des boutons, gère uniquement send/edit et persistContext.
 */
export class BaseComponentView {
    constructor(bot, customIds, handlerKey, componentType, rows) {
        this.bot = bot;
        this.customIds = customIds;
        this.handlerKey = handlerKey;
        this.rows = rows;
        this.componentType = componentType;
    }
    async send(channel, options) {
        const msg = await channel.send({ ...options, components: this.rows });
        await this.persistContexts(msg.id, channel.id);
        return msg;
    }
    async edit(message, options) {
        const msg = await message.edit({ ...options, components: this.rows });
        await this.persistContexts(msg.id, msg.channelId);
        return msg;
    }
    async sendOrEdit(channel, existingMessage, options) {
        if (existingMessage) {
            return this.edit(existingMessage, options);
        }
        return this.send(channel, options);
    }
    async persistContexts(messageId, channelId) {
        const em = this.bot.dbMgr.getEm();
        for (const customId of this.customIds) {
            // 1️⃣ cherche s’il y a déjà un contexte correspondant
            const existing = await em.findOne(InteractionContext, {
                messageId,
                channelId,
                customId,
                handlerKey: this.handlerKey,
            });
            if (existing) {
                // 2️⃣ si oui, on met à jour le data (ou tout autre champ)
                existing.data = this.getData(customId);
                // si vous avez une méthode générique pour updater, vous pouvez l’utiliser :
                await this.bot.dbMgr.update(existing);
            }
            else {
                // 3️⃣ sinon, on crée un nouveau context
                const ctx = em.create(InteractionContext, {
                    messageId,
                    channelId,
                    customId,
                    handlerKey: this.handlerKey,
                    componentType: this.componentType,
                    data: this.getData(customId),
                });
                await this.bot.dbMgr.update(ctx);
            }
        }
    }
}
//# sourceMappingURL=BaseView.js.map