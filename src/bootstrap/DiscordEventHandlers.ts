import {
  Role,
  GuildChannel,
  DMChannel,
  GuildBasedChannel,
  GuildMember,
  PartialGuildMember,
  Interaction,
  VoiceState,
  Message,
  TextChannel,
  ThreadChannel,
  Collection,
  ChannelType,
  VoiceChannel,
  PermissionFlagsBits,
  Events,
  MessageReaction,
  PartialMessageReaction,
  User as DiscordUser,
  PartialUser,
} from 'discord.js';
import { BotManager } from '../BotManager.js';
import { botLogger } from '../logger.js';
import { Role as DBRole } from '../entities/core/Role.js';
import { Channel } from '../entities/core/Channel.js';
import { User } from '../entities/core/User.js';
import { Event } from '../entities/event/Event.js';
import { Response } from '../entities/event/Response.js';
import { VoicePresence } from '../entities/event/VoicePresence.js';
import { InteractionContext } from '../entities/ui/ViewContext.js';
import { componentHandlerRegistry } from '../registry/ComponentHandlerRegistry.js';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export function registerDiscordEvents(bot: BotManager): void {
  bot.on('roleCreate', (role) => _onGuildRoleCreate(bot, role));
  bot.on('roleDelete', (role) => _onGuildRoleDelete(bot, role));
  bot.on('roleUpdate', (oldRole, newRole) => _onGuildRoleUpdate(bot, oldRole, newRole));
  bot.on('channelCreate', (channel) => _onGuildChannelCreate(bot, channel));
  bot.on('channelDelete', (channel) => _onGuildChannelDelete(bot, channel));
  bot.on('channelUpdate', (oldCh, newCh) => _onGuildChannelUpdate(bot, oldCh, newCh));
  bot.on('guildMemberUpdate', (before, after) => _onGuildMemberUpdate(bot, before, after as GuildMember));
  bot.on('guildMemberRemove', (member) => _onGuildMemberRemove(bot, member));
  bot.on(Events.InteractionCreate, (interaction) => _onInteraction(bot, interaction));
  bot.on('voiceStateUpdate', (oldState, newState) => _onVoiceStateUpdate(bot, oldState, newState));
  bot.on('messageCreate', (message) => _onMessageCreate(bot, message));
  bot.on('messageReactionAdd', (reaction, user) => _onMessageReactionAdd(bot, reaction, user));
  bot.on('messageReactionRemove', (reaction, user) => _onMessageReactionRemove(bot, reaction, user));
}

async function _onGuildRoleCreate(bot: BotManager, role: Role): Promise<void> {
  try {
    await botLogger.info({ op: "GUILD_ROLE_CREATE" }, `Création du rôle : ${role.name}`);
    const singleRoleCollection = new Collection<string, Role>();
    singleRoleCollection.set(role.id, role);
    bot.db.syncRoles(singleRoleCollection);
  } catch (e) {
    await botLogger.error({ op: "GUILD_ROLE_CREATE", err: e, role: role.id });
  }
}

async function _onGuildRoleDelete(bot: BotManager, role: Role): Promise<void> {
  try {
    const em = bot.db.getEm();
    await botLogger.info({ op: "GUILD_ROLE_DELETE" }, `Suppression du rôle : ${role.name}`);
    await em.nativeDelete(DBRole, { discordId: role.id });
  } catch (e) {
    await botLogger.error({ op: "GUILD_ROLE_DELETE", err: e, role: role.id });
  }
}

async function _onGuildRoleUpdate(bot: BotManager, oldRole: Role, newRoleObj: Role): Promise<void> {
  try {
    const em = bot.db.getEm();
    const roleEntity = await em.findOne(DBRole, { discordId: newRoleObj.id });

    if (!roleEntity) return;

    roleEntity.name = newRoleObj.name;
    await em.persist(roleEntity).flush();

    await botLogger.info({ op: "GUILD_ROLE_UPDATE" }, `Modification du rôle ${newRoleObj.id} : ${oldRole.name} -> ${newRoleObj.name}`);
  } catch (e) {
    await botLogger.error({ op: "GUILD_ROLE_UPDATE", err: e, oldRole: oldRole.id, newRole: newRoleObj.id });
  }
}

