import { Event } from '../entities/Event.js';
import { Response } from '../entities/Response.js';
import { addDays, startOfDay, endOfDay } from 'date-fns';
const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
export default class SchedulerManager {
    constructor(bot) {
        this.appEvent = new SchedulerAppEvent(bot);
        this.event = new SchedulerEvent(bot);
    }
}
export class SchedulerAppEvent {
    constructor(bot) {
        this.bot = bot;
        // lit DAY_EVENT (0=lundi) et HOURS_EVENT ("HH:mm")
        this.dayIndex = parseInt(process.env.DAY_EVENT || '1', 10); // défaut lundi
        this.hourMinute = process.env.HOURS_EVENT || '09:00';
        this.startScheduler();
        console.log(`✔ Scheduled weekly send: ${DAY_NAMES[this.dayIndex]} at ${this.hourMinute}`);
    }
    startScheduler() {
        if (this.intervalId)
            clearInterval(this.intervalId);
        // toutes les 60s on vérifie l'heure & le jour
        this.intervalId = setInterval(() => this.checkDate(), 60000);
    }
    resetScheduler() {
        if (this.intervalId)
            clearInterval(this.intervalId);
        this.startScheduler();
    }
    checkDate() {
        const now = new Date();
        const [h, m] = this.hourMinute.split(':').map(s => parseInt(s, 10));
        if (now.getDay() === (this.dayIndex % 7) &&
            now.getHours() === h && now.getMinutes() === m) {
            // lance l’envoi en tâche asynchrone
            this.sendEventsWeek().catch(err => console.error('sendEventsWeek error', err));
        }
    }
    async sendEventsWeek() {
        console.log('→ sendEventsWeek');
        const today = new Date();
        // trouve le prochain lundi
        const daysUntilMonday = (8 - today.getDay()) % 7;
        const monday = addDays(startOfDay(today), daysUntilMonday);
        const sunday = endOfDay(addDays(monday, 6));
        // version $between
        const events = await this.bot.dbMgr.getEm().getRepository(Event).find({
            start: {
                $gte: monday,
                $lte: sunday,
            },
        }, {
            populate: ['*', 'responses.users'],
        });
        for (const ev of events) {
            await this.bot.evMgr.setEvent(ev);
            this.bot.dbMgr.getEm().persist(ev);
        }
        await this.bot.dbMgr.getEm().flush();
    }
}
export class SchedulerEvent {
    constructor(bot) {
        this.bot = bot;
        this.pendingTasks = new Map();
        // démarre la boucle toutes les 60s
        setInterval(() => this.checkEvents(), 60000);
    }
    async checkEvents() {
        const today = new Date();
        const start = startOfDay(today);
        const end = endOfDay(today);
        const events = await this.bot.dbMgr.getEm().getRepository(Event).find({
            start: {
                $gte: start,
                $lte: end,
            },
        });
        for (const ev of events) {
            const diffMs = ev.start.getTime() - today.getTime();
            const diffMin = diffMs / 60000;
            // si dans les 15 premières minutes, envoie direct
            if (diffMin > 0 && diffMin <= 15) {
                await this.sendReminder(ev);
            }
            // sinon planifie à 15 min avant
            else if (diffMin > 15 && diffMin <= 24 * 60) {
                this.scheduleReminder(ev, diffMs - 15 * 60000);
            }
        }
    }
    scheduleReminder(ev, delayMs) {
        if (this.pendingTasks.has(ev.id))
            return;
        const timeout = setTimeout(() => {
            this.sendReminder(ev).catch(console.error);
            this.pendingTasks.delete(ev.id);
        }, delayMs);
        this.pendingTasks.set(ev.id, timeout);
    }
    async sendReminder(ev) {
        // protège contre doublons
        if (ev.appelMsgDiscord)
            return;
        const channel = this.bot.evMgr.getChannel(ev);
        if (!ev.discordId)
            return;
        const msg = await channel.messages.fetch(ev.discordId).catch(() => null);
        if (!msg)
            return;
        const resps = await this.bot.dbMgr.getEm().getRepository(Response).find({
            event: ev,
            typeRep: "accepted"
        });
        const mentions = await Promise.all(resps
            .map(r => r.users?.discordId)
            .filter((id) => !!id)
            .map(id => this.bot.guild.members.fetch(id).catch(() => null)));
        const line = mentions
            .filter(m => m)
            .map(m => `<@${m.id}>`)
            .join(' ');
        await msg.reply(`${ev.name}\n\n${line || 'Aucun'}`);
        ev.appelMsgDiscord = true;
        await this.bot.dbMgr.update(ev);
    }
    cancelReminder(ev) {
        const to = this.pendingTasks.get(ev.id);
        if (to) {
            clearTimeout(to);
            this.pendingTasks.delete(ev.id);
        }
        ev.appelMsgDiscord = false;
    }
    updateEvent(ev) {
        // 1) Annule l’éventuel rappel en attente
        this.cancelReminder(ev);
        // 2) Calcule le délai restant jusqu’au début
        const now = new Date();
        const diffMs = ev.start.getTime() - now.getTime();
        // 3) Si on a déjà envoyé le rappel Discord, on ne fait rien
        if (ev.appelMsgDiscord) {
            return;
        }
        // 4) Si on est dans les 15 minutes précédant l’event, envoie immédiatement
        if (diffMs > 0 && diffMs <= 15 * 60000) {
            void this.sendReminder(ev);
        }
        // 5) Sinon, si l’event est dans les prochaines 24 heures, on re-schedule
        else if (diffMs > 15 * 60000 && diffMs <= 24 * 60 * 60000) {
            this.scheduleReminder(ev, diffMs - 15 * 60000);
        }
        // Au-delà de 24h ou échéance passée, on n’en fait pas plus
    }
}
//# sourceMappingURL=SchedulerManager.js.map