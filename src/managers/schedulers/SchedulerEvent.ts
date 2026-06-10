import { BotManager } from '../../BotManager.js';
import { Event } from '../../entities/event/Event.js';
import { Response } from '../../entities/event/Response.js';
import { startOfDay, endOfDay } from 'date-fns';
import { ChannelType, Collection, GuildMember, Message, ThreadAutoArchiveDuration } from 'discord.js';
import { FilterQuery, raw } from '@mikro-orm/core';
import { SafeMethod } from '../../exception/Safe.js';
import { getManagerLogger } from '../../logger.js';

export class SchedulerEvent {
  private pendingTasks = new Map<number, NodeJS.Timeout>();
  // Map pour stocker l'ID du channel vocal parent par event
  private voiceParentChannels = new Map<number, string>();
  private voiceParentCleanup = new Map<number, NodeJS.Timeout>();
  private logger = getManagerLogger('SchedulerEvent');

  constructor(private bot: BotManager) {
    // démarre la boucle toutes les 60s
    setInterval(() => this.checkEvents(), 60_000);

    // Nettoyage initial des vocaux d'events restants (au démarrage)
    void this.cleanupEmptyEventVoiceChannels().catch(err => this.logger.error({ msg: 'Erreur cleanup initial', err }));

    // Planifie un nettoyage toutes les heures
    setInterval(() => {
      void this.cleanupEmptyEventVoiceChannels().catch(err => this.logger.error({ msg: 'Erreur cleanup horaire', err }));
    }, 60 * 60 * 1000);
  }

  @SafeMethod
  private async checkEvents(): Promise<void> {
    const today = new Date();
    const start = startOfDay(today);
    const end   = endOfDay(today);
    const ONE_DAY_MIN = 24 * 60;

    const events = await this.bot.eventManager.em.getRepository(Event).find({
      start: {
        $gte: start,
        $lte: end,
      },
    });

    for (const ev of events) {
      const diffMs = ev.start.getTime() - today.getTime();
      const diffMin = diffMs / 60_000;

      // si dans les 15 premières minutes, envoie direct
      if (diffMin > 0 && diffMin <= 15) {
        await this.sendReminder(ev);
      }

      if (diffMin > ONE_DAY_MIN - 15 && diffMin <= ONE_DAY_MIN) {
        await this.sendReminderDayBefore(ev);
      }

      // sinon planifie à 15 min avant
      else if (diffMin > 15 && diffMin <= 24 * 60) {
        this.scheduleReminder(ev, diffMs - 15 * 60_000);
      }
    }
  }

  private async sendReminderDayBefore(ev: Event) {
    if (ev.appelMsgDiscord) return;

    const channel = this.bot.eventManager.getChannel(ev);
    if (!ev.discord.messageId) return;
    const msg = await channel.messages.fetch(ev.discord.messageId).catch(() => null);
    if (!msg) return;

    if (msg.hasThread) {
      const thread = msg.thread!;
      const confirmText = "Veuillez confirmer votre présence pour l'événement.";

      const fetched = await thread.messages.fetch({ limit: 200 }).catch(() => new Collection<string, Message>());
      const existing = Array.from(fetched.values()).find((m: Message) =>
        (m.author?.bot || m.author?.id === this.bot?.user?.id) &&
        m.content.includes(confirmText)
      );

      if (existing) return;
    }

    const resps = await this.bot.eventManager.em.getRepository(Response).find({
      event: ev,
      typeRep: { $in: ['tentative'] },
    } as FilterQuery<Response>, {
      populate: ['users'],
    });

    const mentions: Array<GuildMember | null> = await Promise.all(
      resps
        .map((r: Response) => r.users?.discordId)
        .filter((id): id is string => !!id)
        .map((id: string) => this.bot.guild.members.fetch(id).catch(() => null))
    );
    const line = mentions
      .filter(m => m)
      .map(m => `<@${m!.id}>`)
      .join(' ');

    const thread = msg.hasThread ? msg.thread! : await msg.startThread({
      name: `Rappel : ${ev.name}`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      reason: 'Rappel des participants',
    });
    await thread.send(`${line}\n\nVeuillez confirmer votre présence pour l'événement.\n\n`);
  }

  private scheduleReminder(ev: Event, delayMs: number): void {
    if (this.pendingTasks.has(ev.id)) return;
    const timeout = setTimeout(async () => {
      this.sendReminder(ev).catch(async err => await this.logger.error({ msg: 'Erreur dans sendReminder:', err }));
      this.pendingTasks.delete(ev.id);
    }, delayMs);
    this.pendingTasks.set(ev.id, timeout);
  }

