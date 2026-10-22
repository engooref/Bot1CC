import { SettingKeys } from '../constants/SettingKeys.js';
import { settingsService } from '../services/SettingsService.js';
import {
    ChatInputCommandInteraction,
    StringSelectMenuInteraction,
    ModalSubmitInteraction,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    EmbedBuilder,
    TextChannel,
} from 'discord.js';
import { BotManager } from '../BotManager.js';
import { getManagerLogger } from '../logger.js';
import { ComponentType, InteractionContext } from '../entities/ui/ViewContext.js';
import { ViewHandlers } from '../view/BaseView.js';
import { JSONConfigManager } from '../utils/JSONConfigManager.js';
import path from 'path';

interface GithubRepo {
    label: string;
    value: string; // format "owner/repo"
}

interface GithubConfig {
    repos: GithubRepo[];
    assistanceCategoryName: string;
}

export const GithubHandlers = {
    SelectRepo: 'github_select_repo',
    SubmitIssue: 'github_submit_issue',
} as const;

/** Labels posés automatiquement sur chaque issue créée depuis Discord. */
const AUTO_LABELS = ['from-discord', 'a-trier'];

/**
 * Les labels `agent:*` pilotent les agents IA (en particulier `agent:go`, le feu vert).
 * Ils ne peuvent pas être posés depuis Discord : seul le propriétaire du dépôt les gère sur GitHub.
 */
const AGENT_LABEL_PREFIX = 'agent:';

export class GithubManager {
    private em;
    private bot: BotManager;
    private logger = getManagerLogger('GithubManager');
    private config: JSONConfigManager<GithubConfig>;

    constructor(bot: BotManager) {
        this.bot = bot;
        this.em = bot.db.getEm();
        this.config = new JSONConfigManager<GithubConfig>(
            path.join('config', 'github.json')
        );
    }

    public getSlashHandlers() {
        return {
            githubHandler: this.handleCommand.bind(this),
        };
    }

    private async handleCommand(interaction: ChatInputCommandInteraction) {
        const subCommand = interaction.options.getSubcommand();
        if (subCommand === 'issue') {
            await this.handleIssueCommand(interaction);
        }
    }

    private async handleIssueCommand(interaction: ChatInputCommandInteraction) {
        const { assistanceCategoryName, repos } = this.config.getAll();
        const devRoleId = await settingsService.getString(SettingKeys.bot.github.roleDev);

        // Vérification : channel dans la catégorie Assistance
        const channel = interaction.channel as TextChannel;
        const categoryName = channel?.parent?.name;
        if (!categoryName || categoryName.toLowerCase() !== assistanceCategoryName.toLowerCase()) {
            await interaction.editReply({
                content: `⛔ Cette commande n'est disponible que dans la catégorie **${assistanceCategoryName}**.`,
            });
            return;
        }

        // Vérification : rôle dev
        const member = interaction.guild?.members.cache.get(interaction.user.id);
        if (!devRoleId || !member?.roles.cache.has(devRoleId)) {
            await interaction.editReply({
                content: '⛔ Vous n\'avez pas la permission d\'utiliser cette commande (rôle requis : Dev).',
            });
            return;
        }

        // Sélecteur de repository
        const select = new StringSelectMenuBuilder()
            .setCustomId(GithubHandlers.SelectRepo)
            .setPlaceholder('Sélectionnez un repository...')
            .addOptions(repos.map(r => ({ label: r.label, value: r.value })));

        const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

        const msg = await interaction.editReply({
            content: '📂 Sur quel repository souhaitez-vous créer un issue ?',
            components: [row],
        });

        // Sauvegarde du contexte pour la sélection
        const existing = await this.em.findOne(InteractionContext, {
            messageId: msg.id,
            customId: GithubHandlers.SelectRepo,
        });

        if (!existing) {
            const ctx = this.em.create(InteractionContext, {
                messageId: msg.id,
                channelId: interaction.channelId,
                customId: GithubHandlers.SelectRepo,
                handlerKey: ViewHandlers.GithubHandler,
                componentType: ComponentType.Select,
                data: {},
            });
            await this.em.persist(ctx).flush();
        }
    }

