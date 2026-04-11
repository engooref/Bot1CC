import { EntityManager } from '@mikro-orm/core';
import { APIEmbedField, EmbedBuilder } from 'discord.js';
import { RefineryWorkOrder } from '../entities/refinery/RefineryWorkOrder.js';
import { BotManager } from '../BotManager.js';
import { getManagerLogger } from '../logger.js';

export class RefineryManager {
  private static readonly BATCH_WAIT_MS = 5 * 60 * 1000; // 5 min
  private static readonly MAX_OLDEST_WAIT_MS = 10 * 60 * 1000; // 10 min

  private logger = getManagerLogger('RefineryManager');

  constructor(
    private em: EntityManager,
    private bot: BotManager
  ) {}

  async pollAndNotify() {
    try {
      const pendingOrders = await this.em.find(
        RefineryWorkOrder,
        {
          notifyOnComplete: true,
          notified: false,
        },
        {
          populate: ['user', 'refineryPoi', 'lines', 'lines.commodity'],
        }
      );

      if (pendingOrders.length === 0) {
        this.logger.debug('Aucun work order en attente de notification.');
        return;
      }

      this.logger.debug(
        `Analyse de ${pendingOrders.length} work order(s) non notifiés.`
      );

      const now = Date.now();
      const groupedByUser = this.groupOrdersByUser(pendingOrders);

      for (const [discordId, userOrders] of groupedByUser.entries()) {
        try {
          const completedOrders = userOrders
            .filter(order => order.isReady)
            .sort((a, b) => new Date(a.endAt).getTime() - new Date(b.endAt).getTime());

          if (completedOrders.length === 0) {
            this.logger.debug(
              `Aucun work order terminé pour l'utilisateur ${discordId}.`
            );
            continue;
          }

          const shouldWait = this.shouldDelayNotification(userOrders, completedOrders, now);

          if (shouldWait) {
            const oldestCompleted = completedOrders[0];
            this.logger.debug(
              `Notification différée pour ${discordId}: ${completedOrders.length} work order(s) prêt(s), plus ancien terminé=${oldestCompleted.id}, attente de regroupement.`
            );
            continue;
          }

          const discordMember = await this.bot.guild.members.fetch(discordId).catch(error => {
            this.logger.error(
              `Impossible de récupérer le membre Discord ${discordId}.`,
              error
            );
            return null;
          });

          if (!discordMember) {
            this.logger.warn(
              `Membre Discord introuvable pour ${discordId}, notification ignorée.`
            );
            continue;
          }

          const embeds = this.createRefinerySummaryEmbeds(completedOrders);

          const sent = await discordMember.send({ embeds }).then(() => true).catch(error => {
            this.logger.error(
              `Échec de l'envoi du DM de raffinage à ${discordId}.`,
              error
            );
            return false;
          });

          if (!sent) {
            continue;
          }

          for (const order of completedOrders) {
            order.notified = true;
          }

          this.logger.info({
            msg: `Notification envoyée à ${discordId} pour ${completedOrders.length} work order(s): ${completedOrders.map(order => order.id).join(', ')}`
          });
        } catch (error) {
          this.logger.error({
            msg: `Erreur lors du traitement des notifications pour l'utilisateur ${discordId}.`,
            error
          });
        }
      }

      await this.em.flush();
      this.logger.debug('Flush des notifications de raffinage effectué.');
    } catch (error) {
      this.logger.error({
        msg: 'Erreur dans pollAndNotify().',
        error
      });
    }
  }

  private groupOrdersByUser(orders: RefineryWorkOrder[]) {
    const grouped = new Map<string, RefineryWorkOrder[]>();

    for (const order of orders) {
      const discordId = order.user?.discordId;

      if (!discordId) {
        this.logger.warn(
          `Work order ${order.id} ignoré: utilisateur ou discordId manquant.`
        );
        continue;
      }

      if (!grouped.has(discordId)) {
        grouped.set(discordId, []);
      }

      grouped.get(discordId)!.push(order);
    }

    return grouped;
  }

