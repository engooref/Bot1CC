import { ButtonInteractionGuard } from '../utils/ButtonInteractionGuard.js';
import { SettingKeys } from '../constants/SettingKeys.js';
import { applyArrivalPrefix } from '../utils/ArrivalPrefix.js';
import { DEFAULT_YOUNG_ACCOUNT_MIN_DAYS, isYoungAccount, shouldRejectYoungAccount } from '../utils/YoungAccount.js';
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
import { Channel as DBChannel } from '../entities/core/Channel.js';
import { User } from '../entities/core/User.js';
import { Event } from '../entities/event/Event.js';
import { Response } from '../entities/event/Response.js';
import { VoicePresence } from '../entities/event/VoicePresence.js';
import { InteractionContext } from '../entities/ui/ViewContext.js';
import { componentHandlerRegistry } from '../registry/ComponentHandlerRegistry.js';
import { settingsService } from '../services/SettingsService.js';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

export function registerDiscordEvents(bot: BotManager): void {
  bot.on(Events.MessageCreate, message => {
    void bot.recrutementManager?.onMessage(message).catch(err => botLogger.error({ op: 'RECRUTEMENT_ACTIVITY', err }));
  });
  bot.on(Events.GuildRoleCreate, (role) => _onGuildRoleCreate(bot, role));
  bot.on(Events.GuildRoleDelete, (role) => _onGuildRoleDelete(bot, role));
  bot.on(Events.GuildRoleUpdate, (oldRole, newRole) => _onGuildRoleUpdate(bot, oldRole, newRole));
  bot.on(Events.ChannelCreate, (channel) => _onGuildChannelCreate(bot, channel));
  bot.on(Events.ChannelDelete, (channel) => _onGuildChannelDelete(bot, channel));
  bot.on(Events.ChannelUpdate, (oldCh, newCh) => _onGuildChannelUpdate(bot, oldCh, newCh));
  bot.on(Events.GuildMemberAdd, (member) => _onGuildMemberAdd(bot, member));
  bot.on(Events.GuildMemberUpdate, (before, after) => _onGuildMemberUpdate(bot, before, after as GuildMember));
  bot.on(Events.GuildMemberRemove, (member) => _onGuildMemberRemove(bot, member));
  bot.on(Events.InteractionCreate, (interaction) => _onInteraction(bot, interaction));
  bot.on(Events.VoiceStateUpdate, (oldState, newState) => _onVoiceStateUpdate(bot, oldState, newState));
  bot.on(Events.MessageReactionAdd, (reaction, user) => _onMessageReactionAdd(bot, reaction, user));
  bot.on(Events.MessageReactionRemove, (reaction, user) => _onMessageReactionRemove(bot, reaction, user));
}

async function _onGuildMemberAdd(bot: BotManager, member: GuildMember): Promise<void> {
  try {
    const now = Date.now();
    const minDays = await settingsService.getInt(
      SettingKeys.bot.recrutement.youngAccountMinDays,
      DEFAULT_YOUNG_ACCOUNT_MIN_DAYS,
    ).catch(() => DEFAULT_YOUNG_ACCOUNT_MIN_DAYS);
    // Liste illisible : on laisse entrer plutôt que d'expulser par erreur.
    let exemptIds: string[] | null = null;
    try {
      exemptIds = await settingsService.getList(SettingKeys.bot.recrutement.youngAccountExemptIds);
    } catch (err) {
      await botLogger.error({ op: "GUILD_MEMBER_ADD", err, user: member.id }, "Liste d'exemption illisible : aucune expulsion");
    }

    if (exemptIds && shouldRejectYoungAccount({
      createdTimestamp: member.user.createdTimestamp,
      at: now,
      minDays,
      isBot: member.user.bot,
      userId: member.user.id,
      exemptIds,
    })) {
      const reason = `Compte trop jeune (moins de ${minDays} jours)`;

      await member.kick(reason);

      // Supprime le message système Discord "Ravi de te voir..."
      const systemChannel = member.guild.systemChannel;

      if (systemChannel) {
        try {
          const messages = await systemChannel.messages.fetch({ limit: 10 });

          const joinMessage = messages.find(
            (message) =>
              message.type === 7 && // GUILD_MEMBER_JOIN
              message.author.id === member.id
          );

          if (joinMessage) {
            await joinMessage.delete();
          }
        } catch (error) {
          await botLogger.error(
            {
              op: "DELETE_JOIN_MESSAGE",
              user: member.id,
            },
            "Impossible de supprimer le message système d'arrivée"
          );
        }
      }

      await botLogger.info(
        {
          op: "GUILD_MEMBER_ADD",
          user: member.id,
          username: member.user.username,
        },
        `Utilisateur expulsé: ${reason}`
      );
    }

    const exempt = !!exemptIds?.includes(member.user.id);
    if (!exempt && !member.user.bot && isYoungAccount(member.user.createdTimestamp, now, minDays)) return;
    if (!member.user.bot) {
      try { await applyArrivalPrefix(member); }
      catch (err) { await botLogger.error({ op: 'ARRIVAL_PREFIX', err, user: member.id }); }
    }
    await bot.recrutementManager?.onMember(member);
  } catch (e) {
    await botLogger.error({ op: "GUILD_MEMBER_ADD", err: e, user: member.id });
  }
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
    await em.nativeDelete(DBChannel, { discordId: channel.id });
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

    const channelEntity = await em.findOne(DBChannel, { discordId: newChannel.id });
    if (!channelEntity) return;

    channelEntity.name = (newChannel as GuildChannel).name;
    await em.persist(channelEntity).flush();
    await botLogger.info({ op: "GUILD_CHANNEL_UPDATE" }, `Modification du canal : ${(oldChannel as GuildChannel).name} -> ${(newChannel as GuildChannel).name}`);
  } catch (e) {
    await botLogger.error({ op: "GUILD_CHANNEL_UPDATE", err: e, oldChannel: oldChannel.id, newChannel: newChannel.id });
  }
}