async function _onGuildChannelCreate(bot: BotManager, channel: GuildChannel): Promise<void> {
  try {
    const singleChannelCollection = new Collection<string, GuildBasedChannel>();
    singleChannelCollection.set(channel.id, channel as GuildBasedChannel);
    bot.db.syncChannels(singleChannelCollection);
  } catch (e) {
    await botLogger.error({ op: "GUILD_CHANNEL_CREATE", err: e, channel: channel.id });
  }
}

async function _onGuildChannelDelete(bot: BotManager, channel: DMChannel | GuildChannel): Promise<void> {
  try {
    if (channel as DMChannel) return;
    const em = bot.db.getEm();
    await em.nativeDelete(Channel, { discordId: channel.id });
    await botLogger.info({ op: "GUILD_CHANNEL_DELETE" }, `Suppression du canal : ${(channel as GuildChannel).name}`);
  } catch (e) {
    await botLogger.error({ op: "GUILD_CHANNEL_DELETE", err: e, channel: channel.id });
  }
}

async function _onGuildChannelUpdate(
  bot: BotManager,
  oldChannel: DMChannel | GuildChannel,
  newChannel: DMChannel | GuildChannel
): Promise<void> {
  try {
    const em = bot.db.getEm();
    if (newChannel as DMChannel) return;
    if ((oldChannel as GuildChannel).name === (newChannel as GuildChannel).name) return;

    const channelEntity = await em.findOne(Channel, { discordId: newChannel.id });
    if (!channelEntity) return;

    channelEntity.name = (newChannel as GuildChannel).name;
    await em.persist(channelEntity).flush();
    await botLogger.info({ op: "GUILD_CHANNEL_UPDATE" }, `Modification du canal : ${(oldChannel as GuildChannel).name} -> ${(newChannel as GuildChannel).name}`);
  } catch (e) {
    await botLogger.error({ op: "GUILD_CHANNEL_UPDATE", err: e, oldChannel: oldChannel.id, newChannel: newChannel.id });
  }
}

async function _onGuildMemberUpdate(
  bot: BotManager,
  before: GuildMember | PartialGuildMember,
  after: GuildMember,
): Promise<void> {
  try {
    const em = bot.db.getEm();
    let user: User | null = await em.findOne(
      User,
      { discordId: after.id },
      { populate: ['*'] }
    );

    const newRoles = after.roles.cache.filter(r => !before.roles.cache.has(r.id));
    const removedRoles = before.roles.cache.filter(r => !after.roles.cache.has(r.id));

    if (!user) {
      if (!newRoles.has(bot.roleMember!.id)) {
        return;
      }
      user = await bot.db.insertAndGetUser(after);
    }

    if (newRoles.size || removedRoles.size) {
      if (removedRoles.has(bot.roleMember!.id)) {
        await em.removeAndFlush(user);
        return;
      }

      await bot.db.syncRoles(newRoles);

      let changeGrade = false;

      for (const r of newRoles.values()) {
        const dbRole = await em.findOne(DBRole, { discordId: r.id }, { populate: ['rank'] });
        if (dbRole && !user.rolesDiscord.contains(dbRole)) {
          changeGrade = changeGrade || (dbRole.rank !== null);
          user.rolesDiscord.add(dbRole);
        }
      }

      for (const r of removedRoles.values()) {
        const dbRole = await em.findOne(DBRole, { discordId: r.id });
        if (dbRole && user.rolesDiscord.contains(dbRole)) {
          changeGrade = changeGrade || (dbRole.rank !== null);
          user.rolesDiscord.remove(dbRole);
        }
      }

      await botLogger.info({ op: "GUILD_MEMBER_UPDATE" }, `Modification des rôles de ${user.username}`);
      await em.persist(user).flush();

      if (newRoles.has(bot.roleMember!.id) || changeGrade) {
        try {
          await bot.userManager.initMemberRh(user.discordId, !changeGrade);
        } catch (err) {
          await botLogger.error({ op: "GUILD_MEMBER_UPDATE", err, user: user.username });
          throw err;
        }
      }
    }

    if (before.displayName !== after.displayName) {
      user.username = after.displayName;
      await em.persist(user).flush();

      const today = new Date();
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

      const events = await em.find(Event, {
        start: {
          $gte: startOfMonth,
          $lte: endOfMonth,
        },
      }, {
        populate: ['*', 'responses.users'],
      });

      for (const event of events) {
        const resp = await em.findOne(Response, { users: user.id, event: event.id });
        if (resp) {
          await bot.eventManager.updateEvent(event);
        }
      }
    }
  } catch (e) {
    await botLogger.error({ op: "GUILD_MEMBER_UPDATE", err: e });
  }
}

