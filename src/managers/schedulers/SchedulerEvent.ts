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
  private logger = getManagerLogger('SchedulerEvent');

  constructor(private bot: BotManager) {
    // démarre la boucle toutes les 60s
    setInterval(() => this.checkEvents(), 60_000);

    // Nettoyage initial des vocaux d'events restants (au démarrage)
    void this.cleanupEvents().catch(err => this.logger.error({ msg: 'Erreur cleanup initial', err }));

    // Planifie un nettoyage toutes les heures
    setInterval(() => {
      void this.cleanupEvents().catch(err => this.logger.error({ msg: 'Erreur cleanup horaire', err }));
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

    const channel = await this.bot.eventManager.getChannel(ev);
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
    if (ev.appelMsgDiscord) {
      this.logger.info({ msg: 'Rappel déjà envoyé pour cet event', eventId: ev.id, eventName: ev.name });
      return;
    }

    this.logger.info({ msg: 'Début sendReminder', eventId: ev.id, eventName: ev.name });

    const channel = await this.bot.eventManager.getChannel(ev);
    if (!ev.discord.messageId) {
      this.logger.warn({ msg: 'Pas de messageId pour cet event', eventId: ev.id });
      return;
    }
    const msg = await channel.messages.fetch(ev.discord.messageId).catch(() => null);
    if (!msg) {
      this.logger.warn({ msg: 'Message Discord non trouvé', eventId: ev.id, messageId: ev.discord.messageId });
      return;
    }

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

    await this.ensureEventVoiceChannels(ev);
  }

  @SafeMethod
  public async ensureEventVoiceChannels(ev: Event): Promise<void> {
    if (ev.discord.vocalParentId) {
      const existing = await this.bot.guild.channels.fetch(ev.discord.vocalParentId).catch(() => null);
      if (existing && existing.type === ChannelType.GuildCategory) {
        this.logger.info({
          msg: 'Création des channels ignorée: catégorie déjà existante',
          eventId: ev.id,
          categoryId: ev.discord.vocalParentId,
        });
        return;
      }
    }

    // --- Création du channel vocal parent ---
    // On crée le channel vocal parent dans la même catégorie que le channel textuel de l'event

    this.logger.info({ msg: 'Création de la catégorie event', eventId: ev.id, eventName: ev.name });
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
    }).catch(err => {
      this.logger.error({ msg: 'Erreur création catégorie', eventId: ev.id, err });
      throw err;
    });
    this.logger.info({ msg: 'Catégorie créée', eventId: ev.id, categoryId: eventCategory.id });

    // Déplace la catégorie juste après une autre catégorie (par exemple "Catégorie de référence")
    const referenceCategoryId = '523426571978276864'; // Remplace par l'ID voulu
    const referenceCategory = this.bot.guild.channels.cache.get(referenceCategoryId);
    if (referenceCategory && referenceCategory.type === ChannelType.GuildCategory) {
      // Place la nouvelle catégorie juste après la catégorie de référence
      await eventCategory.setPosition(referenceCategory.position + 1);
      this.logger.info({ msg: 'Position de la catégorie mise à jour', eventId: ev.id });
    }

    // Crée le channel vocal parent dans cette catégorie
    this.logger.info({ msg: 'Création du vocal créateur', eventId: ev.id });
    await this.bot.guild.channels.create({
      name: `Créer un vocal d'équipe`,
      type: ChannelType.GuildVoice,
      parent: eventCategory.id,
      reason: `Préparation event ${ev.name}`,
      // Pas de permissionOverwrites ici, il hérite de la catégorie
    }).catch(err => {
      this.logger.error({ msg: 'Erreur création vocal créateur', eventId: ev.id, err });
      throw err;
    });
    this.logger.info({ msg: 'Vocal créateur créé', eventId: ev.id });

    // Crée la salle de conférence privée
    this.logger.info({ msg: 'Création du vocal briefing', eventId: ev.id });
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
    }).catch(err => {
      this.logger.error({ msg: 'Erreur création vocal briefing', eventId: ev.id, err });
      throw err;
    });
    this.logger.info({ msg: 'Vocal briefing créé', eventId: ev.id });

    // Stocke l'ID de la catégorie dans l'event
    this.logger.info({ msg: 'Sauvegarde vocalParentId en BDD', eventId: ev.id, categoryId: eventCategory.id });
    ev.discord.vocalParentId = eventCategory.id;
    await this.bot.eventManager.em.persist(ev).flush();
    this.logger.info({ msg: 'Canaux vocaux créés avec succès', eventId: ev.id, categoryId: eventCategory.id });
  }

  // Méthode utilitaire pour récupérer l'ID du channel vocal parent d'un event
  public getVoiceParentChannelId(eventId: number): string | undefined {
    return this.voiceParentChannels.get(eventId);
  }

  @SafeMethod
  private async cleanupEvents(): Promise<void> {
    try {
      const eventsToClean = await this.bot.eventManager.em
      .getRepository(Event)
      .find(
        {
          end: { $lte: raw('NOW()') },
          start: { $gte: raw('DATE_SUB(NOW(), INTERVAL 2 WEEK)') },
        },
        {
          populate: ['type'],
        },
      );

      if (eventsToClean.length === 0) {
        this.logger.debug({
          msg: 'Aucun event à nettoyer',
        });
        return;
      }

      this.logger.info({
        msg: 'Lancement du nettoyage des events',
        eventCount: eventsToClean.length,
      });

      await this.cleanupEmptyEventVoiceChannels(eventsToClean);
      
      const weekEvents = await this.bot.eventManager.em
      .getRepository(Event)
      .find(
        {
          start: {
            $gte: raw(
              "DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)",
            ),
            $lt: raw(
              "DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY)",
            ),
          },
        },
        {
          populate: ['type'],
        },
      );

      const eventChannelIds = new Set<string>();

      for (const event of weekEvents) {
        const channel = await this.bot.eventManager.getChannel(event);

        if (channel) {
          eventChannelIds.add(channel.id);
        }
      }

      const channels = await this.bot.guild.channels.fetch();

      for (const channel of channels.values()) {
        if (!channel?.isTextBased()) continue;
        if (!channel.name.endsWith('📅')) continue;

        if (!eventChannelIds.has(channel.id)) {
          await channel.setName(channel.name.slice(0, -1));
        }
      }

    } catch (err) {
      this.logger.error({
        msg: 'Erreur lors du nettoyage général des events',
        err,
      });
    }
  }

  @SafeMethod
  private async cleanupEmptyEventVoiceChannels(
    events: Event[],
  ): Promise<void> {
    this.logger.debug({
      msg: 'Lancement cleanupEmptyEventVoiceChannels',
      eventCount: events.length,
    });

    const eventsWithVoiceCategory = events.filter(
      (event) => Boolean(event.discord?.vocalParentId),
    );

    for (const event of eventsWithVoiceCategory) {
      const categoryId = event.discord?.vocalParentId;

      if (!categoryId) {
        continue;
      }

      this.logger.info({
        msg: 'Cleanup event vocal',
        eventId: event.id,
        eventName: event.name,
        vocalParentId: categoryId,
      });

      try {
        const category = await this.bot.guild.channels
          .fetch(categoryId)
          .catch(() => null);

        if (!category) {
          // La catégorie n'existe plus : nettoyage de la référence en BDD.
          event.discord!.vocalParentId = null;
          await this.bot.eventManager.em.persist(event).flush();
          continue;
        }

        if (category.type !== ChannelType.GuildCategory) {
          this.logger.warn({
            msg: 'Le vocalParentId ne correspond pas à une catégorie',
            eventId: event.id,
            categoryId,
            channelType: category.type,
          });
          continue;
        }

        /*
        * Utiliser le cache global est plus simple et plus fiable que de gérer
        * plusieurs formes possibles de category.children.
        */
        const children = category.guild.channels.cache.filter(
          (channel) => channel.parentId === category.id,
        );

        const voiceChannels = children.filter(
          (channel) =>
            channel.type === ChannelType.GuildVoice ||
            channel.type === ChannelType.GuildStageVoice,
        );

        for (const channel of voiceChannels.values()) {
          try {
            if (channel.members.size !== 0) {
              continue;
            }

            this.logger.info({
              msg: 'Auto-cleanup : suppression du channel vide',
              eventId: event.id,
              channelName: channel.name,
              channelId: channel.id,
            });

            await channel.delete('Auto-clean: vocal event vide');
          } catch (err) {
            this.logger.error({
              msg: 'Erreur auto-cleanup channel',
              eventId: event.id,
              channelName: channel.name,
              channelId: channel.id,
              err,
            });
          }
        }

        /*
        * On vérifie le cache de la guild après les suppressions.
        * Cela permet aussi de détecter d'éventuels salons non vocaux restants.
        */
        const remainingChildren = category.guild.channels.cache.filter(
          (channel) => channel.parentId === category.id,
        );

        this.logger.info({
          msg: 'État de la catégorie après cleanup',
          eventId: event.id,
          categoryId: category.id,
          childrenCount: remainingChildren.size,
        });

        if (remainingChildren.size > 0) {
          continue;
        }

        this.logger.info({
          msg: 'Auto-cleanup : suppression de la catégorie vide',
          eventId: event.id,
          categoryId: category.id,
        });

        await category.delete('Auto-clean: catégorie event vide');

        event.discord!.vocalParentId = null;
        await this.bot.eventManager.em.persist(event).flush();

        this.logger.info({
          msg: 'Catégorie supprimée et référence BDD nettoyée',
          eventId: event.id,
        });
      } catch (err) {
        this.logger.error({
          msg: "Erreur lors du nettoyage d'un event",
          eventId: event.id,
          err,
        });
      }
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