    public async handleSelectRepo(interaction: StringSelectMenuInteraction, _data: any) {
        const repo = interaction.values[0];

        // Récupération automatique des images du canal
        let prefillImages = '';
        try {
            const channel = interaction.channel as TextChannel;
            if (channel) {
                const messages = await channel.messages.fetch({ limit: 50 });
                const imageUrls: string[] = [];
                for (const msg of messages.values()) {
                    for (const attachment of msg.attachments.values()) {
                        const isImage =
                            attachment.contentType?.startsWith('image/') ||
                            /\.(png|jpg|jpeg)$/i.test(attachment.name ?? '');
                        if (isImage) imageUrls.push(attachment.url);
                    }
                    if (imageUrls.length >= 15) break;
                }
                prefillImages = imageUrls.join('\n').slice(0, 3900);
            }
        } catch (err) {
            this.logger.warn({ msg: 'Impossible de récupérer les images du canal', err });
        }

        const modal = new ModalBuilder()
            .setCustomId(GithubHandlers.SubmitIssue)
            .setTitle('Créer un Issue GitHub')
            .addComponents(
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('issue_title')
                        .setLabel('Titre')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(256)
                        .setPlaceholder('Ex: [BUG] Le bot crash au démarrage...')
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('issue_body')
                        .setLabel('Description')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                        .setMaxLength(3500)
                        .setPlaceholder('Décrivez le problème, les étapes pour le reproduire, le comportement attendu...')
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('issue_labels')
                        .setLabel('Labels (séparés par des virgules, optionnel)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                        .setPlaceholder('bug, enhancement, question...')
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('issue_assignees')
                        .setLabel('Assignés GitHub (logins, virgules, optionnel)')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(false)
                        .setPlaceholder('username1, username2...')
                ),
                new ActionRowBuilder<TextInputBuilder>().addComponents(
                    new TextInputBuilder()
                        .setCustomId('issue_images')
                        .setLabel('Images du canal — supprime celles non voulues')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(false)
                        .setPlaceholder('Aucune image trouvée dans le canal.')
                        .setValue(prefillImages)
                ),
            );

        // Sauvegarde du contexte pour le modal (avec le repo sélectionné)
        const existing = await this.em.findOne(InteractionContext, {
            messageId: interaction.message.id,
            customId: GithubHandlers.SubmitIssue,
        });

        if (existing) {
            existing.data = { repo };
            await this.em.persist(existing).flush();
        } else {
            const ctx = this.em.create(InteractionContext, {
                messageId: interaction.message.id,
                channelId: interaction.channelId,
                customId: GithubHandlers.SubmitIssue,
                handlerKey: ViewHandlers.GithubHandler,
                componentType: ComponentType.Modal,
                data: { repo },
            });
            await this.em.persist(ctx).flush();
        }

        await interaction.showModal(modal);
    }

    public async handleModalSubmit(interaction: ModalSubmitInteraction, data: any) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const { repo } = data as { repo: string };
        const title = interaction.fields.getTextInputValue('issue_title');
        const bodyText = interaction.fields.getTextInputValue('issue_body');
        const labelsRaw = interaction.fields.getTextInputValue('issue_labels');
        const assigneesRaw = interaction.fields.getTextInputValue('issue_assignees');
        const imagesRaw = interaction.fields.getTextInputValue('issue_images');

        const requestedLabels = labelsRaw
            ? labelsRaw.split(',').map(l => l.trim()).filter(Boolean)
            : [];
        const ignoredLabels = requestedLabels.filter(l => l.toLowerCase().startsWith(AGENT_LABEL_PREFIX));
        const labels = Array.from(new Set([
            ...requestedLabels.filter(l => !l.toLowerCase().startsWith(AGENT_LABEL_PREFIX)),
            ...AUTO_LABELS,
        ]));
        const assignees = assigneesRaw
            ? assigneesRaw.split(',').map(a => a.trim()).filter(Boolean)
            : [];
        const images = imagesRaw
            ? imagesRaw.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'))
            : [];

        // Infos automatiques du ticket Discord
        const channel = interaction.channel as TextChannel | null;

        const channelName = channel?.name ?? 'channel-inconnu';
        const channelId = interaction.channelId;
        const guildId = interaction.guildId;

        // Essaie de récupérer un numéro depuis le nom du channel : ticket-1234, ticket_1234, assistance-1234, etc.
        const ticketMatch =
            channelName.match(/(?:ticket|assistance|support)[-_ ]?(\d+)/i) ||
            channelName.match(/(\d+)/);

        const ticketNumber = ticketMatch?.[1] ?? 'non détecté';

        const discordChannelUrl = guildId
            ? `https://discord.com/channels/${guildId}/${channelId}`
            : 'Lien indisponible';