async function _onGuildMemberRemove(bot: BotManager, member: GuildMember | PartialGuildMember): Promise<void> {
  try {
    const user = await bot.userManager.em.findOne(User, { discordId: member.id }, { populate: false });
    if (!user) return;
    await bot.userManager.deleteUser(user);
  } catch (e) {
    await botLogger.error({ op: "GUILD_MEMBER_REMOVE", err: e });
  }
}

async function _onInteraction(bot: BotManager, interaction: Interaction): Promise<void> {
  try {
    if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
      const { customId, message } = interaction;

      const ctx = await bot.db.getEm().findOne(InteractionContext, { customId, messageId: message?.id });
      if (!ctx) {
        await botLogger.debug({ op: "INTERACTION", customId, messageId: message?.id }, `Composant non trouvé -> customId: ${customId}  message: ${message}`);
        return;
      }
      const handler = componentHandlerRegistry.get(ctx.handlerKey);
      if (handler) await handler(interaction, ctx.data);
    } else if (interaction.isChatInputCommand()) {
      bot.slashCommandManager.handleInteraction(interaction);
    }
  } catch (e) {
    await botLogger.error({ op: "INTERACTION", err: e });
  }
}

async function _onVoiceStateUpdate(bot: BotManager, oldState: VoiceState, newState: VoiceState): Promise<void> {
  try {
    if (oldState.channelId === newState.channelId) return;

    // =========================================================
    // SYSTÈME "CRÉATEUR DE VOCAL" (indépendant des events)
    // =========================================================
    const CREATE_VOICE_ID = process.env.VOICE_CREATE_CHANNEL_ID ?? null;
    const FORCE_CATEGORY_ID = process.env.VOICE_CREATE_CATEGORY_ID ?? null;

    const isAutoVoice = (ch: VoiceChannel | null) =>
      ch?.type === ChannelType.GuildVoice && /^Salon vocal\s+\d+$/i.test(ch.name);

    const createAutoVoice = async (state: VoiceState) => {
      if (!CREATE_VOICE_ID) return;
      if (state.channelId !== CREATE_VOICE_ID) return;

      const creator = state.member;
      if (!creator) return;

      const creatorChannel = state.channel as VoiceChannel | null;
      if (!creatorChannel || creatorChannel.type !== ChannelType.GuildVoice) return;

      const parentId = FORCE_CATEGORY_ID ?? creatorChannel.parentId;
      if (!parentId) return;

      const used = new Set<number>();
      bot.guild.channels.cache.forEach((ch) => {
        if (ch.type !== ChannelType.GuildVoice) return;
        if (ch.parentId !== parentId) return;
        const m = ch.name.match(/^Salon vocal\s+(\d+)$/i);
        if (!m) return;
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > 0) used.add(n);
      });

      let idx = 1;
      while (used.has(idx)) idx += 1;

      const channelName = `Salon vocal ${idx}`;
      const botId = bot.user!.id;

      const created = await bot.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: parentId,
        reason: `Auto-create voice for ${creator.user.tag}`,
        permissionOverwrites: [
          {
            id: botId,
            allow: [
              PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.ManageRoles, PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak, PermissionFlagsBits.Stream,
              PermissionFlagsBits.UseVAD, PermissionFlagsBits.MoveMembers,
              PermissionFlagsBits.MuteMembers, PermissionFlagsBits.DeafenMembers,
              PermissionFlagsBits.PrioritySpeaker,
            ],
          },
          {
            id: creator.id,
            allow: [
              PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.Connect, PermissionFlagsBits.Speak,
              PermissionFlagsBits.Stream, PermissionFlagsBits.UseVAD,
              PermissionFlagsBits.MoveMembers, PermissionFlagsBits.MuteMembers,
              PermissionFlagsBits.DeafenMembers, PermissionFlagsBits.PrioritySpeaker,
            ],
          },
        ],
      });

      const siblingsCount = bot.guild.channels.cache.filter(
        (ch): ch is VoiceChannel =>
          ch.type === ChannelType.GuildVoice && ch.parentId === parentId
      ).size;

      await created.setPosition(siblingsCount);
      await state.setChannel(created.id);

      await botLogger.info(
        { op: "VOICE_AUTOCREATE", user: creator.id, channel: created.id, parentId },
        `Création du vocal: ${channelName}`
      );
    };

    if (CREATE_VOICE_ID && newState.channelId === CREATE_VOICE_ID) {
      await createAutoVoice(newState);
      return;
    }

    // =========================================================
    // SYSTÈME EVENT / ÉQUIPES
    // =========================================================
    const em = bot.eventManager.em;
    const userId = newState.id;

    const effectiveChannel = newState.channel ?? oldState.channel;
    if (!effectiveChannel) {
      await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] both newState.channel and oldState.channel are null`);
      return;
    }

    const getEventByParentId = async (parentId: string | null) => {
      if (!parentId) return null;
      return await em.findOne(Event, { discord: { vocalParentId: parentId } });
    };

    const getOrCreatePresence = async (event: Event, user: User) => {
      let presence = (await em.findOne(VoicePresence, { event, user })) as InstanceType<typeof VoicePresence> | null;
      if (!presence) {
        presence = em.create(VoicePresence, { event, user, xp: 0, present: true, promote: false });
        em.persist(presence);
      }
      return presence;
    };

    const moveToTeamChannel = async (parentId: string, teamName: string, userState: VoiceState, eventId: number): Promise<void> => {
      const channelName = `Équipe ${teamName}`;
      let teamChannel = bot.guild.channels.cache.find(
        (ch) => ch.type === ChannelType.GuildVoice && ch.parentId === parentId && ch.name === channelName
      );
      if (!teamChannel) {
        teamChannel = await bot.guild.channels.create({
          name: channelName,
          type: ChannelType.GuildVoice,
          parent: parentId,
          reason: `Création vocal équipe pour event ${eventId}`,
        });
      }
      await userState.setChannel((teamChannel as VoiceChannel).id);
    };

    const moveToNoTeamChannel = async (parentId: string, userState: VoiceState, eventId: number): Promise<void> => {
      const prefix = "Aucune équipe";
      const occupied = new Set<number>();
      bot.guild.channels.cache.forEach((ch) => {
        if (ch.type === ChannelType.GuildVoice && ch.parentId === parentId && ch.name.startsWith(prefix)) {
          const m = ch.name.match(/^Aucune équipe(?:\s*(\d+))?$/i);
          if (m) {
            const idx = m[1] ? parseInt(m[1], 10) : 1;
            if (!Number.isNaN(idx) && idx > 0) occupied.add(idx);
          }
        }
      });

      let idx = 1;
      while (occupied.has(idx)) idx += 1;
      const channelName = `${prefix} ${idx}`;

      const noTeamChannel = await bot.guild.channels.create({
        name: channelName,
        type: ChannelType.GuildVoice,
        parent: parentId,
        reason: `Création vocal "${channelName}" pour event ${eventId}`,
      });

      await userState.setChannel(noTeamChannel.id);
    };

    const deleteEmptyTeamChannel = async (channel: GuildChannel): Promise<void> => {
      try {
        const parent = channel.parent;
        await channel.delete(`Suppression auto : channel d'équipe vide`);

        if (parent?.children.cache.size === 0) {
          await parent.delete(`Suppression auto : catégorie d'event vide`);
        }
      } catch (e) {
        await botLogger.error({ op: "VOICE_STATE_UPDATE", err: e });
      }
    };

    await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] channel.name=${effectiveChannel.name} channel.parentId=${effectiveChannel.parentId}`);
    let event = await getEventByParentId(effectiveChannel.parentId);
    if (!event && oldState.channel?.parentId) {
      await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] event not found with effectiveChannel, trying oldState.channel.parentId=${oldState.channel.parentId}`);
      event = await getEventByParentId(oldState.channel.parentId);
    }
    if (!event) {
      await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] No event found for parentId`);
    } else {
      await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] Event found: id=${event.id} name=${event.name}`);

      const user = await em.findOne(User, { discordId: userId });
      if (!user) {
        await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] User not found: discordId=${userId}`);
      } else {
        await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] User found: username=${user.username}`);

        const resp = await em.findOne(
          Response,
          { event, users: user, typeRep: { $in: ["accepted"] } },
          { populate: ["team"] }
        );
        if (!resp) {
          await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] No response found for user in event`);
        } else {
          await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] Response found: team=${resp.team?.name}`);

          const TECHNICAL_NAMES = new Set<string>(["Créer un vocal d'équipe", "Briefing", "Débriefing"]);

          const allTeamChannels: string[] = effectiveChannel.guild.channels.cache
            .filter(
              (ch) =>
                ch.type === ChannelType.GuildVoice &&
                ch.parentId === event.discord.vocalParentId &&
                !TECHNICAL_NAMES.has(ch.name)
            )
            .map((ch) => ch.id);

          await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] allTeamChannels=${JSON.stringify(allTeamChannels)}`);

          const isInTeamChannel = !!(newState.channelId && allTeamChannels.includes(newState.channelId));
          await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] isInTeamChannel=${isInTeamChannel}`);

          if (isInTeamChannel) {
            await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] User is in a team channel, upserting presence`);
            const presence = await getOrCreatePresence(event, user);
            await em.persist(presence).flush();
          }

          if (newState.channel?.name === "Créer un vocal d'équipe") {
            await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] User entered event category, moving to team/no-team channel`);
            if (resp.team) {
              await moveToTeamChannel(event.discord.vocalParentId!, resp.team.name, newState, event.id);
            } else {
              await moveToNoTeamChannel(event.discord.vocalParentId!, newState, event.id);
            }
          }

          if (
            oldState.channel &&
            oldState.channel.type === ChannelType.GuildVoice &&
            oldState.channel.parentId === event.discord.vocalParentId &&
            oldState.channel.members instanceof Collection &&
            oldState.channel.members.size === 0 &&
            oldState.channel.name !== "Créer un vocal d'équipe"
          ) {
            await botLogger.debug({ op: "VOICE_STATE_UPDATE" }, `[VoiceStateUpdate] Deleting empty team channel: ${oldState.channel.name}`);
            await deleteEmptyTeamChannel(oldState.channel as unknown as GuildChannel);
          }
        }
      }
    }

    // CLEANUP GLOBAL : supprimer un "Salon vocal X" si vide
    if (
      oldState.channel &&
      isAutoVoice(oldState.channel as VoiceChannel) &&
      oldState.channel.members instanceof Collection &&
      oldState.channel.members.size === 0
    ) {
      await botLogger.info(
        { op: "VOICE_AUTODELETE", channel: oldState.channel.id, name: oldState.channel.name },
        "Suppression auto : vocal temporaire vide"
      );
      await oldState.channel.delete("Auto-delete: salon vocal temporaire vide").catch(() => {});
    }
  } catch (err) {
    await botLogger.error({ op: "VOICE_STATE_UPDATE", err });
  }
}

