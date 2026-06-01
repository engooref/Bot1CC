import {
  MessageReaction,
  User as DiscordUser,
  PartialMessageReaction,
  PartialUser,
} from 'discord.js';
import { BotManager } from '../BotManager.js';
import { getManagerLogger } from '../logger.js';
import { TempLink } from '../entities/operations/TempLink.js';
import { User } from '../entities/core/User.js';

const logger = getManagerLogger('ReactionManager');

export class ReactionManager {
  constructor(private bot: BotManager) {}

  async handleReactionAdd(
    reaction: MessageReaction | PartialMessageReaction,
    user: DiscordUser | PartialUser
  ): Promise<void> {
    try {
      // Ignore bot reactions
      if (user.bot) return;

      // Fetch full reaction if partial
      if (reaction.partial) {
        try {
          reaction.fetch().catch(() => {
            throw new Error('Failed to fetch partial reaction');
          });
        } catch (err) {
          await logger.debug(
            { op: 'REACTION_ADD', err },
            'Impossible de récupérer la réaction partielle'
          );
          return;
        }
      }

      const messageId = reaction.message.id;
      const userId = user.id;

      const em = this.bot.db.getEm();

      // Find TempLink by operationId (which is the messageId)
      const tempLink = await em.findOne(TempLink, { operationId: messageId }, { populate: ['users'] });
      if (!tempLink) {
        await logger.debug(
          { op: 'REACTION_ADD', messageId, userId },
          `TempLink not found for operationId: ${messageId}`
        );
        return;
      }

      // Find Discord user in database
      const dbUser = await em.findOne(User, { discordId: userId });
      if (!dbUser) {
        await logger.debug(
          { op: 'REACTION_ADD', messageId, userId },
          `User not found in database: ${userId}`
        );
        return;
      }

      // Add user to TempLink if not already present
      if (!tempLink.users.contains(dbUser)) {
        tempLink.users.add(dbUser);
        await em.persist(tempLink).flush();

        await logger.info(
          { op: 'REACTION_ADD', messageId, userId, tempLinkId: tempLink.id },
          `User ${dbUser.username} added to TempLink`
        );
      }
    } catch (err) {
      await logger.error({
        op: 'REACTION_ADD',
        err,
        reactionId: reaction.message?.id,
        userId: user.id,
      });
    }
  }

  async handleReactionRemove(
    reaction: MessageReaction | PartialMessageReaction,
    user: DiscordUser | PartialUser
  ): Promise<void> {
    try {
      // Ignore bot reactions
      if (user.bot) return;

      // Fetch full reaction if partial
      if (reaction.partial) {
        try {
          reaction.fetch().catch(() => {
            throw new Error('Failed to fetch partial reaction');
          });
        } catch (err) {
          await logger.debug(
            { op: 'REACTION_REMOVE', err },
            'Impossible de récupérer la réaction partielle'
          );
          return;
        }
      }

      const messageId = reaction.message.id;
      const userId = user.id;

      const em = this.bot.db.getEm();

      // Find TempLink by operationId (which is the messageId)
      const tempLink = await em.findOne(TempLink, { operationId: messageId }, { populate: ['users'] });
      if (!tempLink) {
        await logger.debug(
          { op: 'REACTION_REMOVE', messageId, userId },
          `TempLink not found for operationId: ${messageId}`
        );
        return;
      }

      // Find Discord user in database
      const dbUser = await em.findOne(User, { discordId: userId });
      if (!dbUser) {
        await logger.debug(
          { op: 'REACTION_REMOVE', messageId, userId },
          `User not found in database: ${userId}`
        );
        return;
      }

      // Remove user from TempLink if present
      if (tempLink.users.contains(dbUser)) {
        tempLink.users.remove(dbUser);
        await em.persist(tempLink).flush();

        await logger.info(
          { op: 'REACTION_REMOVE', messageId, userId, tempLinkId: tempLink.id },
          `User ${dbUser.username} removed from TempLink`
        );
      }
    } catch (err) {
      await logger.error({
        op: 'REACTION_REMOVE',
        err,
        reactionId: reaction.message?.id,
        userId: user.id,
      });
    }
  }
}
