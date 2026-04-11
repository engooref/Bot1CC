import { EntityManager } from "@mikro-orm/core";
import { Client, Guild, TextChannel,  CategoryChannel, ChannelType, PermissionFlagsBits, ButtonInteraction, StringSelectMenuInteraction, ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ModalSubmitInteraction, MessageFlags, OverwriteResolvable, PermissionsBitField } from "discord.js";
import { BotManager } from "../BotManager.js";
import TicketTypeSelectView, { CloseTicketView, Handlers, OpenTicketView } from "../view/TicketsView.js";
import { getManagerLogger } from "../logger.js";
import { TicketType } from "../entities/tickets/TicketType.js";
import { TicketBots } from "../entities/tickets/TicketBots.js";
import { ComponentType, InteractionContext } from "../entities/ui/ViewContext.js";
import { ViewHandlers } from "../view/BaseView.js";

const CATEGORY_NAME = "Assistance";

export class TicketManager {
    private em: EntityManager;
    private bot: BotManager;
    private types!: TicketType[];
    private logger = getManagerLogger('TicketManager');

    private fcategory: CategoryChannel | undefined;

    constructor(bot: BotManager) {
        this.bot = bot;
        this.em = bot.db.getEm();
        this.bot.excludeCategory.push(CATEGORY_NAME);

        
    }

    public async init() {
        await this.logger.debug('Initialisation des tickets')
        this.types = await this.em.findAll(TicketType);

        const channel = await this.ensureCreationChannel();
        const fetched = await channel.messages.fetch({ limit: 50 });
        const existing = fetched.find(m => m.author.id === this.bot.user!.id && m.components.length > 0) || null;

        // Send or update the ticket creation view
        const view = new OpenTicketView(this.bot);

        await view.sendOrEdit( 
            channel, 
            existing,
            {
                embeds: [{ 
                    title: 'Tickets', 
                    description: 'Pour créer un ticket, cliquer sur le bouton ci-dessous.', 
                    color: 0x5865F2 
                }]
            }
        );
        await this.ensureRecapChannel();
    }

    private async ensureCategory() {
        if (!this.fcategory) {
            const guild = this.bot.guild;
            this.fcategory = guild.channels.cache.find(
                c => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME
            ) as CategoryChannel | undefined;

            if (!this.fcategory) {
                this.fcategory = await guild.channels.create({
                    name: CATEGORY_NAME,
                    type: ChannelType.GuildCategory,
                    permissionOverwrites: [{
                        id: guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
                    },
                    {
                    id: this.bot.roleMember!.id,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
                    }],
                });
            }
        }
        
        return this.fcategory;
    }  

    private async ensureCreationChannel(): Promise<TextChannel> {
        const guild = this.bot.guild;
        const category = await this.ensureCategory();

        // Salon création-opération
        let creationChannel = guild.channels.cache.find(
        c => 
            c.parentId === category.id &&
            c.type === ChannelType.GuildText &&
            c.name === 'création-tickets'
        ) as TextChannel;
        if (!creationChannel) {
        creationChannel = await guild.channels.create({
            name: 'création-tickets',
            type: ChannelType.GuildText,
            parent: category.id,
        });
        }
        return creationChannel;
    }

    private async ensureRecapChannel(): Promise<TextChannel> {
        const guild = this.bot.guild;
        const category = await this.ensureCategory();

        // Salon création-opération
        let creationChannel = guild.channels.cache.find(
        c => 
            c.parentId === category.id &&
            c.type === ChannelType.GuildText &&
            c.name === 'recap-tickets'
        ) as TextChannel;
        if (!creationChannel) {
        creationChannel = await guild.channels.create({
            name: 'recap-tickets',
            type: ChannelType.GuildText,
            parent: category.id,
        });
        }
        return creationChannel;
    }

    public async sendForm(interaction: ButtonInteraction) {
        const view = new TicketTypeSelectView(this.bot, this.types);
        await view.replyOrEditInteraction(
            interaction,
            {
                content: "Quel service souhaitez-vous contacter ?",
                flags: MessageFlags.Ephemeral,
                
            },
            true
        )
    }

