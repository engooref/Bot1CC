import { EntityManager } from '@mikro-orm/core';
import logger from '../logger.js';
import { User } from '../entities/User.js';
import BotManager from '../BotManager.js';
import { Channel } from '../entities/Channel.js';
import { Role } from '../entities/Role.js';
import { RHMember } from '../entities/RHMember.js';

export default class PurgeManager {
  constructor(private em: EntityManager, private bot: BotManager) {}

  /**
   * Purge les utilisateurs non valides et leurs relations associées
   */
  public async purgeInvalidUsers(): Promise<void> {
    const discordMembers = await this.bot.guild.members.fetch();
    const roleMemberId = this.bot.roleMember!.id;
    const dbUsers = await this.em.find(User, {}, { populate: ['rolesDiscord'] });
    const reservistRoleId = process.env.RES_ID!;

    for (const dbUser of dbUsers) {
      const discordMember = discordMembers.get(dbUser.discordId);

      if (discordMember?.id === this.bot.user!.id) {
        // Ignorer le bot
        continue;
      }

      if (!discordMember || !discordMember.roles.cache.has(roleMemberId) || discordMember?.roles.cache.has(reservistRoleId) || !discordMember.displayName.startsWith('[1CC]')) {
        // L'utilisateur n'est pas un membre valide, suppression
        await this.removeUserAndRelations(dbUser);
        continue;
      }

      // L'utilisateur est un membre valide, synchronisation des rôles
      const roles = await this.bot.dbMgr.syncRoles(discordMember.roles.cache, this.em);
      dbUser.rolesDiscord.set(roles);
      await this.em.persistAndFlush(dbUser);
      await logger.debug(`Rôles mis à jour pour l'utilisateur : ${dbUser.username}`);
    }
  }

  /**
   * Supprime un utilisateur et ses relations associées
   */
  private async removeUserAndRelations(user: User): Promise<void> {
    // Récupérer le RHMember associé à l'utilisateur
    const rhMember = await this.em.findOne<RHMember>('RHMember', { user: user.id });
    if (rhMember) {
      if (rhMember.status === 'Candidatures') {
        return;
      }

      // Supprimer les transactions associées uniquement si RHMember existe
      await this.em.nativeDelete('XpTransaction', { rHMember: rhMember.id });
    }

    // Supprimer les réponses aux événements associées
    await this.em.nativeDelete('Response', { users: user.id });

    await this.em.nativeDelete('Traces', { user: user.id });

    // Supprimer l'utilisateur
    await this.em.removeAndFlush(user);
    await logger.debug(`Utilisateur supprimé : ${user.username}`);
  }

  /**
   * Vérifie et purge les rôles Discord non valides
   */
  public async purgeInvalidRoles(): Promise<void> {
    const discordRoles = this.bot.guild.roles.cache;
    const dbRoles = await this.em.find(Role, {}, { populate: ['parameters', 'users'] });

    for (const dbRole of dbRoles) {
      if (!discordRoles.has(dbRole.discordId)) {
        // Supprimer les relations associées
        dbRole.parameters.removeAll();
        dbRole.users.removeAll();
        await this.em.flush();

        // Supprimer le rôle
        await this.em.removeAndFlush(dbRole);
        await logger.debug(`Rôle supprimé : ${dbRole.name}`);
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
        // Supprimer les paramètres associés au canal
        await this.em.nativeDelete('Parameter', { valueChannel: dbChannel.id });

        // Supprimer le canal
        await this.em.removeAndFlush(dbChannel);
        await logger.debug(`Canal supprimé : ${dbChannel.name}`);
      }
    }
  }
}
