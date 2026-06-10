import { 
  ChannelType, 
  GuildBasedChannel, 
  Collection, 
  type Role as DiscordRole, 
  APIUser,
  GuildMember,
  CategoryChannel,
  GuildChannel,
}   from 'discord.js';

import { MikroORM, EntityManager,  } from '@mikro-orm/core';
import { getManagerLogger }            from '../logger.js';
import { User }          from '../entities/core/User.js';
import { Role }          from '../entities/core/Role.js';
import { Channel  } from '../entities/core/Channel.js';
import config from '../mikro-orm.config.js';
import { BotManager } from '../BotManager.js';
import { SafeMethod } from '../exception/Safe.js';
import { PurgeManager } from './PurgeManager.js';
import { RHMember } from '../entities/rh/RHMember.js';
import { Rank } from '../entities/core/Rank.js';

export class DatabaseManager {
  /**
   * Retourne les handlers pour SlashCommandManager
   */
  public getSlashHandlers(): Record<string, (interaction: any) => Promise<void>> {
    return {
      handleDatabaseCommand: this.handleDatabaseCommand.bind(this)
    };
  }
  public orm!: MikroORM;
  private excludeCategories: string[];
  private bot : BotManager;
  private logger = getManagerLogger('DatabaseManager');

  /**
   * Handler slash pour la commande /db (privé, owner only, DM only)
   */
  public async handleDatabaseCommand(interaction: any) {
    this.logger.info(`Commande /db reçue de ${interaction.user.tag} (${interaction.user.id})`);
    const ownerId = process.env.ENGOO_ID;
    if (interaction.user.id !== ownerId) {
      await interaction.followUp({ content: '⛔ Commande réservée au propriétaire.', ephemeral: true });
      return;
    }
    if (interaction.guild) {
      await interaction.followUp({ content: '⛔ Cette commande est disponible uniquement en DM.', ephemeral: true });
      return;
    }

    const sub = interaction.options.getSubcommand();
    if (sub === 'purge') {

      try {
        const purge = new PurgeManager(this.getEm(), this.bot);

        await purge.purgeInvalidUsers();
        await purge.purgeInvalidRoles();
        await purge.purgeInvalidChannels();

        await interaction.followUp({ content: '✅ Purge des utilisateurs, rôles et canaux invalides effectuée.', ephemeral: true });
      } catch (err) {

        await this.logger.error({ msg: 'Erreur lors de la purge des utilisateurs, rôles et canaux invalides :', err });
        await interaction.followUp({ content: '❌ Une erreur est survenue lors de la purge.', ephemeral: true });
      }

    } else if (sub === 'sync_users') {
      try {
        const discordMembers = await this.bot.guild.members.fetch();
        const em = this.getEm();
        const roleMemberId = this.bot.roleMember!.id;
        const reservistRoleId = process.env.RES_ID!;

        for (const [id, member] of discordMembers) {
          
          if (id === this.bot.user!.id) {
            continue;
          }

          if (!member || !member.roles.cache.has(roleMemberId) || member?.roles.cache.has(reservistRoleId)) {
            continue;
          }

          // Vérifier que le nom du membre commence par [1CC] ou [1CC] suivi d'un espace
          if (!member.displayName.startsWith('[1CC]')) {
            continue;
          }

          // Synchroniser les rôles
          const roles = await this.syncRoles(member.roles.cache, em);

          // Mettre à jour ou insérer l'utilisateur
          let user = await em.findOne(User, { discordId: id });
          if (!user) {
            user = em.create(User, {
              username: member.displayName,
              discordId: id,
              avatar: member.user.avatar ?? '',
            });
          } else {
            user.username = member.displayName;
            user.avatar = member.user.avatar ?? '';
          }
          user.rolesDiscord.set(roles);
          await em.persist(user).flush();

          // Vérifier ou créer le profil RH
          let rhMember = await em.findOne<RHMember>('RHMember', { user: user.id });
          if (!rhMember) {
            rhMember = em.create<RHMember>('RHMember', {
              user,
              status: 'Actif',
              dateEntree: new Date(),
              pendingApproval: null,
              promotionSend: false,
            });
          } else if (rhMember.status === 'Candidatures') {
            rhMember.status = 'Actif';
          }
          await em.persist(rhMember).flush();
        }

        await interaction.followUp({ content: '✅ Synchronisation des utilisateurs terminée.', ephemeral: true });
      } catch (err) {
        await this.logger.error({ msg: 'Erreur lors de la synchronisation des utilisateurs :', err });
        await interaction.followUp({ content: '❌ Une erreur est survenue lors de la synchronisation des utilisateurs.', ephemeral: true });
      }
    } else if (sub === "sync_events") {
      try {
        await this.bot.schedulerManager.appEvent.sendEventsWeek();
        await interaction.followUp({ content: '✅ Synchronisation des événements terminée.', ephemeral: true });
      } catch (err) {
        await this.logger.error({ msg: 'Erreur lors de la synchronisation des événements :', err });
        await interaction.followUp({ content: '❌ Une erreur est survenue lors de la synchronisation des événements.', ephemeral: true });
      }
    } else if (sub === "sync_ranks") {
      try {
        await this.syncRolesRank();
        await interaction.followUp({ content: '✅ Synchronisation des grades terminée.', ephemeral: true });
      } catch (err) {
        await this.logger.error({ msg: 'Erreur lors de la synchronisation des grades :', err });
        await interaction.followUp({ content: '❌ Une erreur est survenue lors de la synchronisation des grades.', ephemeral: true });
      }
    } else if (sub === "sync_ranksRoles") {
      try {
        await this.syncRolesRank();
        await interaction.followUp({ content: '✅ Synchronisation des grades et rôles terminée.', ephemeral: true });
      } catch (err) {
        await this.logger.error({ msg: 'Erreur lors de la synchronisation des grades et rôles :', err });
        await interaction.followUp({ content: '❌ Une erreur est survenue lors de la synchronisation des grades et rôles.', ephemeral: true });
      }
    } else if (sub === "new_accounts_report") {
      try {
        await this.generateNewAccountsReport(interaction);
      } catch (err) {
        await this.logger.error({ msg: 'Erreur lors de la génération du rapport des nouveaux comptes :', err });
        await interaction.followUp({ content: '❌ Une erreur est survenue lors de la génération du rapport.', ephemeral: true });
      }
    }
  }

