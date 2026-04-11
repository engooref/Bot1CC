import { Router, Request } from 'express';
import BotManager from '../../BotManager.js';
import multer from 'multer';
import { LeaderboardDuel } from '../../entities/LeaderboardDuel.js';
import DuelView from '../../view/DuelView.js';
import { TextChannel } from 'discord.js';
import { LeaderboardRating } from '../../entities/LeaderboardRating.js';


export interface DuelDto {
  duelId: number | string;
}


export interface TournamentInviteDto {
    tournamentName: string;
    inviteUrl: string;
    discordIds: string;
}

function parseJsonIfString<T>(v: unknown, fieldName: string): T {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      throw new Error(`${fieldName} must be valid JSON string`);
    }
  }
  return v as T;
}

function parseStringArrayField(v: unknown, fieldName: string): string[] {
  const parsed = parseJsonIfString<unknown>(v, fieldName);
  if (!Array.isArray(parsed)) throw new Error(`${fieldName} array required`);
  return parsed.map((x) => String(x));
}

const upload = multer({ storage: multer.memoryStorage() });

function parseNumberField(v: unknown, fieldName: string): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim());
  if (!Number.isFinite(n)) throw new Error(`${fieldName} must be a number`);
  return n;
}

export default function createLeaderboardsRouter(bot: BotManager): Router {
    const router = Router();

    router.post('/annonce', upload.none(), async (req: Request<{}, {}, DuelDto>, res, next) => {
        try {
            const duelId = parseNumberField((req.body as any).duelId, 'duelId');
            const em = bot.dbMgr.getEm();

            // ---- Ton fonctionnement existant (inchangé)
            const duel = await em.findOneOrFail(LeaderboardDuel, { id: duelId }, { populate: ['player1', 'player2'] });

            const player1 = await bot.guild.members.fetch(duel.player1.discordId);
            const player2 = await bot.guild.members.fetch(duel.player2.discordId);
            
            const rating1 = await em.findOneOrFail(LeaderboardRating, { user: duel.player1, type: duel.type });
            const rating2 = await em.findOneOrFail(LeaderboardRating, { user: duel.player2, type: duel.type });
            const view = new DuelView(bot, duelId);

            const expiresAt = Date.now() + 3 * 24 * 60 * 60 * 1000;

            const opponentElo = rating1.rating;
            
            const { player1: player1Preview, player2: player2Preview } = duel.preview;


            const embed = {
                title: "⚔️ Défi en attente",
                color: 0x3E92CC,
                timestamp: new Date().toISOString(),

                thumbnail: {
                    url: player1.user.displayAvatarURL({ extension: 'png', size: 256 })
                },

                description:
                    `**${player1.displayName}** t’a lancé un défi en **duel ${duel.type.toUpperCase()}**.\n` +
                    `━━━━━━━━━━━━━━━━━━\n` +
                    `Prépare-toi à prouver ta supériorité sur le champ de bataille.`,

                fields: [
                    // --- Infos principales ---
                    {
                        name: "🎮 Mode de duel",
                        value: `**${duel.type.toUpperCase()}**`,
                        inline: true
                    },
                    {
                        name: "📊 ELO de l’adversaire",
                        value: `**${opponentElo}**`,
                        inline: true
                    },

                    // espace
                    { name: "\u200B", value: "" },

                    // --- Impact ELO ---
                    {
                        name: "⚖️ Impact sur le classement",
                        value:
                            `🏆 Victoire : **+${player2Preview.win} ELO**\n` +
                            `💀 Défaite : **${player2Preview.loss} ELO**`,
                        inline: false
                    },

                    // espace
                    { name: "\u200B", value: "" },

                    // --- Refus gratuits ---
                    {
                        name: "🪙 Refus sans pénalité",
                        value:
                            rating2.freeRefus > 0
                                ? `Il te reste **${rating2.freeRefus}/3** refus gratuits.\n` +
                                `Les utiliser évite toute perte d’ELO.`
                                : `❗ **Aucun refus gratuit restant**.\n` +
                                `Refuser ce duel entraînera une **pénalité de ${player2Preview.penalty} ELO**.`,
                        inline: false
                    },

                    // espace
                    { name: "\u200B", value: "" },

                    // --- Temps ---
                    {
                        name: "⏳ Temps restant pour répondre",
                        value: `<t:${Math.floor(expiresAt / 1000)}:R>`,
                        inline: false
                    },

                    // --- Lien ---
                    {
                        name: "🔗 Classement",
                        value: "👉 [Accéder aux Leaderboards](https://www.1ercorpscolonial.fr/leaderboards)",
                        inline: false
                    }
                ],

                footer: {
                    text: "1er Corps Colonial • Leaderboard Officiel"
                }
            };

            const dm = await player2.createDM();
            await view.sendOrEdit(dm as unknown as TextChannel, null, { embeds: [embed] });
            
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });

    router.post('/accept', upload.none(), async (req: Request<{}, {}, DuelDto>, res, next) => {
        try {
            const duelId = parseNumberField((req.body as any).duelId, 'duelId');
            const em = bot.dbMgr.getEm();

            const duel = await em.findOneOrFail(LeaderboardDuel, { id: duelId }, { populate: ['player1', 'player2'] });

            await bot.duelMgr.sendAcceptDuel(duel);

            res.json({ success: true });

        } catch (err) {
            next(err);
        }
    });

    router.post('/refus', upload.none(), async (req: Request<{}, {}, DuelDto>, res, next) => {
        try {
            const duelId = parseNumberField((req.body as any).duelId, 'duelId');
            const em = bot.dbMgr.getEm();

            const duel = await em.findOneOrFail(LeaderboardDuel, { id: duelId }, { populate: ['player1', 'player2'] });

            const {player1, player2} = duel.preview;
            
            await bot.duelMgr.sendRefusedDuel(duel, player2.penalty);

            res.json({ success: true });

        } catch (err) {
            next(err);
        }
    });

    router.post('/tournament/invite', upload.none(), async (req: Request<{}, {}, TournamentInviteDto>, res, next) => {
        try {
            const tournamentName = String((req.body as any).tournamentName ?? '').trim();
            const inviteUrl = String((req.body as any).inviteUrl ?? '').trim();
            const discordIds = parseStringArrayField((req.body as any).discordIds ?? [], 'discordIds');

            for (const discordId of discordIds) {
                try {
                    const member = await bot.guild.members.fetch(discordId);
                    const dm = await member.createDM();

                    const embed = {
                        title: `🏆 Invitation au tournoi : ${tournamentName}`,
                        color: 0xFFD700,
                        description:
                            `Tu es invité à rejoindre le tournoi **${tournamentName}** !\n\n` +
                            `Clique sur le lien ci-dessous pour participer :\n` +
                            `${inviteUrl}`,
                        timestamp: new Date().toISOString(),
                        footer: {
                            text: "1er Corps Colonial • Tournois Officiels"
                        }
                    };

                    await (dm as unknown as TextChannel).send({ embeds: [embed] });
                } catch (dmErr) {
                    console.error(`Failed to send tournament invite to ${discordId}:`, dmErr);
                }
            }

            res.json({ success: true });

        } catch (err) {
            next(err);
        }
    });

    return router;

}