import { SettingKeys } from '../constants/SettingKeys.js';
import { settingsService } from '../services/SettingsService.js';
import { ButtonInteraction, TextChannel, EmbedBuilder, MessageFlags } from 'discord.js';
import { BotManager } from '../BotManager.js';
import { getManagerLogger } from '../logger.js';
import type { InteractionData } from '../types/interaction.js';
import { EntityManager } from '@mikro-orm/core';

const CONTRACTS_CHANNEL_ID = '1452771277080100874';

export class ContractManager {
  private bot: BotManager;
  private em: EntityManager;
  private logger = getManagerLogger('ContractManager');

  constructor(bot: BotManager) {
    this.bot = bot;
    this.em = bot.db.getEm();
  }

  public async handlerResponse(interaction: ButtonInteraction, data: InteractionData): Promise<void> {
    try {
      await interaction.deferUpdate();

      const contractId = (data as any)?.contractId;
      if (!contractId) return;

      const channel = this.bot.guild.channels.cache.get(CONTRACTS_CHANNEL_ID) as TextChannel;
      if (!channel) {
        this.logger.warn(`Canal de contrats non trouvé: ${CONTRACTS_CHANNEL_ID}`);
        return;
      }

      const threadName = 'Demandes Fidelis';
      let thread = channel.threads.cache.find(t => t.name === threadName);

      if (!thread) {
        thread = await channel.threads.create({
          name: threadName,
          autoArchiveDuration: 10080,
          reason: 'Fil centralisé pour les demandes fidelis',
        });
      }

      const contractTitle = await this.getContractTitle(contractId);
      const contractLabel = contractTitle ? `#${contractId} — ${contractTitle}` : `#${contractId}`;

      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('📦 Demande Fidelis')
        .setDescription(`L'utilisateur **${interaction.user.username}** a des ressources à donner pour **fidelis**`)
        .setFields([
          {
            name: 'Contrat',
            value: contractLabel,
            inline: true,
          },
          {
            name: 'Demandeur',
            value: interaction.user.username,
            inline: true,
          },
        ])
        .setFooter({ text: new Date().toLocaleString('fr-FR') });

      const respIds = await settingsService.getList(SettingKeys.bot.contracts.fidelisResponsibles);
      if (respIds.some(id => !/^\d{17,20}$/.test(id))) {
        throw new Error(`${SettingKeys.bot.contracts.fidelisResponsibles} contient un ID Discord invalide.`);
      }
      const mentions = respIds.map(id => `<@${id.trim()}>`).join(' ');

      await thread.send({
        content: mentions || '📢 Responsables Fidelis',
        embeds: [embed],
        allowedMentions: { users: respIds },
      });

      await interaction.followUp({
        content: '✅ Votre demande a été envoyée aux Responsables de Fidelis.',
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      this.logger.error({ msg: 'Erreur lors du traitement de la contribution au contrat', err: error });
    }
  }

  private async getContractTitle(contractId: number): Promise<string | null> {
    try {
      const result = await this.em.getConnection().execute<{ title: string }[]>(
        'SELECT title FROM contract WHERE id = ?',
        [contractId]
      );
      return result.length > 0 ? result[0].title : null;
    } catch (error) {
      this.logger.error({ msg: 'Erreur lors de la récupération du titre du contrat', err: error });
      return null;
    }
  }
}