  private shouldDelayNotification(
    userOrders: RefineryWorkOrder[],
    completedOrders: RefineryWorkOrder[],
    now: number
  ): boolean {
    if (completedOrders.length === 0) {
      return false;
    }

    const oldestCompleted = completedOrders[0];
    const oldestCompletedAt = new Date(oldestCompleted.endAt).getTime();

    if (Number.isNaN(oldestCompletedAt)) {
      this.logger.warn({
        msg: `Date de fin invalide pour le work order ${oldestCompleted.id}, envoi immédiat par sécurité.`
      });
      return false;
    }

    const oldestAge = now - oldestCompletedAt;

    if (oldestAge >= RefineryManager.MAX_OLDEST_WAIT_MS) {
      this.logger.debug({
        msg: `Envoi forcé: le work order ${oldestCompleted.id} attend depuis ${Math.floor(oldestAge / 1000)}s.`
      });
      return false;
    }

    const hasUpcomingSoon = this.hasUpcomingOrderWithinWindow(userOrders, now);

    if (hasUpcomingSoon) {
      this.logger.debug({
        msg: `Attente activée: un autre work order termine dans les ${RefineryManager.BATCH_WAIT_MS / 60000} prochaines minutes.`
      });
    }

    return hasUpcomingSoon;
  }

  private hasUpcomingOrderWithinWindow(
    userOrders: RefineryWorkOrder[],
    now: number
  ): boolean {
    const limit = now + RefineryManager.BATCH_WAIT_MS;

    return userOrders.some(order => {
      if (order.isReady || !order.endAt) {
        return false;
      }

      const endAt = new Date(order.endAt).getTime();

      if (Number.isNaN(endAt)) {
        this.logger.warn({
          msg: `Date de fin invalide pour le work order ${order.id}.`
        });
        return false;
      }

      return endAt > now && endAt <= limit;
    });
  }

  private createRefinerySummaryEmbeds(orders: RefineryWorkOrder[]): EmbedBuilder[] {
    const embeds: EmbedBuilder[] = [];
    const fields = orders.map(order => this.buildOrderField(order));

    for (let i = 0; i < fields.length; i += 25) {
      const chunk = fields.slice(i, i + 25);

      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle(i === 0 ? '⛏️ Raffinage terminé' : '⛏️ Suite des work orders terminés')
        .setDescription(
          i === 0
            ? [
                `Bonne nouvelle, **${orders.length} work order(s)** sont maintenant terminés.`,
                '',
                '> Voici le récapitulatif de ta production raffinée.',
              ].join('\n')
            : '> Suite du récapitulatif de tes work orders terminés.'
        )
        .addFields(chunk)
        .setFooter({ text: 'Tes commandes sont prêtes.' })
        .setTimestamp(new Date());

      embeds.push(embed);
    }

    return embeds;
  }

  private buildOrderField(order: RefineryWorkOrder): APIEmbedField {
    let resources = 'Aucune ressource raffinée.';

    if (order.lines && order.lines.length > 0) {
      resources = order.lines
        .map(line => {
          const commodityName =
            line.commodity?.name ||
            line.commodity?.code ||
            'Ressource';

          return `- ${commodityName}: ${line.quantityScuOutput.toFixed(2)} SCU`;
        })
        .join('\n');
    }

    const refineryName = order.refineryPoi?.name || 'Inconnue';

    const endAt = order.endAt
      ? `<t:${Math.floor(new Date(order.endAt).getTime() / 1000)}:F>\n<t:${Math.floor(new Date(order.endAt).getTime() / 1000)}:R>`
      : 'Inconnue';

    const value = [
      `** 🏭 RAFFINERIE**`,
      `${refineryName}`,
      '',
      `**📦 RÉSULTAT**`,
      '```md',
      resources,
      '```',
      '',
      `**⏱️ TERMINÉ**`,
      `${endAt}`,
    ].join('\n');

    return {
      name: `━━━━━━━━━━ Work order #${order.id} ━━━━━━━━━━`,
      value: this.truncate(value, 1024),
      inline: false,
    };
  }

  private truncate(text: string, max: number) {
    if (!text) return 'Aucune';
    return text.length > max ? `${text.slice(0, max - 3)}...` : text;
  }
}