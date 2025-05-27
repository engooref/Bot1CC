import {
    ActionRowBuilder,
    TextChannel,
    Message,
    MessageCreateOptions,
    MessageEditOptions,
    ButtonInteraction,
    StringSelectMenuInteraction,
    InteractionReplyOptions,
    InteractionEditReplyOptions,
    MessageActionRowComponentBuilder,
    TextBasedChannel,

} from 'discord.js';
import { InteractionContext, ComponentType } from '../entities/ViewContext.js';
import BotManager from '../BotManager.js';
import { SafeMethod } from '../exception/Safe.js';
import logger from '../logger.js';

export enum ViewHandlers {
    InviteViewHandler = 'InviteHandler',
    SelectRoleHandler = 'SelectRoleHandler',
    OperationHandler = 'OperationHandler',
    TicketsHandler = 'TicketsHandler',
    EngaHandler = 'EngaHandler'
}

type ComponentInteraction = ButtonInteraction | StringSelectMenuInteraction;

/**
 * Classe de base pour les views utilisant des boutons persistés.
 * Ne connaît pas la nature exacte des boutons, gère uniquement send/edit et persistContext.
 */
export abstract class BaseComponentView {
    public rows: ActionRowBuilder<MessageActionRowComponentBuilder>[];
    protected customIds: string[];
    protected handlerKey: string;
    protected bot: BotManager;
    protected componentType: ComponentType;

    constructor(
        bot: BotManager,
        customIds: string[],
        handlerKey: string,
        componentType: ComponentType,
        rows: ActionRowBuilder<MessageActionRowComponentBuilder>[],
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
        let channel: TextBasedChannel;

        // 1️⃣ Récupère ou refetch le channel
        if (message. channel) {
            channel = message.channel as TextBasedChannel;
        } else {
            channel = await this.bot.channels.fetch(
                message.channelId
            ) as TextBasedChannel;
        }
                
        try {
            // 2️⃣ Tente de refetch + edit le message existant
            const msg = await channel.messages.fetch(message.id);
            let edited = undefined;
            if ('files' in options) {
                const sendPayload: MessageCreateOptions = {
                    content: options.content ?? undefined,
                    embeds: options.embeds,
                    components: this.rows as unknown as any[],
                    files: options.files,
                };


                // S'il y a un fichier, on supprime l'ancien et on renvoie un nouveau
                this.bot.dbMgr.getEm().nativeDelete(InteractionContext, {messageId: msg.id})
                await msg.delete();
                edited = await (channel as TextChannel).send(sendPayload);
            } else {
                // Sinon on édite simplement
                 edited = await msg.edit({
                ...options,
                components: this.rows as unknown as any[],
                });
            }
            await this.persistContexts(edited.id, channel.id);
            return edited;

        } catch (err: any) {
            // 3️⃣ Si erreur “Unknown Message” (10008), on fallback vers un send()
            if (err.code === 10008) {
                logger.warn(`Message ${message.id} introuvable`);
                return message;
            }
            // Pour toute autre erreur, on la ré-émet
            throw err;
        }
    }

    public async sendOrEdit(
        channel: TextChannel,
        existingMessage: Message | null | undefined,
        options: Omit<MessageCreateOptions, 'components'> & Omit<MessageEditOptions, 'components'>,
    ): Promise<Message> {
        if (existingMessage) {
        return this.edit(existingMessage, options as Omit<MessageEditOptions, 'components'>);
        }
        return this.send(channel, options as Omit<MessageCreateOptions, 'components'>);
    }

    
    public async sendFromInteraction(
        interaction: ComponentInteraction,
        options: Omit<InteractionReplyOptions, 'components'>,
    ): Promise<Message> {
        // ① on envoie via followUp et on récupère le Message
        const msg = await interaction.followUp({
            ...options,
            components: this.rows as unknown as any[],
        }) as Message;

        // ② on persiste les contexts sur ce message
        await this.persistContexts(msg.id, msg.channelId);

        return msg;
    }

    public async replyOrEditInteraction(
        interaction: ComponentInteraction,
        options: Omit<InteractionReplyOptions, 'components'>,
        isFirst: boolean,
    ): Promise<Message> {

        if (isFirst) {
            await interaction.reply({
                ...options,
                components: this.rows as unknown as any[],
            });
        } else {
            const { ephemeral: _e, ...editOpts } = options;
            await interaction.editReply(editOpts as InteractionEditReplyOptions & {
                components: unknown[];
            });
        }

        // 2️⃣ On fetch le Message réel
        const msg = (await interaction.fetchReply()) as Message;

        // 3️⃣ On persiste le contexte
        await this.persistContexts(msg.id, msg.channelId);
        return msg;
    }
    

    @SafeMethod
    protected async persistContexts(messageId: string, channelId: string) {
        const em = this.bot.dbMgr.getEm();

        // 1️⃣ Extrait les customIds présents dans this.rows
        const presentIds = this.rows.flatMap(row =>
        // `row.components` est un array de builders, chacun a `data.custom_id`
        (row.components as any[]).map(comp => comp.data.custom_id as string)
        );

        for (const customId of presentIds) {
            const existing = await em.findOne(InteractionContext, {
            messageId,
            channelId,
            customId,
            handlerKey: this.handlerKey,
            });

            if (existing) {
            existing.data = this.getData(customId);
            em.persist(existing);      // seulement persist, pas flush
            } else {
            const ctx = em.create(InteractionContext, {
                messageId,
                channelId,
                customId,
                handlerKey: this.handlerKey,
                componentType: this.componentType,
                data: this.getData(customId),
            });
            em.persist(ctx);
            }
        }

        // ⚠️ un seul flush à la fin, commit de la transaction SafeMethod
        await em.flush();
    }
    
    /**
     * Retourne les données à stocker selon le customId.
     */
    protected abstract getData(customId: string): Record<string, any>;


}


