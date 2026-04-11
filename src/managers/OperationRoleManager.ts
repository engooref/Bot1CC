import {
  ChannelType,
  EmbedBuilder,
  TextChannel,
  MessageReaction,
  User,
  CategoryChannel,
} from 'discord.js';
import { BotManager } from '../BotManager.js';
import { JSONConfigManager } from '../utils/JSONConfigManager.js';
import { getManagerLogger } from '../logger.js';

/** Interface minimale requise par OperationRoleManager pour éviter l'import circulaire */
export interface IOperationRoleProvider {
  ensureCategory(): Promise<CategoryChannel>;
  roleConfig: JSONConfigManager<Record<string, string>>;
}

export class OperationRoleManager {
    private logger = getManagerLogger('OperationRoleManager');

    constructor(
        private bot: BotManager,
        private module: IOperationRoleProvider,
    ) {}

    /** Crée (ou récupère) la catégorie "Opérations" et le salon "role-opération". */
    public async ensureRoleChannel(): Promise<TextChannel> {
        const guild = this.bot.guild;

        // Catégorie
        const category = await this.module.ensureCategory();

        // Salon role-opération
        let roleChannel = guild.channels.cache.find(
        c =>
            c.parentId === category.id &&
            c.type === ChannelType.GuildText &&
            c.name === 'role-opération'
        ) as TextChannel;
        if (!roleChannel) {
        roleChannel = await guild.channels.create({
            name: 'role-opération',
            type: ChannelType.GuildText,
            parent: category.id,
        });
        }

        return roleChannel;
    }

    public async updateRoles(): Promise<void> {
        const roleMap = this.module.roleConfig.getAll();

        const roleChannel = await this.ensureRoleChannel();
        const embed = new EmbedBuilder()
        .setTitle('Rôle Opération')
        .setDescription('Réagissez aux emojis suivants pour les pings opérations:')
        .setColor(0xff0000);

        for (const [emoji, roleId] of Object.entries(roleMap)) {
            const role = this.bot.guild.roles.cache.get(roleId);
            if (role)
                embed.addFields({ name: '', value: `${emoji} : ${role.name}` , inline: false });
        }

        const fetched = await roleChannel.messages.fetch({ limit: 50 });
        const existing = fetched.find(m => m.author.id === this.bot.user!.id && m.embeds.length);

        let msg = existing!;
        if (msg) await msg.edit({ embeds: [embed] });
        else    msg = await roleChannel.send({ embeds: [embed] });

        for (const emoji of Object.keys(roleMap)) {
            await msg.react(emoji).catch(() => null);
        }

        const filter = (reaction: MessageReaction, user: User) =>
          roleMap.hasOwnProperty(reaction.emoji.name!)  && !user.bot;

      const collector = msg.createReactionCollector({ filter, dispose:true }); // 1h

      collector.on('collect', async (reaction, user) => {
        // Ignore les bots
        if (user.bot) return;

        // Récupère l'émoji comme clé
        const emoji = reaction.emoji.name!;
        // roleEmoji est ton mapping emoji → roleId
        const roleId = roleMap[emoji];
        if (!roleId) return;  // pas de rôle associé à cet émoji

        // Récupère le membre de la guilde
        const guild = reaction.message.guild;
        if (!guild) return;

        let member = guild.members.cache.get(user.id);
        // Si pas en cache, fetch le membre
        if (!member) {
          try {
            member = await guild.members.fetch(user.id);
          } catch {
            await this.logger.warn(`Membre ${user.id} introuvable.`);
            return;
          }
        }

        // Ajoute le rôle
        try {
          await member.roles.add(roleId);
          await this.logger.debug(`Ajout du rôle ${roleId} à ${user.tag} pour l'émoji ${emoji}.`);
        } catch (err) {
          await this.logger.error({ msg: `Impossible d'ajouter le rôle ${roleId} à ${user.tag}:`, err });
        }
      });

      collector.on('remove', async (reaction, user) => {
        if (user.bot) return;
        const emoji = reaction.emoji.name!;
        const roleId = roleMap[emoji];
        if (!roleId) return;

        const guild = reaction.message.guild;
        if (!guild) return;
        let member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id);

        try {
          await member.roles.remove(roleId);
          await this.logger.debug(`Retrait du rôle ${roleId} pour ${user.tag} suite au retrait de ${emoji}`);
        } catch (err) {
          await this.logger.error({ msg: "Impossible de retirer le rôle :", err });
        }
      });
    }
}