  /**
   * Génère un rapport des membres avec un compte créé moins de 3 mois avant d'avoir rejoint le serveur
   */
  private async generateNewAccountsReport(interaction: any): Promise<void> {
    const discordMembers = await this.bot.guild.members.fetch();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000; // 90 jours en millisecondes

    const suspiciousAccounts: Array<{
      username: string;
      discordId: string;
      createdAt: Date;
      joinedAt: Date;
      daysBeforeJoin: number;
    }> = [];

    for (const [, member] of discordMembers) {
      if (!member.user.createdTimestamp || !member.joinedTimestamp) continue;

      // Exclure les bots et applications
      if (member.user.bot) continue;

      const accountAge = member.joinedTimestamp - member.user.createdTimestamp;
      const daysBeforeJoin = Math.floor(accountAge / (24 * 60 * 60 * 1000)); // Convertir en jours

      // Si le compte a moins de 3 mois avant de rejoindre le serveur
      if (accountAge < ninetyDaysMs) {
        suspiciousAccounts.push({
          username: member.displayName,
          discordId: member.id,
          createdAt: new Date(member.user.createdTimestamp),
          joinedAt: new Date(member.joinedTimestamp),
          daysBeforeJoin,
        });
      }
    }

    // Générer le contenu CSV
    const csvHeader = 'Pseudo Discord,ID Discord,Date de création du compte,Date d\'adhésion au serveur,Jours avant adhésion\n';
    const csvContent = suspiciousAccounts
      .map(acc => `${acc.username},${acc.discordId},${acc.createdAt.toISOString()},${acc.joinedAt.toISOString()},${acc.daysBeforeJoin}`)
      .join('\n');

    const fullCsv = csvHeader + csvContent;

    // Créer un fichier et l'envoyer
    const { AttachmentBuilder } = await import('discord.js');
    const attachment = new AttachmentBuilder(Buffer.from(fullCsv), { name: 'rapport_nouveaux_comptes.csv' });

    await interaction.followUp({
      content: `✅ Rapport généré : ${suspiciousAccounts.length} compte(s) créé(s) moins de 3 mois avant la date d'adhésion au serveur.`,
      files: [attachment],
      ephemeral: true
    });
  }

  constructor(bot: BotManager, excludeCategories: string[] = []) {
    this.bot = bot;
    this.excludeCategories = excludeCategories;
  }

