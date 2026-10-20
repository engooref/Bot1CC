import { User as UserEntity } from '../entities/core/User.js';
import { RHMember as RHMemberEntity } from '../entities/rh/RHMember.js';
import { BotManager } from '../BotManager.js';
import { getManagerLogger } from '../logger.js';
import { EntityManager } from '@mikro-orm/core';
import { SafeMethod } from '../exception/Safe.js';
import { InteractionContext } from '../entities/ui/ViewContext.js';
import { Rank } from '../entities/core/Rank.js';


export class UserManager {
  public fem!: EntityManager ;
  private logger = getManagerLogger('UserManager');
  
  constructor(private bot: BotManager) {}

  get em(): EntityManager {
    if (!this.fem)
      this.fem = this.bot.db.getEm();
    
    return this.fem;
  }
  
  /** Anonymise un utilisateur au lieu de le supprimer */
  @SafeMethod
  public async deleteUser(user: UserEntity): Promise<void> {
    try {
      await this.logger.info(`Anonymisation des informations de l'utilisateur : ${user.username}`);

      const anonymousDiscordId = `anon-user-${user.id}`;

      // Réinitialise les données publiques et casse le lien direct avec le compte Discord.
      user.reset();
      user.username = `Ancien membre #${user.id}`;
      user.discordId = anonymousDiscordId;
      await this.em.persist(user).flush();

      await this.logger.debug(`Anonymisation effectuée : ${anonymousDiscordId}`);
    } catch (e) {
      await this.logger.error(`Erreur lors de l'anonymisation de l'utilisateur ${user.username} : ${e}`);
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
      const roleRecrueId = await this.bot.db.getEm().findOneOrFail(Rank, { baseRank: null }).then(rank => rank.roleDiscord!.discordId);
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