async function _onMessageCreate(bot: BotManager, message: Message): Promise<void> {
  try {
    const targetUserId = '216305802296688640';

    if (message.author.bot || message.webhookId) return;
    if (message.guildId !== bot.guildId) return;
    if (message.author.id === targetUserId) return;

    const inAmbassadeCategory = (() => {
      const ch = message.channel as GuildBasedChannel;
      const AMBASSADES_CATEGORY_ID = process.env.AMBASSADES_CATEGORY_ID ?? null;

      if ((ch as ThreadChannel).isThread?.()) {
        const parent = (ch as ThreadChannel).parent;
        const categoryId = (parent as any)?.parentId ?? null;
        if (!categoryId) return false;

        if (AMBASSADES_CATEGORY_ID) {
          return categoryId === AMBASSADES_CATEGORY_ID;
        }
        const cat = message.guild?.channels.cache.get(categoryId);
        return (cat as any)?.name === 'Ambassades';
      }

      const categoryId = (ch as TextChannel).parentId ?? null;
      if (!categoryId) return false;

      if (AMBASSADES_CATEGORY_ID) {
        return categoryId === AMBASSADES_CATEGORY_ID;
      }
      const cat = message.guild?.channels.cache.get(categoryId);
      return (cat as any)?.name === 'Ambassades';
    })();

    if (!inAmbassadeCategory) return;

    const dir = path.resolve('config');
    const filePath = path.join(dir, 'time_amb.txt');
    await fsp.mkdir(dir, { recursive: true });

    let lastTs: number | null = null;
    try {
      const raw = await fsp.readFile(filePath, 'utf8');
      const parsed = Number(raw.trim());
      if (Number.isFinite(parsed)) lastTs = parsed;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        await botLogger.error({ op: "MESSAGE_CREATE", err });
      }
    }

    const now = Date.now();
    const DAY_MS = 24 * 60 * 60 * 1000;
    if (lastTs !== null && now - lastTs < DAY_MS) {
      await botLogger.debug({ op: "MESSAGE_CREATE" }, `Timestamp récent (${Math.floor((now - lastTs) / 1000)}s), sortie.`);
      return;
    }

    await fsp.writeFile(filePath, String(now), 'utf8');
    await botLogger.debug({ op: "MESSAGE_CREATE" }, `Timestamp mis à jour dans ${filePath}`);

    const user = await message.client.users.fetch(targetUserId);

    const diplomaticMessages = [
      "🛸 **Nouvelle Transmission Diplomatique**\nUn message est arrivé à l'ambassade.\nNiveau d'importance : impossible à déterminer.\nNiveau de connerie : probablement élevé.",
      "📡 **ALERTE AMBASSADE**\nUn diplomate vient de parler.\nNous espérons que ce n'est pas encore une demande d'alliance en échange de *5 caisses de Laranite*.",
      "🚨 **PROTOCOLE DE PAIX… OU PAS**\nNouveau message reçu.\nMerci de lire avant de sortir les A2 et les bombes.",
      "🧠 **Communication Inter-Corpo**\nQuelqu'un a écrit un message.\nOn dirait une alliance, mais on a aussi repéré des insultes subtilement cachées.",
      "🛰️ **Transmission diplomatique**\nMessage reçu.\nSi ça parle encore d'organiser un event \"Course de Mule dans Lorville\"… On refuse.",
      "🛠️ **ATTENTION, TENTATIVE DE RÉUNION SÉRIEUSE**\nNouveau message à l'ambassade.\nMerci de faire semblant d'être *professionnels* pendant au moins 12 secondes.",
      "📦 **MESSAGE PRIORITAIRE**\nContenu supposé :\n- Alliance\n- Demande de taxe sur un outpost\n- Invitation à un \"Event surprise\" (80% de chance que ça finisse en explosion)",
      "🧊 **Dépêche Diplomatique**\nMessage reçu.\nSi ça parle encore de bloquer Orison avec des Hull-C, on ne répond pas.",
      "🚀 **TRANSMISSION RSI**\nUn message est arrivé.\nScan du contenu : ✅ mots ✅ emojis ❓ bon sens",
      "🍺 **Invitation Potentielle**\nNouveau message à l'ambassade.\nÇa pourrait être un event diplomatique autour d'un bar sur un 890 Jump.\nOu juste un mec ivre qui veut montrer son Aurora.",
      "🦾 **Contact Inter-Corporation**\nNouveau message reçu.\nRappel : Ne promettez PAS de \"soutien militaire total\" avant d'avoir lu tout le message.",
      "🪐 **MESSAGE CLASSÉ — TOP IMPORTANT**\nOn dirait une alliance.\nOu un spam.\nOn n'est plus sûrs.",
      "🛑 **ERREUR DE COMMUNICATION**\nNouveau message.\nProbabilité que ce soit dans le mauvais canal : **87%**.",
      "🔥 **PROTOCOLE D'URGENCE**\nNouveau message d'ambassade reçu.\nTenez prêt un diplomate… et un Fire Extinguisher, on sait jamais.",
      "💀 **ALERTE DRAMA**\nUn message vient d'arriver.\nUn seul mot dedans : \"On doit parler.\"\nÇa sent pas bon.",
      "🧨 **INFO ÉVÉNEMENT**\nOn dirait une proposition de rencontre pacifique.\nOn dirait aussi un piège.\nTu vas le découvrir.",
      "🌌 **RÉCEPTION DE MESSAGE**\nLe serveur t'informe que tu dois aller lire.\nNous, on s'en fout, mais le serveur insiste.",
      "🎯 **Communication d4une corpo**\nNouveau message dans l'ambassade.\nSi tu réponds avec *un gif d'explosion*, c'est encore un refus.",
      "📑 **NOTE DIPLOMATIQUE**\nQuelqu'un t'a écrit.\nEt non, tu ne peux pas répondre \"ratio\".",
      "🎁 **SURPRISE !**\nUn message est arrivé.\nContenu estimé : 90% diplomatie + 10% bêtise = 100% divertissant."
    ];

    const msg = diplomaticMessages[Math.floor(Math.random() * diplomaticMessages.length)];
    await user.send(msg + '\n' + `>>> ${message.url}`);

  } catch (err) {
    await botLogger.error({ op: "MESSAGE_CREATE", err });
  }
}

async function _onMessageReactionAdd(
  bot: BotManager,
  reaction: MessageReaction | PartialMessageReaction,
  user: DiscordUser | PartialUser
): Promise<void> {
  try {
    await botLogger.debug({ op: "MESSAGE_REACTION_ADD", messageId: reaction.message?.id, userId: user.id }, "Réaction ajoutée");
    await bot.reactionManager.handleReactionAdd(reaction, user);
  } catch (err) {
    await botLogger.error({ op: "MESSAGE_REACTION_ADD", err });
  }
}

async function _onMessageReactionRemove(
  bot: BotManager,
  reaction: MessageReaction | PartialMessageReaction,
  user: DiscordUser | PartialUser
): Promise<void> {
  try {
    await bot.reactionManager.handleReactionRemove(reaction, user);
  } catch (err) {
    await botLogger.error({ op: "MESSAGE_REACTION_REMOVE", err });
  }
}