  public addExclude(...excludes: string[]) {
    this.excludeCategories.push(...excludes);

  }

  /**
   * Initialise la connexion MikroORM et fork un EntityManager
   */
  @SafeMethod
  public async connect(): Promise<void> {
    this.orm = await MikroORM.init(config);
    await this.logger.debug('✅ MikroORM connecté');
    
  }

  /**
   * Insère ou met à jour un utilisateur Discord en base, et le retourne
   * avec sa collection rolesDiscord entièrement chargée.
   */
  @SafeMethod
  public async insertAndGetUser(
    member: GuildMember | APIUser
  ): Promise<User> {
    return this.orm.em.transactional<User>(async em => {
      const mg = member instanceof GuildMember
        ? member
        : await this.bot.guild.members.fetch(member.id);

      // 1) Charge l'user + rôles existants
      let user: User | null = await em.findOne(User,
        { discordId: mg.id },
        { populate: ['rolesDiscord'] }
      );

      // 2) Synchronise les rôles Discord dans la table Role
      const roles = await this.syncRoles(mg.roles.cache, em);

      const avatarUrl = mg.user.avatar ?? '';
      let id: number;

      if (!user) {
        // création, rôles injectés après create()
        user = em.create(User, {
          username:       mg.displayName,
          discordId:      mg.id,
          avatar:         avatarUrl,
        });
        user.rolesDiscord.set(roles);

      } else {
        // mise à jour : on n'insert que les rôles manquants
        user.username = mg.displayName;
        user.avatar   = avatarUrl;
        for (const role of roles) {
          if (!user.rolesDiscord.contains(role)) {
            user.rolesDiscord.add(role);
          } else {
            user.rolesDiscord.remove(role);
          }
        }
      }
      
      await em.persist(user).flush();
      id = user.id;
      // 3) Reload pour retourner un Loaded<User,'rolesDiscord'>
      return em.findOneOrFail(User,
        { id },
        { populate: ['rolesDiscord'] }
      );
    });
  }

  /**
   * Insère les rôles Discord manquants et renvoie la liste complète des RoleEntity.
   */
  @SafeMethod
  public async syncRoles(
    discordRoles: Collection<string, DiscordRole>,
    em: EntityManager = this.getEm(),
  ): Promise<Role[]> {
    if (!discordRoles.size) return [];

    const ids      = discordRoles.map(r => r.id);
    let existing   = await em.find(Role, { discordId: { $in: ids } });
    const existingIds = new Set(existing.map(r => r.discordId));

    const toCreate: Role[] = [];
    for (const r of discordRoles.values()) {
      if (existingIds.has(r.id) || r.name === '@everyone' || r.name === this.bot.user?.username) continue;
      toCreate.push(em.create(Role, {
        name:      r.name,
        discordId: r.id
      }));
      await this.logger.debug(`Ajout du rôle: ${r.name}`);
    }

    if (toCreate.length) {
      await em.persist(toCreate).flush();
      existing = await em.find(Role, { discordId: { $in: ids } });
    }

    return existing;
  }

  @SafeMethod
  public async syncChannels(discordChannels: Collection<string, GuildBasedChannel>): Promise<Channel[]> {
    try {
      // fork de l’EM en tête de méthode
      const em = this.orm.em.fork();

      if (discordChannels.size === 0) {
        return [];
      }

      // 1) exclusion…
      const excludeIds = new Set<string>();
      for (const catName of this.bot.excludeCategory) {
        // 1️⃣ On cherche la catégorie par son nom
        const category = this.bot.guild.channels.cache
          .find(ch => ch.type === ChannelType.GuildCategory && ch.name === catName) as CategoryChannel | undefined;

        if (!category) {
          continue;
        }

        category.children.cache.forEach((child: GuildChannel) => {
          excludeIds.add(child.id);
        });
      }

      // 2) SELECT batch avec le EM forké
      const ids        = discordChannels.map(ch => ch.id);
      let existing     = await em.find(Channel, { discordId: { $in: ids } });
      const existingIds = new Set(existing.map(c => c.discordId));

      // 3) prepare toCreate…
      const toCreate: Channel[] = [];
      for (const ch of discordChannels.values()) {
        if (existingIds.has(ch.id)) continue;
        if (ch.isVoiceBased() || ch.isThread() || ch.type === ChannelType.GuildCategory || excludeIds.has(ch.id)) continue;

        toCreate.push(em.create(Channel, {
          name:      ch.name,
          discordId: ch.id,
        }));
        await this.logger.debug(`Ajout du channel: ${ch.name}`);
      }

      // 4) persist + flush uniquement sur le fork
      if (toCreate.length) {
        await em.persist(toCreate).flush();
        existing = await em.find(Channel, { discordId: { $in: ids } });
      }

      return existing;
    } catch (err) {
  await this.logger.error({ msg: '[syncChannels] Erreur lors de la synchronisation des channels:', err });
      if (err instanceof Error && err.stack) {
  await this.logger.error({ msg: '[syncChannels] Stack:', stack: err.stack });
      }
      throw err;
    }
  }
  
