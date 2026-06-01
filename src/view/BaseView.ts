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
    ChatInputCommandInteraction,
    ButtonBuilder,
    ButtonStyle,
    ChannelSelectMenuBuilder,
    ChannelType,
    ModalBuilder,
    RoleSelectMenuBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    TextInputBuilder,
    TextInputStyle,
    Collection,
    CategoryChannel,
    ModalSubmitInteraction,
    ThreadChannel,

} from 'discord.js';
import { InteractionContext, ComponentType } from '../entities/ui/ViewContext.js';
import fs, { cp } from 'fs';
import { BotManager } from '../BotManager.js';
import { SafeMethod } from '../exception/Safe.js';
import { getManagerLogger } from '../logger.js';
import { JSONComponent, JSONTypeComponent, ModalField } from '../utils/Type.js';
import path from 'path';
import { JSONConfigManager } from '../utils/JSONConfigManager.js';

const logger = getManagerLogger('BaseComponentView');

export enum ViewHandlers {
    InviteViewHandler = 'InviteHandler',
    SelectRoleHandler = 'SelectRoleHandler',
    OperationHandler = 'OperationHandler',
    TicketsHandler = 'TicketsHandler',
    EngaHandler = 'EngaHandler',
    ScreenHandler = 'ScreenHandler',
    PromotionsHandler = 'PromotionsHandler',
    DuelHandler = 'DuelHandler',
    GithubHandler = 'GithubHandler',
    AutoMessageHandler = 'AutoMessageHandler',
    ScheduledResponseHandler = 'ScheduledResponseHandler',
}

export type ComponentInteraction = ButtonInteraction | StringSelectMenuInteraction | ChatInputCommandInteraction | ModalSubmitInteraction;

const typeMap: Record<string, ChannelType> = {
  GUILD_TEXT: ChannelType.GuildText,
  GUILD_VOICE: ChannelType.GuildVoice,
  GUILD_CATEGORY: ChannelType.GuildCategory,
  GUILD_ANNOUNCEMENT: ChannelType.GuildAnnouncement,
  GUILD_FORUM: ChannelType.GuildForum,
};

export abstract class BaseComponentView {
    public rows: ActionRowBuilder<MessageActionRowComponentBuilder>[];
    public modal?: ModalBuilder[];
    public buttonTarget: Record<string, string> = {};
    protected customIds: string[];
    protected handlerKey: string;
    protected bot: BotManager;
    protected componentType: ComponentType;
    


    constructor(
        bot: BotManager,
        handlerKey: string,
        componentType: ComponentType,
        definitionsPath: string | JSONComponent[]
    ) {
        this.bot = bot;
        this.handlerKey = handlerKey;
        this.componentType = componentType;

        // 2️⃣ On construit les composants à partir du JSON
        const { actionRows, modal } = this.buildComponentsFromJSON((typeof(definitionsPath) !== "string") ? definitionsPath : getDefinitions(definitionsPath));
        this.rows = actionRows;
        this.modal = modal;

        // 3️⃣ On extrait tous les customIds présents
        this.customIds = this.rows
        .flatMap(row => (row.components as any[]).map(comp => comp.data.custom_id as string));
             
    }

    public async send(
        channel: TextChannel | ThreadChannel,
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
        if (message.channel) {
            channel = message.channel as TextBasedChannel;
        } else {
            channel = await this.bot.channels.fetch(message.channelId) as TextBasedChannel;
        }
        try {
            const msg = await channel.messages.fetch(message.id);
            const edited = await msg.edit({
                ...options,
                components: this.rows as unknown as any[],
            });
            await this.persistContexts(edited.id, channel.id);
            return edited;
        } catch (err: any) {
            if (err.code === 10008) {
                await logger.warn(`Message ${message.id} introuvable`);
                return message;
            }
            throw err;
        }
    }

    public async sendOrEdit(
        channel: TextChannel | ThreadChannel,
        existingMessage: Message | null | undefined,
        options: Omit<MessageCreateOptions, 'components'> & Omit<MessageEditOptions, 'components'>,
    ): Promise<Message> {
        if (existingMessage) {
            return this.edit(existingMessage, options as Omit<MessageEditOptions, 'components'>);
        }
        return this.send(channel, options as Omit<MessageCreateOptions, 'components'>);
    }

    public async editEphemeral(
        message: Message,
        options: Omit<MessageCreateOptions, 'components'> & Omit<MessageEditOptions, 'components'>,
    ): Promise<void> {
        await message.edit({
            ...options,
            components: this.rows as unknown as any[],
        })

        await this.persistContexts(message.id, message.channel.id);

    }