  @SafeMethod
  private async sendReminder(ev: Event): Promise<void> {
    // protège contre doublons
    if (ev.appelMsgDiscord) return;

    const channel = this.bot.eventManager.getChannel(ev);
    if (!ev.discord.messageId) return;
    const msg = await channel.messages.fetch(ev.discord.messageId).catch(() => null);
    if (!msg) return;

    const resps = await this.bot.eventManager.em.getRepository(Response).find({
      event: ev,
      typeRep: { $in: ['accepted'] },
    } as FilterQuery<Response>, {
      populate: ['users'],
    });

    const mentions: Array<GuildMember | null> = await Promise.all(
      resps
        .map((r: Response) => r.users?.discordId)
        .filter((id): id is string => !!id)
        .map((id: string) => this.bot.guild.members.fetch(id).catch(() => null))
    );
    const line = mentions
      .filter(m => m)
      .map(m => `<@${m!.id}>`)
      .join(' ');

    // Crée un thread sur le message d'origine
    const thread = msg.hasThread ? msg.thread! : await msg.startThread({
      name: `Rappel : ${ev.name}`,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneDay,
      reason: 'Rappel des participants',
    });
    await thread.send(`${ev.name}\n\n${line}\n\n`);
    ev.appelMsgDiscord = true;
    await this.bot.eventManager.em.persist(ev).flush();

    // --- Création du channel vocal parent ---
    // On crée le channel vocal parent dans la même catégorie que le channel textuel de l'event

    const eventCategory = await this.bot.guild.channels.create({
      name: `Event - ${ev.name}`,
      type: ChannelType.GuildCategory,
      reason: `Catégorie pour l'event ${ev.name}`,
      permissionOverwrites: [
        {
          id: this.bot.guild.roles.everyone, // Tout le monde
          allow: ['ViewChannel'],
          deny: ['Connect'],
        },
        {
          id: this.bot.roleMember!.id, // Remplace par l'ID du rôle "membre"
          allow: ['ViewChannel', 'Connect', 'Speak'],
        },
      ],
    });

    // Déplace la catégorie juste après une autre catégorie (par exemple "Catégorie de référence")
    const referenceCategoryId = '523426571978276864'; // Remplace par l'ID voulu
    const referenceCategory = this.bot.guild.channels.cache.get(referenceCategoryId);
    if (referenceCategory && referenceCategory.type === ChannelType.GuildCategory) {
      // Place la nouvelle catégorie juste après la catégorie de référence
      await eventCategory.setPosition(referenceCategory.position + 1);
    }

    // Crée le channel vocal parent dans cette catégorie
    await this.bot.guild.channels.create({
      name: `Créer un vocal d'équipe`,
      type: ChannelType.GuildVoice,
      parent: eventCategory.id,
      reason: `Préparation event ${ev.name}`,
      // Pas de permissionOverwrites ici, il hérite de la catégorie
    });

    // Crée la salle de conférence privée
    await this.bot.guild.channels.create({
      name: `Briefing`,
      type: ChannelType.GuildStageVoice,
      parent: eventCategory.id,
      reason: `Salle de briefing privée pour l'event ${ev.name}`,
      permissionOverwrites: [
        {
          id: this.bot.guild.roles.everyone,
          allow: ['ViewChannel'],
          deny: ['Connect', 'Speak'],
        },
        {
          id: this.bot.roleMember!.id,
          allow: ['ViewChannel', 'Connect', 'Speak'],
        },
      ],
    });

    // Stocke l'ID de la catégorie et du vocal parent dans l'event
    ev.discord.vocalParentId = eventCategory.id;
    await this.bot.eventManager.em.persist(ev).flush();

    // Planifie la suppression du channel vocal parent à la fin de l'event
    const now = Date.now();
    const end = new Date(ev.end).getTime();
    const delay = Math.max(0, end - now);
    if (this.voiceParentCleanup.has(ev.id)) {
      clearTimeout(this.voiceParentCleanup.get(ev.id));
    }
    const cleanupTimeout = setTimeout(async () => {
      try {
        if (ev.discord.vocalParentId) {
          // On récupère la catégorie de l'event
          const category = await this.bot.guild.channels.fetch(ev.discord.vocalParentId).catch(() => null);
          if (category && category.type === ChannelType.GuildCategory) {
            // On cherche le channel vocal parent (le "créateur de channel") et le channel Briefing dans cette catégorie
            const childrenManager = category.children ?? category.guild.channels.cache.filter((ch) => ch.parentId === category.id);
            const childrenArray = Array.from(childrenManager.cache.values());
            const creatorChannel = childrenArray.find(
              ch => (ch as any).type === ChannelType.GuildVoice && (ch as any).name.startsWith('Créer un vocal d\'équipe')
            );
            const briefingChannel = childrenArray.find(
              ch => (ch as any).type === ChannelType.GuildStageVoice && (ch as any).name === 'Briefing'
            );

            // Supprime le créateur de channel si vide
            // Fonction utilitaire pour attendre qu'un channel soit vide puis le supprimer
            const waitAndDeleteIfEmpty = (channel: any, reason: string): Promise<boolean> => {
              return new Promise((resolve) => {
                if (channel && 'members' in channel) {
                  if (channel.members.size === 0) {
                    channel.delete(reason).then(() => resolve(true));
                  } else {
                    const interval = setInterval(async () => {
                      const refreshedChannel = await this.bot.guild.channels.fetch(channel.id).catch(() => null);
                      if (refreshedChannel && 'members' in refreshedChannel && (refreshedChannel as any).members.size === 0) {
                        clearInterval(interval);
                        await refreshedChannel.delete(reason);
                        resolve(true);
                      }
                    }, 10_000);
                  }
                } else {
                  resolve(false);
                }
              });
            };

            // Supprime le créateur de channel si vide ou attend qu'il soit vide
            let creatorDeleted = false;
            if (creatorChannel) {
              creatorDeleted = await waitAndDeleteIfEmpty(creatorChannel, 'Suppression du créateur de channel à la fin de l\'event');
            }

            // Supprime le channel Briefing si vide ou attend qu'il soit vide
            let briefingDeleted = false;
            if (briefingChannel) {
              briefingDeleted = await waitAndDeleteIfEmpty(briefingChannel, 'Suppression du channel Briefing à la fin de l\'event');
            }

            // Si les deux channels sont supprimés ou n'existent pas, supprime la catégorie si vide
            if (
              ((creatorChannel == null || creatorDeleted) && (briefingChannel == null || briefingDeleted)) &&
              category.children.cache.size === 0
            ) {
              await category.delete('Suppression de la catégorie vide à la fin de l\'event');
            }
          }
        }
      } catch {}
      this.voiceParentChannels.delete(ev.id);
      this.voiceParentCleanup.delete(ev.id);
    }, delay);
    this.voiceParentCleanup.set(ev.id, cleanupTimeout);
  }

