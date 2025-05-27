
import { User as UserEntity } from '../entities/User.js';
import { RHMember as RHMemberEntity } from '../entities/RHMember.js';
import BotManager from '../BotManager.js';
import logger from '../logger.js';
import { Response } from '../entities/Response.js';
import { EntityManager } from '@mikro-orm/core';
import { SafeMethod } from '../exception/Safe.js';


export default class UserManager {
  public fem!: EntityManager ;
  
  constructor(private bot: BotManager) {}

  get em(): EntityManager {
    if (!this.fem)
      this.fem = this.bot.dbMgr.getEm();
    
    return this.fem;
  }
  
  /** Supprime un utilisateur et ses données liées */
  @SafeMethod
  public async deleteUser(user: UserEntity): Promise<void> {
    try {
      logger.info(`Suppression des informations de l'utilisateur : ${user.username}`);
      // reset des données dans l'entité
      user.reset();
      await this.em.persistAndFlush(user);

      // suppression du profil RH
      if (user.rhProfile) {
        await this.em.removeAndFlush(user.rhProfile);
      }

      const responsesCount = await this.em.count(Response, {users: user})

      // si plus aucune trace, réponse ou rôle, on supprime l'utilisateur
      if (
        responsesCount === 0 &&
        (user.rolesDiscord.isEmpty?.() ?? user.rolesDiscord.length === 0)
      ) {
        await this.em.removeAndFlush(user);
      }

      logger.info('Suppression effectuée');
    } catch (e) {
      logger.error(`Erreur lors de la suppression des infos de l'utilisateur ${user.username} → ${e}`);
      throw e;
    }
  }

  /**
   * Initialise ou met à jour le profil RH d’un membre Discord
   * @param userDiscordId Snowflake du membre
   * @param isNew true si c’est la première création
   */
  @SafeMethod
  public async initMemberRh(userDiscordId: string, isNew = false): Promise<RHMemberEntity> {
    // récupère le GuildMember
    const guildMember = await this.bot.guild.members.fetch(userDiscordId).catch(() => null);
    if (!guildMember) throw new Error('Membre non trouvé sur Discord');

    // insère ou récupère l’utilisateur en BDD
    let user = await this.bot.dbMgr.insertAndGetUser(guildMember);
    if (!user) throw new Error('Utilisateur non enregistré en BDD');

    // cherche ou crée le profil RH
    let memberRh = await this.em.findOne(RHMemberEntity, { user: user.id });
    if (!memberRh) {
      memberRh = this.em.create(RHMemberEntity, {
          user,
          status: '',
          dateEntree: '',
          dateDemand: ''
      });
    }

    // synchronise d’abord tous les rôles Discord en BDD
    await this.bot.dbMgr.syncRoles(guildMember.roles.cache);

    // attribue le grade principal
    const dbRoles = user.rolesDiscord.getItems?.() ?? user.rolesDiscord.toArray();
    memberRh.grade =
      dbRoles.find(r => r.isGrade && r.discordId !== this.bot.roleMember!.id) ??
      dbRoles.find(r => r.discordId === this.bot.roleMember!.id) ??
      undefined;

    if (isNew) {
      memberRh.dateEntree = new Date();
    }

    await this.em.persistAndFlush(memberRh);
    return await this.em.findOneOrFail(RHMemberEntity, { user: user.id });
  }

  /**
   * Accepte une candidature RH en attribuant les rôles Discord
   * @param idCand identifiant de RHMember en BDD
   */
  @SafeMethod
  public async acceptCandidature(idCand: number): Promise<{ success: true } | { success: false; error: Error }> {
    try {
      if (idCand === -1) {
        throw new Error('Id Candidat non renseigné');
      }

      // récupère le profil RH
      const memberRh = await this.em.findOne(RHMemberEntity, idCand);
      if (!memberRh) {
        throw new Error('Membre RH non trouvé');
      }

      // récupère le GuildMember
      const guildMember = await this.bot.guild.members.fetch(memberRh.user!.discordId);
      if (!guildMember) {
        throw new Error('GuildMember non trouvé');
      }

      // récupère le rôle "recrue"
      const roleRecrueId = this.bot.getParameter('ROLE_RECRUE')[0];
      const roleRecrue = this.bot.guild.roles.cache.get(roleRecrueId);
      if (!roleRecrue) {
        throw new Error('Rôle recrue non trouvé');
      }

      // ajoute les rôles
      await guildMember.roles.add([roleRecrue, this.bot.roleMember!], 'Acceptation Candidature');

      return { success: true };
    } catch (e: any) {
      logger.error(`Erreur lors de l'acceptation de la candidature: id Candidat -> ${idCand} Erreur -> {e}`);
      return { success: false, error: e };
    }
  }
}