export async function _onGuildMemberUpdate(
  bot: BotManager,
  before: GuildMember | PartialGuildMember,
  after: GuildMember,
): Promise<void> {
  if (after.guild.id !== bot.guild?.id) return;

  
  const addedRoles = after.roles.cache.filter(role => before.partial || !before.roles.cache.has(role.id));
  const removedRoles = before.partial
    ? new Collection<string, Role>()
    : before.roles.cache.filter(role => !after.roles.cache.has(role.id));
  
  const rolesChanged = addedRoles.size > 0 || removedRoles.size > 0;
  const nameChanged = before.partial || before.displayName !== after.displayName;
  if (before.pending && !after.pending && !after.user.bot) {
    try {
      await bot.recrutementManager?.onMember(after);
    } catch (err) {
      await botLogger.error({ op: 'RECRUTEMENT_ADMISSION', err, user: after.id });
    }
  }
  if (!rolesChanged && !nameChanged) return;

  if (!after.user.bot && addedRoles.size) {
    for (const [setting, operation, handler] of [
      [SettingKeys.bot.roles.postulant, 'RECRUTEMENT_MEMBER_UPDATE', () => bot.recrutementManager?.onMember(after)],
      [SettingKeys.bot.diplomatie.roleAmbassadeur, 'DIPLOMATIE_MEMBER_UPDATE', () => bot.diploManager?.createRequest(after)],
    ] as const) {
      try {
        const roleId = await settingsService.getString(setting);
        if (roleId && addedRoles.has(roleId)) await handler();
      } catch (err) {
        await botLogger.error({ op: operation, err, user: after.id });
      }
    }
  }

  try {
    // Onboarding handlers can themselves update roles/nicknames. Use the current
    // Discord state rather than overwrite the database with the older event snapshot.
    const member = await after.guild.members.fetch({ user: after.id, force: true });
    const em = bot.db.getEm();
    let user: User | null = await em.findOne(User, { discordId: member.id }, { populate: ['rolesDiscord'] });
    const officialRoleId = bot.roleMember?.id;

    if (user && officialRoleId && removedRoles.has(officialRoleId) && !member.roles.cache.has(officialRoleId)) {
      // Preserve historical relations, as in the existing member-leave handler.
      await bot.userManager.deleteUser(user);
      return;
    }

    if (!user) {
      if (!officialRoleId || !member.roles.cache.has(officialRoleId)) return;
      user = em.create(User, { username: member.displayName, discordId: member.id, avatar: member.user.avatar ?? '' });
    }

    const refreshEvents = user.id != null && user.username !== member.displayName;
    if (rolesChanged || user.id == null) {
      const roles = await bot.db.syncRoles(member.roles.cache, em);
      user.rolesDiscord.set(roles);
    }
    user.username = member.displayName;
    user.avatar = member.user.avatar ?? '';
    await em.persist(user).flush();

    if (refreshEvents) {
      const today = new Date();
      const events = await em.find(Event, {
        start: {
          $gte: new Date(today.getFullYear(), today.getMonth(), 1),
          $lt: new Date(today.getFullYear(), today.getMonth() + 1, 1),
        },
        responses: { users: { id: user.id } },
      }, { populate: ['*', 'responses.users'] });

      for (const event of events) {
        try { await bot.eventManager.updateEvent(event); }
        catch (err) { await botLogger.error({ op: 'GUILD_MEMBER_UPDATE_EVENT', err, user: member.id, event: event.id }); }
      }
    }
  } catch (err) {
    await botLogger.error({ op: 'GUILD_MEMBER_UPDATE', err, user: after.id });
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

const buttonInteractionGuard = new ButtonInteractionGuard();

async function _onInteraction(bot: BotManager, interaction: Interaction): Promise<void> {
  let releaseButton: (() => void) | undefined;
  try {
    if (interaction.isButton()) {
      releaseButton = buttonInteractionGuard.acquire(
        `${interaction.message.id}:${interaction.user.id}`,
      );
      if (!releaseButton) {
        await interaction.deferUpdate();
        return;
      }
    }
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
  } finally {
    releaseButton?.();
  }
}

async function _onVoiceStateUpdate(bot: BotManager, oldState: VoiceState, newState: VoiceState): Promise<void> {
  try {
    if (oldState.channelId === newState.channelId) return;

    // =========================================================
    // SYSTÈME "CRÉATEUR DE VOCAL" (indépendant des events)
    // =========================================================
    const CREATE_VOICE_ID = await settingsService.getString(SettingKeys.bot.voice.channelCreation);
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