    public async createTickets(interaction: StringSelectMenuInteraction, data: any) {
        const type = this.types.find(t => t.id == Number(interaction.values[0]))!;
        const roleType = this.bot.guild.roles.cache.get(type.roleAuth); 

        const adminRoles = this.bot.guild.roles.cache.filter(role =>
            role.permissions.has(PermissionsBitField.Flags.Administrator),
        );

        // Construire le tableau d’overwrites
        const overwrites: OverwriteResolvable[] = [
            // Interdire l’accès à @everyone
            {
                id: this.bot.guild.roles.everyone.id,
                deny: [PermissionsBitField.Flags.ViewChannel],
            },
            // Autoriser l’utilisateur
            {
                id: interaction.user.id,
                allow: [
                PermissionsBitField.Flags.ViewChannel,
                PermissionsBitField.Flags.SendMessages,
                PermissionsBitField.Flags.ReadMessageHistory,
                ],
            },
            // Si un rôle spécifique est configuré pour ce ticket, l’autoriser aussi
            ...(roleType
                ? [{
                    id: roleType.id,
                    allow: [
                    PermissionsBitField.Flags.ViewChannel,
                    PermissionsBitField.Flags.SendMessages,
                    PermissionsBitField.Flags.ReadMessageHistory,
                    ],
                }]
                : []),
            // Autoriser tous les rôles admins
            ...adminRoles.map(role => ({
                id: role.id,
                allow: [PermissionsBitField.Flags.ViewChannel],
            })),
        ];

        const guild = this.bot.guild;
        const category = await this.ensureCategory();
        const channel = await guild.channels.create({
            name: `tickets-${interaction.user.username.replace(' ', '-').toLowerCase()}`, 
            type: ChannelType.GuildText,
            parent: category.id,
            permissionOverwrites: overwrites
        });

        const ticket = this.em.create(TicketBots, {
            type: type,
            channelId: channel.id,
            closed: new Date(),
            closedMessage: '',
            closedUserId: '0',
            issue: '',
            open: new Date(),
            userId: interaction.user.id
        })

        await this.em.persist(ticket).flush();
        
        const view = new CloseTicketView(this.bot, ticket.id);

        await view.sendOrEdit( channel, null,
            { 
                embeds: [
                    { 
                        title: `Ticket n°${ticket.id} Créé`, 
                        description: `Votre ticket a été créé avec succès. ${roleType ? `${roleType}` : ''}\nUtilisez les options ci-dessous pour le gérer.`, 
                        color: Math.floor(Math.random()*0xffffff)
                    }
                ] 
            }
        );
 
        await interaction.update({ content: `Votre ticket a été créé dans <#${channel.id}>`, components: [] });
        await this.logger.debug(`Ticket n°${ticket.id} Créer`)

        await this.em.nativeDelete(InteractionContext, {messageId: interaction.message.id});

    }

    public async closeForm(interaction: ButtonInteraction, data: any) {
        const modal = new ModalBuilder()
        .setCustomId(Handlers.SubmitClose)  
        .setTitle('Clôture du Ticket')
        .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder()
                .setCustomId('select_clotureModal')
                .setLabel('Message de Clôture')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(false)
                .setPlaceholder('Indiquez un message de clôture (optionnel)')
                .setValue('')
            ),
        );

        const existing = await this.em.findOne(InteractionContext, {
            messageId:   interaction.message.id,      
            channelId:   interaction.channelId,
            customId:    Handlers.SubmitClose,          
            handlerKey:  ViewHandlers.TicketsHandler,
        });

        if (existing) {
        existing.data = data;
        await this.em.persist(existing).flush();     
        } else {
        const ctx = this.em.create(InteractionContext, {
            messageId:   interaction.message.id,       
            channelId:   interaction.channelId,
            customId:    Handlers.SubmitClose,         
            handlerKey:  ViewHandlers.TicketsHandler,
            componentType: ComponentType.Modal,
            data:        data,
        });
        await this.em.persist(ctx).flush();
        }
        await interaction.showModal(modal)
    }

    public async modalSubmit(interaction: ModalSubmitInteraction, data: any) {
        await interaction.deferReply();
        
        const ticket = await this.em.findOneOrFail(TicketBots, {id: data.id})

        ticket.closed = new Date();
        ticket.closedUserId = interaction.user.id;
        ticket.closedMessage = interaction.fields.getTextInputValue('select_clotureModal') !== '' ? interaction.fields.getTextInputValue('select_clotureModal') : 'Aucune raison indiquée';
        await this.em.persist(ticket).flush();

        const userOpen = await this.bot.guild.members.fetch(ticket.userId);
        const embed = {
            title: 'Clôture Ticket',
            description: 'Récapitulatif Ticket',
            color: Math.floor(Math.random()*0xffffff),
            fields: [
                { name: 'Numéro de ticket :', value: `${ticket.id}`, inline: false },
                { name: 'Ouverture le :', value: `\`\`\`${ticket.open.toLocaleString('fr-FR')}\`\`\``, inline: true },
                { name: 'Ouvert par :', value: `${userOpen}`, inline: true },
                { name: '', value: '', inline: false},
                { name: 'Clôturé le :', value: `\`\`\`${ticket.closed.toLocaleString('fr-FR')}\`\`\``, inline: true },
                { name: 'Clôturé par :', value: `${interaction.user}`, inline: true },
                { name: 'Raison Clôture :', value: ticket.closedMessage, inline: false }
            ]
        };
        const recapChan = await this.ensureRecapChannel();
        if (recapChan) await recapChan.send({ embeds: [embed] });
        const chan = this.bot.guild.channels.cache.get(ticket.channelId) as TextChannel;
        if (chan) await chan.delete();

        await userOpen.send({ embeds: [embed] });

        try {
        await interaction.deleteReply();
        } catch {}
        

        await this.logger.debug(`Ticket n°${ticket.id} Cloturé -> ${ticket.closedMessage}`)

        this.em.nativeDelete(InteractionContext, {messageId: interaction.message?.id})
    }
}