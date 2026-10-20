import { SettingKeys } from '../constants/SettingKeys.js';
import { settingsService } from '../services/SettingsService.js';
import { EntityManager } from '@mikro-orm/core';
import { getManagerLogger } from '../logger.js';
import { User } from '../entities/core/User.js';
import { BotManager } from '../BotManager.js';
import { Channel } from '../entities/core/Channel.js';
import { Role } from '../entities/core/Role.js';
import { RHMember } from '../entities/rh/RHMember.js';
import { EmbedBuilder, TextChannel } from 'discord.js';

export class PurgeManager {
  private logger = getManagerLogger('PurgeManager');
  constructor(private em: EntityManager, private bot: BotManager) {}

  /**
   * Purge les utilisateurs non valides et leurs relations associées
   */
  public async purgeInvalidUsers(): Promise<void> {
    const discordMembers = await this.bot.guild.members.fetch();
    const roleMemberId = this.bot.roleMember!.id;
    const dbUsers = await this.em.find(User, {}, { populate: ['rolesDiscord'] });
    const reservistRoleId = await settingsService.getString(SettingKeys.bot.roles.reserviste);

    for (const dbUser of dbUsers) {
      const discordMember = discordMembers.get(dbUser.discordId);

      if (discordMember?.id === this.bot.user!.id) {
        // Ignorer le bot
        continue;
      }

      if (!discordMember || !discordMember.roles.cache.has(roleMemberId) || discordMember?.roles.cache.has(reservistRoleId) || !discordMember.displayName.startsWith('[1CC]')) {
        // L'utilisateur n'est pas un membre valide, anonymisation
        await this.anonymizeUserData(dbUser);
        continue;
      }

      // L'utilisateur est un membre valide, synchronisation des rôles
      const roles = await this.bot.db.syncRoles(discordMember.roles.cache, this.em);
      dbUser.rolesDiscord.set(roles);
      await this.em.persist(dbUser).flush();
      await this.logger.debug(`Rôles mis à jour pour l'utilisateur : ${dbUser.username}`);
    }
  }

  /**
   * Anonymise un utilisateur sans supprimer ses données historiques
   */
  private async anonymizeUserData(user: User): Promise<void> {
    // Récupérer le RHMember associé à l'utilisateur
    const rhMember = await this.em.findOne<RHMember>('RHMember', { user: user.id });
    if (rhMember) {
      if (rhMember.status === 'Candidatures') {
        return;
      }
    }

    await this.purgeContract(user);
    await this.bot.userManager.deleteUser(user);
    await this.logger.debug(`Utilisateur anonymisé : ${user.username}`);
  }

  /**
   * Vérifie et purge les rôles Discord non valides
   */
  public async purgeInvalidRoles(): Promise<void> {
    const discordRoles = this.bot.guild.roles.cache;
    const dbRoles = await this.em.find(Role, {}, { populate: ['users'] });

    for (const dbRole of dbRoles) {
      if (!discordRoles.has(dbRole.discordId)) {
        // Supprimer les relations associées
        dbRole.users.removeAll();
        await this.em.flush();

        // Supprimer le rôle
        await this.em.remove(dbRole).flush();
        await this.logger.debug(`Rôle supprimé : ${dbRole.name}`);
      }
    }
  }

  /**
   * Vérifie et purge les canaux Discord non valides
   */
  public async purgeInvalidChannels(): Promise<void> {
    const discordChannels = this.bot.guild.channels.cache;
    const dbChannels = await this.em.find(Channel, {});

    for (const dbChannel of dbChannels) {
      if (!discordChannels.has(dbChannel.discordId)) {
        // Supprimer le canal
        await this.em.removeAndFlush(dbChannel);
        await this.logger.debug(`Canal supprimé : ${dbChannel.name}`);
      }
    }
  }

  
  public async purgeContract(user: User): Promise<void> {
    type ContractDiscordRow = {
      id: number;
      discord_message_id: string | null;
      discord_thread_id: string | null;
    };
    
    const em = this.em;

    const rows = await em.getConnection().execute<ContractDiscordRow[]>(
      `SELECT id, discord_message_id, discord_thread_id
      FROM contract
      WHERE discord_message_id <> '' AND discord_thread_id <> '' AND responsable_id = ?`,
      [user.id],
    );

    const channelId = '1452771277080100874';
    const channel = await this.bot.guild.channels.fetch(channelId) as TextChannel;


    for (const row of rows) {
      try {
        if (row.discord_thread_id) {
          const thread = await channel?.threads.fetch(row.discord_thread_id);
          if (thread) {
            await thread.setLocked(true, 'Purge des contrats pour utilisateur anonymisé');
            await this.logger.debug(`Thread de contrat verrouillé : ${row.discord_thread_id}`);
          }
        }

        if (row.discord_message_id) {
          const message = await channel?.messages.fetch(row.discord_message_id);
          
          if (message) {
            const embed = message.embeds[0];

            if (embed) {
              const eb = EmbedBuilder.from(embed);

              eb.setDescription('⛔ **Contrat Inactif**');
              eb.setColor(0xFF0000);

              await message.edit({ embeds: [eb] });
            } else {
              await message.edit({ content: '⛔ Contrat Inactif' });
            }

            await this.logger.debug(`Message de contrat modifié : ${row.discord_message_id}`);
          }
        }
      } catch (error) {
        await this.logger.error(`Erreur lors de la mise à jour du contrat Discord (ID: ${row.id}): ${error}`);
      }
    }
  }
}
