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

export default class DatabaseManager {
  public orm!: MikroORM;
  private excludeCategories: string[];
  private bot : BotManager;

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
    logger.info('✅ MikroORM connecté');
    
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
          expPourcentage: 0,
          expLevel:       0,
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
        discordId: r.id,
        isGrade:   r.hoist,
      }));
      logger.info(`Ajout du rôle: ${r.name}`);
    }

    if (toCreate.length) {
      await em.persistAndFlush(toCreate);
      existing = await em.find(Role, { discordId: { $in: ids } });
    }

    return existing;
  }

  @SafeMethod
  public async syncChannels(discordChannels: Collection<string, GuildBasedChannel>): Promise<Channel[]> {
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
      logger.info(`Ajout du channel: ${ch.name}`);
    }

    // 4) persist + flush uniquement sur le fork
    if (toCreate.length) {
      await em.persistAndFlush(toCreate);
      existing = await em.find(Channel, { discordId: { $in: ids } });
    }

    return existing;
  }
  
  public getEm(): EntityManager {
    return this.orm.em.fork();
  }
}
