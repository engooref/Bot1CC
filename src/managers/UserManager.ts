import { User as UserEntity } from '../entities/core/User.js';
import { RHMember as RHMemberEntity } from '../entities/hr/RHMember.js';
import { BotManager } from '../BotManager.js';
import { getManagerLogger } from '../logger.js';
import { Response } from '../entities/event/Response.js';
import { EntityManager } from '@mikro-orm/core';
import { SafeMethod } from '../exception/Safe.js';
import { InteractionContext } from '../entities/ui/ViewContext.js';


export class UserManager {
  public fem!: EntityManager ;
  private logger = getManagerLogger('UserManager');
  
  constructor(private bot: BotManager) {}

  get em(): EntityManager {
    if (!this.fem)
      this.fem = this.bot.db.getEm();
    
    return this.fem;
  }
  
  /** Supprime un utilisateur et ses données liées */
  @SafeMethod
  public async deleteUser(user: UserEntity): Promise<void> {
    try {
      await this.logger.info(`Suppression des informations de l'utilisateur : ${user.username}`);
      // reset des données dans l'entité
      user.reset();
      await this.em.persist(user).flush();

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

      await this.logger.debug('Suppression effectuée');
    } catch (e) {
      await this.logger.error(`Erreur lors de la suppression de l'utilisateur ${user.username} : ${e}`);
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
    let user = await this.bot.db.insertAndGetUser(guildMember);
    if (!user) throw new Error('Utilisateur non enregistré en BDD');

    // cherche ou crée le profil RH
    let memberRh = await this.em.findOne(RHMemberEntity, { user: user.id });
    if (!memberRh) {
      memberRh = this.em.create(RHMemberEntity, {
          user,
          status: '',
          dateEntree: new Date(0),
          grade: null,
          lastPromotion: new Date(0),
          pendingApproval: null,
          promotionSend: false,
      });
    }

    if (isNew) {
      memberRh.dateEntree = new Date();
    }

    await this.em.persist(memberRh).flush();
    return memberRh;
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
      await this.logger.error(`Erreur lors de l'acceptation de la candidature: id Candidat -> ${idCand} Erreur -> ${e}`);
      return { success: false, error: e };
    }
  }

  @SafeMethod
  public async removePromotion(interaction: any): Promise<void> {
    if (!interaction.isButton()) return;

    await this.em.nativeDelete(InteractionContext, { messageId: interaction.message.id });
    await interaction.message.delete();
  }
}
