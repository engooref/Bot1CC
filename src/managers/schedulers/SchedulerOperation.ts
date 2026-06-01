import { BotManager } from '../../BotManager.js';
import { TempLink } from '../../entities/operations/TempLink.js';
import { getManagerLogger } from '../../logger.js';
import { SafeMethod } from '../../exception/Safe.js';

const ARCHIVE_DELAY_MS = 4 * 60 * 60 * 1000; // 4 heures

export class SchedulerOperation {
  private logger = getManagerLogger('SchedulerOperation');

  constructor(private bot: BotManager) {
    // Vérifie toutes les 5 minutes
    setInterval(() => this.checkOperations(), 5 * 60_000);
    // Vérifie au démarrage
    this.checkOperations().catch((err) => {
      this.logger.error({ op: 'SCHEDULER_OPERATION_INIT', err });
    });
  }

  @SafeMethod
  private async checkOperations(): Promise<void> {
    const em = this.bot.db.getEm();

    // Trouve tous les TempLink non archivés
    const tempLinks = await em.find(TempLink, { archived: false });

    const now = new Date();

    for (const tempLink of tempLinks) {
      const timeSinceStart = now.getTime() - tempLink.startAt.getTime();

      // Si 4h sont passées, archive l'opération
      if (timeSinceStart >= ARCHIVE_DELAY_MS) {
        await this.archiveOperation(tempLink);
      }
    }
  }

  private async archiveOperation(tempLink: TempLink): Promise<void> {
    try {
      const em = this.bot.db.getEm();
      const opInfo = `Opération ${tempLink.operationId} - Responsable: ${tempLink.responsable}`;

      await this.logger.info(
        { op: 'ARCHIVE_OPERATION', tempLinkId: tempLink.id, operationId: tempLink.operationId },
        `🗑️ SUPPRESSION D'OPÉRATION: ${opInfo}`
      );

      let messageDeleted = false;
      let threadDeleted = false;

      // Supprimer le message Discord si elle existe
      if (tempLink.operationId && tempLink.channelId) {
        try {
          const channel = await this.bot.channels.fetch(tempLink.channelId).catch(() => null);
          if (channel && 'messages' in channel) {
            const message = await channel.messages.fetch(tempLink.operationId).catch(() => null);
            if (message) {
              await message.delete();
              messageDeleted = true;
              await this.logger.debug(
                { op: 'ARCHIVE_OPERATION', operationId: tempLink.operationId },
                `✓ Message supprimé`
              );
            }
          }
        } catch (err) {
          await this.logger.warn(
            { op: 'ARCHIVE_OPERATION', operationId: tempLink.operationId, err },
            `⚠️ Erreur lors de la suppression du message (peut déjà être supprimé)`
          );
        }
      }

      // Supprimer le thread Discord si elle existe
      if (tempLink.threadId) {
        try {
          const thread = await this.bot.channels.fetch(tempLink.threadId).catch(() => null);
          if (thread && 'delete' in thread) {
            await thread.delete();
            threadDeleted = true;
            await this.logger.debug(
              { op: 'ARCHIVE_OPERATION', threadId: tempLink.threadId },
              `✓ Thread supprimé`
            );
          }
        } catch (err) {
          await this.logger.warn(
            { op: 'ARCHIVE_OPERATION', threadId: tempLink.threadId, err },
            `⚠️ Erreur lors de la suppression du thread (peut déjà être supprimé)`
          );
        }
      }

      // Marquer comme archivé
      tempLink.setArchived(true);
      await em.persist(tempLink).flush();

      await this.logger.info(
        { op: 'ARCHIVE_OPERATION', tempLinkId: tempLink.id, messageDeleted, threadDeleted },
        `✅ Opération archivée avec succès (4h après le départ)`
      );
    } catch (err) {
      await this.logger.error({
        op: 'ARCHIVE_OPERATION',
        err,
        tempLinkId: tempLink.id,
        operationId: tempLink.operationId
      });
    }
  }
}
