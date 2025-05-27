import { ActionRowBuilder, Attachment, AttachmentBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, EmbedBuilder, GuildMemberRoleManager, GuildTextBasedChannel, Message, MessageFlags, Role, TextChannel } from "discord.js";
import BotManager from "../BotManager.js";
import { BaseComponentView, ViewHandlers } from "./BaseView.js";
import { ComponentType } from "../entities/ViewContext.js";
import logger from "../logger.js";



export default class EngaView extends BaseComponentView {

    constructor(
        bot: BotManager,
    ) {
        const button = new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder()
            .setCustomId('button_enga')
            .setLabel('Confirmer ma candidature')
            .setStyle(ButtonStyle.Success)
        )

        super(bot, ['button_enga'], ViewHandlers.EngaHandler, ComponentType.Button, [button])
    }

    protected getData(customId: string): Record<string, any> {
        return {};
    }

    
}

export async function sendEnga(bot: BotManager) {
    const channel = bot.guild.channels.cache.get(bot.getParameter('CHANNEL_ENGA') as string) as TextChannel;

    if (!channel) return
    
    const messageText = `### Vous désirez rejoindre le 1er Corps Colonial ?
    Rien de plus simple :

    1) Déposez votre candidature sur notre page RSI (onglet *Join us now*) :  
    https://robertsspaceindustries.com/orgs/1CC  
    ⚠️ La lecture du règlement dans l'onglet "Charter" sur RSI est très fortement conseillée …

    2) Cliquez ensuite sur le bouton ci-dessous pour confirmer votre candidature.

    3) Un officier prendra très rapidement contact avec vous pour finaliser la démarche.

    Au plaisir de vous accueillir très bientôt dans le Corps !`;

    const file = new AttachmentBuilder('res/AFFICHE-1CC.png')
    const fetched = await channel.messages.fetch({ limit: 100 });
    const botMessage = fetched
    .filter((msg) => msg.author.id === channel.client.user?.id)
    .first();

    const view = new EngaView(bot);

    await view.sendOrEdit(channel, botMessage, {
        content: messageText,
        files: file ? [file] : [],
    });
}

export async function sendCandidatures(interaction: ButtonInteraction, bot: BotManager) {
    try {
        await interaction.deferReply({flags: MessageFlags.Ephemeral})

        // Récupération des rôles Discord de l'utilisateur
        const member = interaction.member;
        if (!member || !('roles' in member)) {
            interaction.deleteReply()
            return
        }

        if ((member.roles as GuildMemberRoleManager).cache.has(bot.roleMember!.id)) {
            interaction.deleteReply()
            return 
        }

        // Chargement / création de l'entité en base
        const memberRh = await bot.usrMgr.initMemberRh(interaction.user.id);
        if (memberRh.dateDemand.getTime() !== new Date(0).getTime()) {
            interaction.editReply('Vous avez déjà une demande en cours.');
            return 
        }

        memberRh.dateDemand = new Date();
        memberRh.status = 'Candidatures';
        await bot.usrMgr.em.persistAndFlush(memberRh);

        await interaction.followUp({
        content: `Bravo, tu viens de franchir la première étape de ta candidature !  
        On va jeter un coup d'œil à ton dossier et on te tient au courant.  
        Reste sur le qui-vive 😉.`,
        ephemeral: true
        });

        // Préparation de l'annonce RH
        const guild = interaction.client.guilds.cache.get(bot.guildId);
        if (!guild) return;
        const channelRh = guild.channels.cache.get(bot.getParameter('CHANNEL_RH') as string) as GuildTextBasedChannel;
        if (!channelRh || !channelRh.isTextBased()) return;

        const rhRole = guild.roles.cache.get((bot.getParameter('ROLE_RH') as string[])[0]) as Role;
        const now = new Date().toLocaleString('fr-FR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
        });

        const embed = new EmbedBuilder()
        .setTitle('Annonce Candidature')
        .setDescription(`${rhRole?.toString() || ''}\nUn nouveau dossier vient d'être déposé par **${interaction.user.displayName}** le **${now}**.\nMerci de bien vouloir prendre en charge cette candidature dès que possible.`)
        .setColor(rhRole?.color || 0x00AE86)
        .setThumbnail(interaction.user.displayAvatarURL());

        // Ajout du lien RSI si valide
        const profileUrl = `https://robertsspaceindustries.com/en/citizens/${interaction.user.displayName.replace(/\[.*?\]/g, '').trim()}`;
        try {
        const res = await fetch(profileUrl);
        if (res.ok) {
            embed.addFields({
            name: 'Lien Citoyen RSI',
            value: `[Profil ${interaction.user.displayName}](${profileUrl})`,
            inline: true
            });
        }
        } catch (err) {
        logger.warn(`Impossible de vérifier le lien RSI: ${err}`);
        }

        embed.addFields({
        name: 'Lien vers la liste des candidatures',
        value: '[Candidatures 1CC](https://robertsspaceindustries.com/en/orgs/1CC/admin/applications)',
        inline: true
        });

        embed.addFields(
        {
            name: 'Envoyer un message privé',
            value: `[Envoyez un message](discord://-/channels/@me/${interaction.user.id})`,
            inline: true
        }
        );

        await channelRh.send({ embeds: [embed] });

    } catch (error) {
        logger.error(`Erreur lors de la confirmation de la candidature: ${error}`);
        if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: `Erreur: ${error}`, ephemeral: true });
        } else {
        await interaction.reply({ content: `Erreur: ${error}`, ephemeral: true });
        }
    }
}