  // Méthode utilitaire pour récupérer l'ID du channel vocal parent d'un event
  public getVoiceParentChannelId(eventId: number): string | undefined {
    return this.voiceParentChannels.get(eventId);
  }

  @SafeMethod
  private async cleanupEmptyEventVoiceChannels(): Promise<void> {
   
    this.logger.info({ msg: 'Lancement cleanupEmptyEventVoiceChannels' });
    try {
      const events = await this.bot.eventManager.em.getRepository(Event).find({
      start: { $lte: raw('now()') },
      discord: { vocalParentId: { $exists: true } },
    } as any);

      for (const ev of events) {
        if (!ev.discord || !ev.discord.vocalParentId) continue;
        const categoryId = ev.discord.vocalParentId;
        try {
          const category = await this.bot.guild.channels.fetch(categoryId).catch(() => null);
          if (!category) {
            // La catégorie n'existe plus: nettoyer la référence en BDD
            ev.discord.vocalParentId = null;
            await this.bot.eventManager.em.persist(ev).flush();
            continue;
          }
          if (category.type !== ChannelType.GuildCategory) continue;

          const childrenManager = category.children ?? category.guild.channels.cache.filter((ch) => ch.parentId === category.id);
          let childrenArray: any[] = [];
          if ((childrenManager as any).cache && typeof (childrenManager as any).cache.values === 'function') {
            childrenArray = Array.from((childrenManager as any).cache.values());
          } else if (typeof (childrenManager as any).values === 'function') {
            childrenArray = Array.from((childrenManager as any).values());
          }

          for (const ch of childrenArray) {
            try {
              if ((ch as any).members && (ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice)) {
                if ((ch as any).members.size === 0) {
                  await ch.delete('Auto-clean: vocal event vide').catch(() => null);
                }
              }
            } catch {}
          }

          // Rafraîchit la catégorie et supprime si vide
          const refreshed = await this.bot.guild.channels.fetch(category.id).catch(() => null);
          if (refreshed && refreshed.type === ChannelType.GuildCategory) {
            const size = (refreshed as any).children?.cache?.size ?? 0;
            if (size === 0) {
              await refreshed.delete('Auto-clean: catégorie event vide').catch(() => null);
              ev.discord.vocalParentId = null;
              await this.bot.eventManager.em.persist(ev).flush();
            }
          }
        } catch (err) {
          await this.logger.error({ msg: 'Erreur lors du nettoyage d\'un event', eventId: ev.id, err });
        }
      }
    } catch (err) {
      await this.logger.error({ msg: 'Erreur lors du nettoyage des events', err });
    }
  }

  public cancelReminder(ev: Event): void {
    const to = this.pendingTasks.get(ev.id);
    if (to) {
      clearTimeout(to);
      this.pendingTasks.delete(ev.id);
    }
    ev.appelMsgDiscord = false;
  }

  public updateEvent(ev: Event): void {
    // 1) Annule l'éventuel rappel en attente
    this.cancelReminder(ev);

    // 2) Calcule le délai restant jusqu'au début
    const now = new Date();
    const diffMs = ev.start.getTime() - now.getTime();

    // 3) Si on a déjà envoyé le rappel Discord, on ne fait rien
    if (ev.appelMsgDiscord) {
      return;
    }

    // 4) Si on est dans les 15 minutes précédant l'event, envoie immédiatement
    if (diffMs > 0 && diffMs <= 15 * 60_000) {
      void this.sendReminder(ev);
    }
    // 5) Sinon, si l'event est dans les prochaines 24 heures, on re-schedule
    else if (diffMs > 15 * 60_000 && diffMs <= 24 * 60 * 60_000) {
      this.scheduleReminder(ev, diffMs - 15 * 60_000);
    }
    // Au-delà de 24h ou échéance passée, on n'en fait pas plus
  }
}