    public async sendFromInteraction(
        interaction: ComponentInteraction,
        options: Omit<InteractionReplyOptions, 'components'>,
    ): Promise<Message> {
        let msg = undefined
        if (!interaction.deferred) {
            msg = await interaction.followUp({
                ...options,
                components: this.rows as unknown as any[],
            }) as Message;
        } else {
            const { flags, ...editOpts } = options;
            msg = await interaction.editReply({
                ...editOpts,
                components: this.rows as unknown as any[],
            });
        }
        await this.persistContexts(msg.id, msg.channelId);
        return msg;
    }

    public async replyOrEditInteraction(
        interaction: ComponentInteraction,
        options: Omit<InteractionReplyOptions, 'components'>,
        isFirst: boolean,
    ): Promise<Message> {
        let msg = undefined
        if (isFirst) {
            if(!interaction.deferred) {
                await interaction.reply({
                    ...options,
                    components: this.rows as unknown as any[],
                    withResponse: true
                });
                msg = await interaction.fetchReply(); 
                
            } else {
                const { flags, ...editOpts } = options;
                msg = await interaction.editReply({
                    ...editOpts,
                    components: this.rows as unknown as any[],
                });
            }
            
        } else {
            const { flags, ...editOpts } = options;

            msg = await interaction.editReply({
                ...editOpts,
                components: this.rows as unknown as any[],
            });
        }
        await this.persistContexts(msg.id, msg.channelId);
        return msg;
    }

