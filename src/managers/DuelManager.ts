import { ButtonInteraction, GuildMember, TextChannel } from 'discord.js';
import { BotManager } from '../BotManager.js';
import type { InteractionData } from '../types/interaction.js';
import { getManagerLogger } from '../logger.js';
import { SafeMethod } from '../exception/Safe.js';
import { ComponentInteraction } from '../view/BaseView.js';
import { LeaderboardDuel, LeaderboardDuelStatus } from '../entities/leaderboard/LeaderboardDuel.js';
import { EntityManager } from '@mikro-orm/core';
import { LeaderboardRating } from '../entities/leaderboard/LeaderboardRating.js';
import { LeaderboardDuelLog } from '../entities/leaderboard/LeaderboardDuelLog.js';

// filepath: /home/work/Bot1CC/src/managers/DuelManager.ts

type DuelStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'completed';

interface Duel {
    id: string;
    challengerId: string;
    opponentId: string;
    channelId: string;
    createdAt: Date;
    status: DuelStatus;
    stake?: string | null;
    result?: {
        winnerId: string;
        loserId: string;
    } | null;
}

export class DuelManager {
    private bot: BotManager;
    private em: EntityManager;
    private logger = getManagerLogger('DuelManager');

    constructor(bot: BotManager) {
        this.bot = bot;
        this.em = bot.db.getEm();
    }

    @SafeMethod
    public async handleDuelCommand(interaction: ButtonInteraction, data: InteractionData): Promise<void> {
        try {
            const idButton = interaction.customId;
            const duelIdRaw = data.duelId;
            const duelId = duelIdRaw !== undefined ? Number(duelIdRaw) : undefined;
            let res = null;
            if (!duelId) {
                await interaction.followUp({ content: '⛔ ID de duel requis.', ephemeral: true });
                return;
            }
            const duel = await this.em.findOneOrFail(LeaderboardDuel, { id: duelId }, { populate: ['player1', 'player2'] });
            if (!duel) throw '❌ Duel introuvable ou expiré.';

            if (idButton === 'button_valid_leader') {
                res = await this.acceptDuel(interaction.user.id, duel);
            } else {                
                res = await this.declineDuel(interaction.user.id, duel);
            }

            if (res) await interaction.followUp({ content: res, ephemeral: false });
        } catch (err) {
            await this.logger.error({ msg: '[DuelManager] Erreur dans handleDuelCommand:', err });
            await interaction.followUp({ content: '❌ Une erreur est survenue.', ephemeral: true });
        }
    }


    @SafeMethod
    private async acceptDuel(userId: string, duel: LeaderboardDuel): Promise<string> {

        if (duel.player2.discordId !== userId) return '⛔ Tu n\'es pas autorisé à accepter ce duel.';
        if (duel.status === LeaderboardDuelStatus.IN_PROGRESS) return '⚠️ Ce duel a déjà été accepté.';
        if (duel.status !== LeaderboardDuelStatus.WAITING_CONFIRMATION) return '⚠️ Ce duel n\'est pas en attente.';

        duel.status = LeaderboardDuelStatus.IN_PROGRESS;
        duel.startAt = new Date();
        try { await this.em.persist(duel).flush(); } catch {}
        
        await this.sendAcceptDuel(duel);

        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 7); // 7 days to complete the duel

        const log = this.em.create(LeaderboardDuelLog, {
            duel: duel,
            actor: null,
            action: 'duel_accepted',
            details: {
                deadline: deadline.toISOString()
            },
            createdAt: new Date()
        });

        try { await this.em.persist(log).flush(); } catch {}
        
        return '';
    }

    @SafeMethod
    private async declineDuel(userId: string, duel: LeaderboardDuel): Promise<string> {
        
        try {
            if (duel.player2.discordId !== userId) return '⛔ Tu n\'es pas autorisé à refuser ce duel.';
            if (duel.status === LeaderboardDuelStatus.REFUSED) return '⚠️ Ce duel a déjà été refusé.';
            if (duel.status !== LeaderboardDuelStatus.WAITING_CONFIRMATION) return '⚠️ Ce duel ne peut pas être refusé maintenant.';

            const base = process.env.URL_SITE || '';
            const url = `${base.replace(/\/$/, '')}/leaderboards/bot/refus/${duel.id}`;
            const res = await fetch(url, { method: 'POST', headers: { 'X-BOT-TOKEN': process.env.BOT_TOKEN || '' } });
            if (res.status !== 200) {
                await this.logger.error({ msg: '[DuelManager] Requête HTTP refus duel a échoué', status: res.status, url });
                return `❌ Impossible de refuser le duel ${duel.id} pour le moment. Veuillez réessayer plus tard.`;
            }
            
            const { player1, player2 } = duel.preview;
            await this.sendRefusedDuel(duel, player2.penalty);
        } catch (err) {
            await this.logger.error({ msg: '[DuelManager] Erreur lors de la requête HTTP de refus:', err });
            return `❌ Impossible de refuser le duel ${duel.id} pour le moment. Veuillez réessayer plus tard.`;
        }

        return `❌ Duel ${duel.id} refusé.`;
    }

    public async sendAcceptDuel(duel:LeaderboardDuel): Promise<void> {
        const deadline = new Date();
        deadline.setDate(deadline.getDate() + 7); // 7 days to complete the duel
        const embed = {
            title: 'Duel accepté !',
            description: `⚔️ ${duel.player2.username} a accepté le duel.`,
            color: 0x22BB33,
            fields: [
            { name: 'Durée', value: 'Vous avez 7 jours pour réaliser le duel.', inline: false },
            { name: 'Date limite', value: `<t:${Math.floor(deadline.getTime() / 1000)}:F>`, inline: false }
            ],
            timestamp: new Date().toISOString()
        };


        const player1 = await this.bot.guild.members.fetch(duel.player1.discordId);
        const dm = await player1?.createDM();
        if (dm) {
            await dm.send({ embeds: [embed] });
        }
        
        embed.description = '⚔️ Tu as accepté le duel.';
        const player2 = await this.bot.guild.members.fetch(duel.player2.discordId);
        const dm2 = await player2?.createDM();
        if (dm2) {
            await dm2.send({ embeds: [embed] });
        }
    }

    public async sendRefusedDuel(duel: LeaderboardDuel, penalty: number): Promise<void> {
        const embed = {
            title: 'Duel refusé',
            description: `❌ ${duel.player2.username} a refusé le duel.`,
            color: 0xBB2222,
            timestamp: new Date().toISOString()
        };

        const player1 = await this.bot.guild.members.fetch(duel.player1.discordId);
        const dm = await player1?.createDM();
        if (dm) {
            await dm.send({ embeds: [embed] });
        }

        embed.description = '❌ Tu as refusé le duel.' 
        if (penalty > 0) embed.description += `\nUne pénalité de **${penalty} ELO** a été appliquée à ton classement.`;
        else embed.description += `\nAucune pénalité n'a été appliquée à ton classement.`;

        const player2 = await this.bot.guild.members.fetch(duel.player2.discordId);
        const dm2 = await player2?.createDM();
        if (dm2) {
            await dm2.send({ embeds: [embed] });
        }
    }

    
}