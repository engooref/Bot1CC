import { Router, Request } from 'express';
import BotManager from '../../BotManager.js';
import multer from 'multer';
import { TextBasedChannel, TextChannel } from 'discord.js';
import { User } from '../../entities/User.js';
import { Role } from 'discord.js';
import PromotionsView from '../../view/PromotionsView.js';
import { Rank } from '../../entities/Rank.js';
import { httpLogger } from '../../logger.js';
import { RHMember } from '../../entities/RHMember.js';


export interface UserPromotionDto {
  discordId: string;
  rank: string;
}

export interface PromotionsDto {
  // multipart => souvent string JSON
  promotions: UserPromotionDto[] | string;
}

export interface UserListDto {
  // multipart => souvent string JSON
  discordIds: string[] | string;
}

const upload = multer({ storage: multer.memoryStorage() });

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

function parsePromotionsField(v: unknown): UserPromotionDto[] {
  const parsed = parseJsonIfString<unknown>(v, 'promotions');
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('promotions array required');
  return parsed.map((p: any) => ({
    discordId: String(p.discordId ?? ''),
    rank: String(p.rank ?? ''),
  }));
}

export default function createRankRouter(bot: BotManager): Router {
    const router = Router();

    router.post('/up', upload.none(), async (req: Request<{}, {}, PromotionsDto>, res, next) => {
        try {
            const promotions = parsePromotionsField((req.body as any).promotions);

            const em = bot.dbMgr.getEm();
            // Récupère le channel RH nommé Promotions
            const channelRh = bot.guild.channels.cache.get(bot.getParameter('CHANNEL_RH') as string) as TextChannel;
            

            if (!channelRh) {
                throw new Error('Channel RH introuvable');
            }

            let threadRh = channelRh.threads.cache.find(t => t.name === 'Promotions');
            if (!threadRh) {
                threadRh = await channelRh.threads.create({
                    name: 'Promotions',
                    autoArchiveDuration: 10080,
                    reason: 'Thread pour les promotions',
                });
                if (!threadRh) {
                    throw new Error('Impossible de créer le thread Promotions');
                }
            }

            const rhRole = bot.guild.roles.cache.get((bot.getParameter('ROLE_RH') as string[])[0]) as Role;
                    
            
            const results: { discordId: string; success: boolean; error?: string }[] = [];

            for (const promotion of promotions) {
                const { discordId, rank } = promotion;
                try {
                    // Récupère l'utilisateur Discord
                    const member = await bot.guild.members.fetch(discordId);
                    // Récupère le rank (à adapter selon ta logique métier)
                    const userEntity = await em.findOneOrFail(User, { discordId }, { populate: ['rhProfile', 'rhProfile.grade'] });
                    if (userEntity.rhProfile?.promotionSend) continue;
                    const oldRank = userEntity.rhProfile?.grade?.name ?? bot.roleMember?.name ?? 'Aucun';


                    // Crée l'embed
                    const embed = {
                        title: "📋 Promotion disponible",
                        description: `${rhRole?.toString() || ''}`,
                        color: Math.floor(Math.random()*0xffffff), // bleu neutre RH
                        thumbnail: {
                            url: member.user.displayAvatarURL({ size: 256 }), // ou ton URL custom
                        },
                        fields: [
                            {
                            name: "Membre",
                            value: member.displayName,
                            inline: false,
                            },
                            {
                            name: "Grade Actuel",
                            value: oldRank ?? "Non défini",
                            inline: true,
                            },
                            {
                            name: "Promotion possible",
                            value: rank,
                            inline: true,
                            },
                        ],
                        timestamp: new Date().toISOString(),
                    };

                    const view = new PromotionsView(bot);
                    await view.sendOrEdit(threadRh, null, { embeds: [embed] });
                    if (userEntity.rhProfile) userEntity.rhProfile!.promotionSend = true;
                    await em.persist(userEntity).flush();
                    results.push({ discordId, success: true });
                } catch (err: any) {
                    results.push({ discordId, success: false, error: err.message });
                }
            }
            
            res.json({ success: true, results });
        } catch (err) {
            next(err);
        }
    });

    router.post('/annonce', upload.none(), async (req: Request<{}, {}, UserListDto>, res, next) => {
        try {
            const discordIds = parseStringArrayField((req.body as any).discordIds, 'discordIds');
            if (!discordIds.length) throw new Error('discordIds array required');

            const em = bot.dbMgr.getEm();
            const ranksDb = await em.find(Rank, {}, { populate: ['roleDiscord'] });

            for (const discordId of discordIds) {
                try {
                    const member = await bot.guild.members.fetch(discordId);
                    if (!member) throw new Error(`Membre Discord ${discordId} introuvable`);

                    const rank = await em.findOneOrFail(Rank, { rHMembers: { user: { discordId } } });

                    for (const rankRole of ranksDb) {
                        if (member.roles.cache.has(rankRole.roleDiscord?.discordId ?? '') && rankRole.id !== rank.id) {
                            await member.roles.remove(rankRole.roleDiscord?.discordId ?? '', 'Changement de grade RH');
                        }
                    }

                    if (rank.roleDiscord?.discordId) {
                        await member.roles.add(rank.roleDiscord.discordId, 'Promotion RH');
                    } else {
                        throw new Error(`Le grade ${rank.name} n'a pas de rôle Discord associé`);
                    }
                    
                    const embed = {
                        title: "✅ Promotion acceptée",
                        description: `Félicitations pour ta promotion au grade de **${rank.name}** !`,
                        color: 0x00FF00, // vert
                        thumbnail: {
                            url: member.user.displayAvatarURL({ size: 256 }), // ou ton URL custom
                        },
                        fields: [
                            {
                            name: "Membre",
                            value: member.displayName,
                            inline: false,
                            },
                            {
                            name: "Nouveau Grade",
                            value: rank.name,
                            inline: true,
                            },
                        ],
                        timestamp: new Date().toISOString(),
                    };  

                    const dmChannel = await member.createDM();
                    await dmChannel.send({ embeds: [embed] });
                    const memberRh = await em.findOneOrFail(RHMember, { user: { discordId } });
                    memberRh.promotionSend = false;
                    await em.persist(memberRh).flush();

                } catch (err: Error | any) {
                await httpLogger.error({ msg: `Erreur pour le membre ${discordId}`, err });
                }
            }
            res.json({ success: true });
        } catch (err) {
            next(err);
        }
    });
    return router;

}