    protected async persistContexts(messageId: string, channelId: string) {
        const em = this.bot.db.getEm();

        // 1️⃣ Extrait les customIds présents dans this.rows
        let presentIds = this.rows.flatMap(row =>
        // row.components est un array de builders, chacun a data.custom_id
        (row.components as any[]).map(comp => comp.data.custom_id as string)
        );

        if (this.modal?.length)
             this.modal.flatMap(mod => {presentIds.push(mod.data.custom_id!)}) 

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

    protected buildComponentsFromJSON(definition: JSONComponent[]) {
        try {
            const actionRows: ActionRowBuilder<any>[] = [];
            const buttons: ButtonBuilder[] = []
            let modal: ModalBuilder[] = [];
            for (const comp of definition) {
                switch (comp.type) {
                    case JSONTypeComponent.StringSelectMenu: {
                        const menu = new StringSelectMenuBuilder()
                            .setCustomId(comp.customId)
                            .setPlaceholder(comp.placeholder || "Choisir…");
                        for (const opt of comp.options || []) {
                            const option = new StringSelectMenuOptionBuilder()
                                .setLabel(opt.label)
                                .setValue(opt.value)
                                .setDefault(comp.default === opt.value);
                                
                            if (opt.description && opt.description.length > 0) {
                                option.setDescription(opt.description);
                            }
                            menu.addOptions(option);
                        }
                        if (comp.other) {
                            for (const opt of comp.other || []) {
                                if (opt.name === 'CHANNELS_TYPE') {
                                    const allowedTypes = (opt.value as string[])
                                    .map(ct => typeMap[ct])
                                    .filter((t): t is ChannelType => typeof t !== 'undefined');
                                    let channels = this.bot.guild.channels.cache.filter(ch => allowedTypes.includes(ch.type) && (!opt.other || (typeof opt.other !== 'string') || ch.parentId === opt.other));
                                    
                                    if(opt.value.includes('GUILD_CATEGORY')) {
                                        const allowedTypesCat = (opt.other as string[])
                                        .map(ct => typeMap[ct])
                                        .filter((t): t is ChannelType => typeof t !== 'undefined');
                                        channels = channels.filter(cat =>
                                            // on regarde dans le cache de la guild tous les salons dont parentId === cat.id
                                            cat.guild.channels.cache.some(child =>
                                            child.parentId === cat.id && allowedTypesCat.includes(child.type)
                                            )
                                        );
                                    }

                                    for (const channel of channels.values()) {
                                        const option = new StringSelectMenuOptionBuilder()
                                            .setLabel(channel.name)
                                            .setValue(channel.id)
                                            .setDefault(channel.id === comp.default)
                                        
                                        menu.addOptions(option);
                                    }
                                }
                            }
                        }
                        if(menu.options.length) actionRows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
                        break;
                    }
                    case JSONTypeComponent.ChannelSelectMenu: {
                        const menu = new ChannelSelectMenuBuilder()
                            .setCustomId(comp.customId)
                            .setPlaceholder(comp.placeholder || "Choisir un salon…");
                        if (Array.isArray(comp.channelTypes)) {
                            const types = comp.channelTypes.map((ct: string) => {
                                switch (ct) {
                                    case "GUILD_TEXT": return ChannelType.GuildText;
                                    case "GUILD_VOICE": return ChannelType.GuildVoice;
                                    case "GUILD_CATEGORY": return ChannelType.GuildCategory;
                                    case "GUILD_ANNOUNCEMENT": return ChannelType.GuildAnnouncement;
                                    case "GUILD_FORUM": return ChannelType.GuildForum;
                                    default: return ChannelType.GuildText;
                                }
                            });
                            menu.addChannelTypes(...types);
                        }
                        if (Array.isArray(comp.default)) {
                            menu.setDefaultChannels(comp.default);      // ← fixe la/les salon(s) sélectionné(s)
                        }
                        actionRows.push(new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(menu));
                        break;
                    }
                    case JSONTypeComponent.RoleSelectMenu: {
                        const menu = new RoleSelectMenuBuilder()
                            .setCustomId(comp.customId)
                            .setPlaceholder(comp.placeholder || "Choisir un rôle…");
                        if (Array.isArray(comp.default)) {
                            menu.setDefaultRoles(comp.default);      // ← fixe la/les salon(s) sélectionné(s)
                        }
                        actionRows.push(new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(menu));
                        break;
                    }
                    case JSONTypeComponent.Button: {
                        const styleMap: Record<string, ButtonStyle> = {
                            Primary: ButtonStyle.Primary,
                            Secondary: ButtonStyle.Secondary,
                            Success: ButtonStyle.Success,
                            Danger: ButtonStyle.Danger,
                            Link: ButtonStyle.Link,
                        };
                        const btn = new ButtonBuilder()
                            .setLabel(comp.label)
                            .setStyle(styleMap[comp.style] || ButtonStyle.Primary);
                        if (comp.url) btn.setURL(comp.url);
                        else btn.setCustomId(comp.customId);
                        if (comp.disabled) btn.setDisabled(true);
                        if(comp.target) this.buttonTarget[comp.customId] = comp.target;
                        buttons.push(btn);
                        break;
                    }
                    case JSONTypeComponent.Modal: {
                        const m = new ModalBuilder().setCustomId(comp.customId).setTitle(comp.title);
                        for (const field of comp.fields || []) {
                            const input = new TextInputBuilder()
                                .setCustomId(field.customId)
                                .setLabel(field.label)
                                .setStyle(field.style === "Paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
                                .setRequired(field.required ?? false);
                            if (field.placeholder) input.setPlaceholder(field.placeholder);
                            if (field.minLength) input.setMinLength(field.minLength);
                            if (field.maxLength) input.setMaxLength(field.maxLength);
                            if (field.default)    input.setValue(field.default);
                            m.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
                        }
                        modal.push(m);
                        break;
                    }
                    default: {
                        logger.warn(`Composant inconnu: ${JSON.stringify(comp)}`);
                        break;
                    }
                }
            }
            if (buttons.length) actionRows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
            return { actionRows, modal };
        }
        catch (err) {
            logger.error({ err }, 'Erreur buildComponents');
            throw err;
        }
    }

    public onlyModal(): boolean {
        return (this.modal!== undefined) && (this.modal.length === 1) && (this.rows.length == 1)
    }


    protected abstract getData(customId: string): Record<string, any>;
}

export function getDefinitions(definitionsPath: string) {
    // 1️⃣ On charge le JSON depuis le fichier
    const absolutePath = path.isAbsolute(definitionsPath)
    ? definitionsPath
    : path.resolve(definitionsPath);
    let definitions: JSONComponent[];
    try {
        const raw = fs.readFileSync(absolutePath, 'utf-8');
        definitions = JSON.parse(raw);
    } catch (err) {
    logger.error({ msg: `Impossible de lire ou parser le fichier JSON : ${absolutePath}`, err });
        definitions = [];
    }
    return definitions;
}

export function injectDefaults(
  defs: JSONComponent[],
  config: JSONConfigManager<Record<string, string>>
): JSONComponent[] {
  return defs.map(def => {
    // clone pour ne pas muter l'original
    const comp = { ...def } as any;

    // Calcule la "key" de config à partir du customId
    // ex. 'select_channel_screen' -> 'channel_screen'
    const key = def.customId.replace(/^(select_|modal_|input_)/, '');

    // Valeur actuelle
    const current = config.get(key);
    if (current == undefined && (def.type !== JSONTypeComponent.Modal)) {
      return comp as JSONComponent;
    }

    switch (def.type) {
      case JSONTypeComponent.StringSelectMenu:
        comp.default = current;
        break;

      case JSONTypeComponent.ChannelSelectMenu:
        // Menu salon natif v14.13+
        comp.defaultChannels = [current];
        break;

      case JSONTypeComponent.RoleSelectMenu:
        comp.defaultRoles = [current];
        break;

      case JSONTypeComponent.Modal:
        // Injecte default dans le bon field
        comp.fields = (comp.fields as ModalField[]).map(field => {

            const fkey = field.customId.replace(/^input_/, '');
            const fdata = config.get(fkey)
            return { ...field, default: fdata };
        });
        break;

      // Button n'a pas de default
      case JSONTypeComponent.Button:
      default:
        break;
    }

    return comp as JSONComponent;
  });
}
