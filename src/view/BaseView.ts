import {
    ActionRowBuilder,
    TextChannel,
    Message,
    MessageCreateOptions,
    MessageEditOptions,
    AnyComponentBuilder,

} from 'discord.js';
import { InteractionContext, ComponentType } from '../entities/ViewContext.js';
import BotManager from '../BotManager.js';


export enum ViewHandlers {
    InviteViewHandler = 'InviteHandler',
    SelectRoleHandler = 'SelectRoleHandler'
}

/**
 * Classe de base pour les views utilisant des boutons persistés.
 * Ne connaît pas la nature exacte des boutons, gère uniquement send/edit et persistContext.
 */
export abstract class BaseComponentView {
    public rows: ActionRowBuilder<AnyComponentBuilder>[];
    protected customIds: string[];
    protected handlerKey: string;
    protected bot: BotManager;
    protected componentType: ComponentType;

    constructor(
        bot: BotManager,
        customIds: string[],
        handlerKey: string,
        componentType: ComponentType,
        rows: ActionRowBuilder<AnyComponentBuilder>[],
    ) {
        this.bot = bot;
        this.customIds = customIds;
        this.handlerKey = handlerKey;
        this.rows = rows;
        this.componentType = componentType;
    }

    public async send(
        channel: TextChannel,
        options: Omit<MessageCreateOptions, 'components'>,
    ): Promise<Message> {
        const msg = await channel.send({ ...options, components: this.rows as unknown as any[] });
        await this.persistContexts(msg.id, channel.id);
        return msg;
    }

    public async edit(
        message: Message,
        options: Omit<MessageEditOptions, 'components'>,
    ): Promise<Message> {
        const msg = await message.edit({ ...options, components: this.rows as unknown as any[] });
        await this.persistContexts(msg.id, msg.channelId);
        return msg;
    }

    public async sendOrEdit(
        channel: TextChannel,
        existingMessage: Message | null,
        options: Omit<MessageCreateOptions, 'components'> & Omit<MessageEditOptions, 'components'>,
    ): Promise<Message> {
        if (existingMessage) {
        return this.edit(existingMessage, options as Omit<MessageEditOptions, 'components'>);
        }
        return this.send(channel, options as Omit<MessageCreateOptions, 'components'>);
    }

    private async persistContexts(messageId: string, channelId: string) {
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
            } else {
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

    /**
     * Retourne les données à stocker selon le customId.
     */
    protected abstract getData(customId: string): Record<string, any>;
}