        // Titre envoyé à GitHub
        const githubTitle =
            ticketNumber !== 'non détecté'
                ? `[Ticket #${ticketNumber}] ${title}`
                : `[${channelName}] ${title}`;

        // Construction du corps de l'issue.
        // Les lignes sont assemblées sans indentation : une indentation de 4 espaces ou plus
        // après une ligne vide ferait afficher le contenu comme un bloc de code dans GitHub.
        let fullBody = [
            '### Ticket Discord',
            '',
            `- **Numéro du ticket :** ${ticketNumber}`,
            `- **Channel :** #${channelName}`,
            `- **Lien Discord :** ${discordChannelUrl}`,
            `- **Reporté par :** ${interaction.user.tag}`,
            '',
            '---',
            '',
            bodyText,
        ].join('\n');
        if (images.length > 0) {
            fullBody += '\n\n---\n### Images\n' + images.map(url => `![image](${url})`).join('\n');
        }
        fullBody += `\n\n---\n*Reporté par ${interaction.user.tag} via Discord*`;
        // Marqueur invisible dans GitHub : permet de retrouver le salon Discord d'une issue
        // (par exemple pour lui renvoyer son avancement) sans table de liaison en base.
        fullBody += `\n\n<!-- discord-ticket: guild=${guildId ?? 'inconnu'} channel=${channelId} -->`;

        const token = process.env.GITHUB_TOKEN;
        if (!token) {
            await interaction.editReply({
                content: '⚠️ Token GitHub non configuré (`GITHUB_TOKEN` manquant dans `.env`).',
            });
            return;
        }

        const [owner, repoName] = repo.split('/');

        try {
            const response = await fetch(
                `https://api.github.com/repos/${owner}/${repoName}/issues`,
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        Accept: 'application/vnd.github+json',
                        'X-GitHub-Api-Version': '2022-11-28',
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        title: githubTitle,
                        body: fullBody,
                        ...(labels.length > 0 ? { labels } : {}),
                        ...(assignees.length > 0 ? { assignees } : {}),
                    }),
                }
            );

            if (!response.ok) {
                const error = await response.json() as any;

                console.error('GitHub API error:', JSON.stringify(error, null, 2));

                const details = Array.isArray(error.errors)
                    ? error.errors
                        .map((e: any) => `- ${e.field ?? 'field'}: ${e.message ?? e.code}`)
                        .join('\n')
                    : '';

                await interaction.editReply({
                    content: `⚠️ Erreur GitHub API (${response.status}): ${error.message ?? response.statusText}\n${details}`,
                });
                return;
            }

            const issue = await response.json() as any;

            const embed = new EmbedBuilder()
                .setTitle(`✅ Issue #${issue.number} créée avec succès`)
                .setURL(issue.html_url)
                .setColor(0x238636)
                .addFields(
                    { name: 'Titre', value: githubTitle, inline: false },
                    { name: 'Ticket Discord', value: `#${channelName}`, inline: true },
                    { name: 'Numéro ticket', value: ticketNumber, inline: true },
                    { name: 'Repository', value: `\`${repo}\``, inline: true },
                    { name: 'Statut', value: issue.state, inline: true },
                )
                .setFooter({ text: `Créée par ${interaction.user.tag}` })
                .setTimestamp();

            if (labels.length > 0) {
                embed.addFields({ name: 'Labels', value: labels.map(l => `\`${l}\``).join(', '), inline: false });
            }
            if (ignoredLabels.length > 0) {
                embed.addFields({
                    name: 'Labels ignorés',
                    value: `${ignoredLabels.map(l => `\`${l}\``).join(', ')} (les labels \`${AGENT_LABEL_PREFIX}*\` se gèrent uniquement sur GitHub)`,
                    inline: false,
                });
            }
            if (assignees.length > 0) {
                embed.addFields({ name: 'Assignés', value: assignees.join(', '), inline: false });
            }

            await interaction.editReply({ embeds: [embed] });
            this.logger.info({ msg: `Issue créée: ${issue.html_url}`, user: interaction.user.tag });

            // Nettoyage du contexte modal
            await this.em.nativeDelete(InteractionContext, {
                customId: GithubHandlers.SubmitIssue,
                channelId: interaction.channelId,
            });
        } catch (err) {
            this.logger.error({ msg: 'Erreur création issue GitHub', err });
            await interaction.editReply({
                content: '⚠️ Une erreur est survenue lors de la création de l\'issue.',
            });
        }
    }
}
