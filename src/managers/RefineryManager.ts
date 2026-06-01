import { EntityManager } from '@mikro-orm/core';
import { APIEmbedField, EmbedBuilder } from 'discord.js';
import { RefineryWorkOrder } from '../entities/refinery/RefineryWorkOrder.js';
import { BotManager } from '../BotManager.js';
import { getManagerLogger } from '../logger.js';

export class RefineryManager {
  private logger = getManagerLogger('RefineryManager');

  constructor(
    private em: EntityManager,
    private bot: BotManager
  ) {}

  async notifyUser(userId: string, workOrderIds: number[]): Promise<void> {
    if (!userId || workOrderIds.length === 0) {
      this.logger.warn('notifyUser: userId ou workOrderIds manquants.');
      return;
    }

    const orders = await this.em.find(
      RefineryWorkOrder,
      {
        id: { $in: workOrderIds },
        user: { discordId: userId },
      },
      {
        populate: ['user', 'refineryPoi', 'lines', 'lines.commodity'],
      }
    );

    if (orders.length === 0) {
      this.logger.debug(`Aucun work order à notifier pour ${userId}.`);
      return;
    }

    const discordMember = await this.bot.guild.members.fetch(userId).catch(error => {
      this.logger.error(`Impossible de récupérer le membre Discord ${userId}.`, error);
      return null;
    });

    if (!discordMember) {
      this.logger.warn(`Membre Discord introuvable pour ${userId}, notification ignorée.`);
      return;
    }

    const embeds = this.createRefinerySummaryEmbeds(orders);

    const sent = await discordMember.send({ embeds }).then(() => true).catch(error => {
      this.logger.error(`Échec de l'envoi du DM de raffinage à ${userId}.`, error);
      return false;
    });

    if (!sent) {
      return;
    }

    for (const order of orders) {
      order.notified = true;
    }

    await this.em.flush();

    this.logger.info({
      msg: `Notification envoyée à ${userId} pour ${orders.length} work order(s): ${orders.map(o => o.id).join(', ')}`
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

      let endAtStr = 'Inconnue';
      const endAtDate = order.endAt instanceof Date && !isNaN(order.endAt.getTime()) ? order.endAt : null;
      if (endAtDate) {
        const ts = Math.floor(endAtDate.getTime() / 1000);
        endAtStr = `<t:${ts}:F>\n<t:${ts}:R>`;
      }

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
        `${endAtStr}`,
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