  @SafeMethod
  public async syncRanks(): Promise<void> {
  
    const memberDiscord = await this.bot.guild.members.fetch();
    const em = this.getEm();
    const roleMemberId = this.bot.roleMember!.id;
    const ranksDb = await em.find(Rank, {}, { populate: ['roleDiscord'] });


    for (const [id, member] of memberDiscord) {
      if (id === this.bot.user!.id) {
        continue;
      }

      if (!member || !member.roles.cache.has(roleMemberId)) {
        continue;
      }

      for (const rank of ranksDb) {
        if (member.roles.cache.has(rank.roleDiscord?.discordId ?? '')) {
          let memberRh = await em.findOne(RHMember, { user: { discordId: id } }, { populate: ['grade'] });
          if (!memberRh) continue;
          if (memberRh.grade?.id !== rank.id) {
            memberRh.grade = rank;
            memberRh.promotionSend = false;
            await em.persist(memberRh).flush();
            await this.logger.info(`Mise à jour du grade de ${member.displayName} -> ${rank.name}`);
          }
        }
      }
    }

  }

  @SafeMethod
  public async syncRolesRank(): Promise<void> {
    const memberDiscord = await this.bot.guild.members.fetch();
    const em = this.getEm();
    const ranksDb = await em.find(Rank, {}, { populate: ['roleDiscord'] });


    for (const [id, member] of memberDiscord) {
      try {
          // Récupère l'utilisateur Discord
          
          if (!member.roles.cache.has(this.bot.roleMember!.id)) continue;
          
          await this.logger.debug(`Vérification des rôles pour le membre ${member.displayName} (${id})`);
          const rank = await em.findOneOrFail(Rank, { rHMembers: { user: { discordId: id } } });
          let changRole = !member.roles.cache.has(rank.roleDiscord?.discordId ?? '');

          if (!changRole) continue;


          await this.logger.debug(`Mise à jour des rôles pour le membre ${member.displayName} (${id})`);
          for (const rankRole of ranksDb) {
            
            if (member.roles.cache.has(rankRole.roleDiscord?.discordId ?? '') && rankRole.id !== rank.id) {
                  await member.roles.remove(rankRole.roleDiscord?.discordId ?? '', 'Changement de grade RH');
                  changRole = true;
              }
          }

          if (rank.roleDiscord?.discordId) {
              await member.roles.add(rank.roleDiscord.discordId, 'Promotion RH');
          } else {
              throw new Error(`Le grade ${rank.name} n'a pas de rôle Discord associé`);
          }
          
          const embed = {
              title: "✅ Promotion acceptée",
              description: `Félicitations pour ta promotion au grade de **${rank.name}** !`,
              color: 0x00FF00, // vert
              thumbnail: {
                  url: member.user.displayAvatarURL({ size: 256 }), // ou ton URL custom
              },
              fields: [
                  {
                  name: "Membre",
                  value: member.displayName,
                  inline: false,
                  },
                  {
                  name: "Nouveau Grade",
                  value: rank.name,
                  inline: true,
                  },
              ],
              timestamp: new Date().toISOString(),
          };  

          const dmChannel = await member.createDM();
          await dmChannel.send({ embeds: [embed] });
          const memberRh = await em.findOneOrFail(RHMember, { user: { discordId:id } });
          memberRh.lastPromotion = new Date();
          memberRh.promotionSend = false;
          await em.persist(memberRh).flush();
      } catch (err: Error|any) {
          await this.logger.error(`Erreur pour le membre ${member.displayName} (${id}) - ${err.message}`);
      }
    }
    
 }

  public getEm(): EntityManager {
    return this.orm.em.fork();
  }
}