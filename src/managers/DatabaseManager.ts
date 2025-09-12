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

import { MikroORM, EntityManager, ChangeSetType, RequestContext } from '@mikro-orm/core';
import logger            from '../logger.js';
import { User }          from '../entities/User.js';
import { Role }          from '../entities/Role.js';
import { Channel  } from '../entities/Channel.js';
import config from '../mikro-orm.config.js';
import BotManager from '../BotManager.js';
import { SafeMethod } from '../exception/Safe.js';
import { runInThisContext } from 'vm';
import PurgeManager from './PurgeManager.js';
import { RHMember } from '../entities/RHMember.js';

export default class DatabaseManager {
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

  /**
   * Handler slash pour la commande /db (privé, owner only, DM only)
   */
  public async handleDatabaseCommand(interaction: any) {
    const ownerId = process.env.ENGOO_ID;
    if (interaction.user.id !== ownerId) {
      await interaction.reply({ content: '⛔ Commande réservée au propriétaire.', ephemeral: true });
      return;
    }
    if (interaction.guild) {
      await interaction.reply({ content: '⛔ Cette commande est disponible uniquement en DM.', ephemeral: true });
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

        await logger.error({ msg: 'Erreur lors de la purge :', err });
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
          await em.persistAndFlush(user);

          // Vérifier ou créer le profil RH
          let rhMember = await em.findOne<RHMember>('RHMember', { user: user.id });
          if (!rhMember) {
            rhMember = em.create<RHMember>('RHMember', {
              user,
              status: 'Actif',
              dateEntree: new Date(),
              pendingApproval: null
            });
          } else if (rhMember.status === 'Candidatures') {
            rhMember.status = 'Actif';
          }
          await em.persistAndFlush(rhMember);
        }

        await interaction.followUp({ content: '✅ Synchronisation des utilisateurs terminée.', ephemeral: true });
      } catch (err) {
        await logger.error({ msg: 'Erreur lors de la synchronisation des utilisateurs :', err });
        await interaction.followUp({ content: '❌ Une erreur est survenue lors de la synchronisation des utilisateurs.', ephemeral: true });
      }
    } else if (sub === "sync_events") {
      try {
        await this.bot.schedMgr.appEvent.sendEventsWeek();
        await interaction.followUp({ content: '✅ Synchronisation des événements terminée.', ephemeral: true });
      } catch (err) {
  await logger.error({ msg: 'Erreur lors de la synchronisation des événements :', err });
        await interaction.followUp({ content: '❌ Une erreur est survenue lors de la synchronisation des événements.', ephemeral: true });
      }
    }
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
    await logger.debug('✅ MikroORM connecté');
    
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
      
      await em.persistAndFlush(user);
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
      await logger.debug(`Ajout du rôle: ${r.name}`);
    }

    if (toCreate.length) {
      await em.persistAndFlush(toCreate);
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
        await logger.debug(`Ajout du channel: ${ch.name}`);
      }

      // 4) persist + flush uniquement sur le fork
      if (toCreate.length) {
        await em.persistAndFlush(toCreate);
        existing = await em.find(Channel, { discordId: { $in: ids } });
      }

      return existing;
    } catch (err) {
  await logger.error({ msg: '[syncChannels] Erreur lors de la synchronisation des channels:', err });
      if (err instanceof Error && err.stack) {
  await logger.error({ msg: '[syncChannels] Stack:', stack: err.stack });
      }
      throw err;
    }
  }
  
  public getEm(): EntityManager {
    return this.orm.em.fork();
  }
}
