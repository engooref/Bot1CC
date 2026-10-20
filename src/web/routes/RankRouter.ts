import { SettingKeys } from '../../constants/SettingKeys.js';
import { settingsService } from '../../services/SettingsService.js';
import { Router, Request } from 'express';
import { BotManager } from '../../BotManager.js';
import multer from 'multer';
import { TextBasedChannel, TextChannel } from 'discord.js';
import { User } from '../../entities/core/User.js';
import { Role } from 'discord.js';
import PromotionsView from '../../view/PromotionsView.js';
import { Rank } from '../../entities/core/Rank.js';
import { httpLogger } from '../../logger.js';
import { RHMember } from '../../entities/rh/RHMember.js';


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

function isPromotionBasedOnHierarchy(oldGrade: Rank | null | undefined, newGrade: Rank): boolean {
  if (!oldGrade) return true;

  // Parcours la hiérarchie de newGrade pour voir si oldGrade est un ancêtre (promotion)
  let current: Rank | null | undefined = newGrade.baseRank;
  while (current) {
    if (current.id === oldGrade.id) return true;
    current = current.baseRank;
  }

  // Parcours la hiérarchie d'oldGrade pour voir si newGrade est un ancêtre (rétrogradation)
  current = oldGrade.baseRank;
  while (current) {
    if (current.id === newGrade.id) return false;
    current = current.baseRank;
  }

  // Si pas de relation hiérarchique trouvée, utilise l'ID comme fallback
  return oldGrade.id < newGrade.id;
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

            const em = bot.db.getEm();
            // Récupère le channel RH nommé Promotions
            const channelRh = bot.guild.channels.cache.get(await settingsService.getString(SettingKeys.bot.channels.rh)) as TextChannel;
            

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

            const rhRole = bot.guild.roles.cache.get(await settingsService.getString(SettingKeys.site.roles.rh)) as Role;
                    
            
            const results: { discordId: string; success: boolean; error?: string }[] = [];

            for (const promotion of promotions) {
                const { discordId, rank: rankName } = promotion;
                try {
                    // Récupère l'utilisateur Discord
                    const member = await bot.guild.members.fetch(discordId);
                    // Récupère le rank (à adapter selon ta logique métier)
                    const userEntity = await em.findOneOrFail(User, { discordId }, { populate: ['rhProfile', 'rhProfile.grade', 'rhProfile.grade.baseRank'] });
                    if (userEntity.rhProfile?.promotionSend) continue;

                    const oldGrade = userEntity.rhProfile?.grade;
                    const oldRankName = oldGrade?.name ?? bot.roleMember?.name ?? 'Aucun';

                    // Récupère le nouveau rank
                    const newGrade = await em.findOne(Rank, { name: rankName }, { populate: ['baseRank'] });
                    if (!newGrade) throw new Error(`Grade ${rankName} introuvable`);

                    // Détermine si c'est une promotion ou une rétrogradation via la hiérarchie
                    const isPromotion = isPromotionBasedOnHierarchy(oldGrade, newGrade);
                    const titleEmoji = isPromotion ? "📈" : "📉";
                    const titleText = isPromotion ? "Promotion disponible" : "Rétrogradation";
                    const fieldLabel = isPromotion ? "Promotion possible" : "Rétrogradation proposée";

                    // Crée l'embed
                    const embed = {
                        title: `${titleEmoji} ${titleText}`,
                        description: `${rhRole?.toString() || ''}`,
                        color: isPromotion ? 0x00FF00 : 0xFF8C00, // vert pour promotion, orange pour rétrogradation
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
                            value: oldRankName ?? "Non défini",
                            inline: true,
                            },
                            {
                            name: fieldLabel,
                            value: rankName,
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

            const em = bot.db.getEm();
            const ranksDb = await em.find(Rank, {}, { populate: ['roleDiscord', 'baseRank'] });

            for (const discordId of discordIds) {
                try {
                    const member = await bot.guild.members.fetch(discordId);
                    if (!member) throw new Error(`Membre Discord ${discordId} introuvable`);

                    const memberRhData = await em.findOneOrFail(RHMember, { user: { discordId } }, { populate: ['grade', 'grade.baseRank'] });
                    const oldGrade = memberRhData.grade;
                    const newGrade = await em.findOneOrFail(Rank, { rHMembers: { user: { discordId } } }, { populate: ['baseRank'] });

                    const isPromotion = isPromotionBasedOnHierarchy(oldGrade, newGrade);
                    const titleEmoji = isPromotion ? "✅" : "⚠️";
                    const titleText = isPromotion ? "Promotion acceptée" : "Rétrogradation appliquée";
                    const message = isPromotion
                        ? `Félicitations pour ta promotion au grade de **${newGrade.name}** !`
                        : `Vous avez été rétrogradé au grade de **${newGrade.name}**.`;
                    const color = isPromotion ? 0x00FF00 : 0xFF8C00; // vert pour promotion, orange pour rétrogradation

                    for (const rankRole of ranksDb) {
                        if (member.roles.cache.has(rankRole.roleDiscord?.discordId ?? '') && rankRole.id !== newGrade.id) {
                            await member.roles.remove(rankRole.roleDiscord?.discordId ?? '', 'Changement de grade RH');
                        }
                    }

                    if (newGrade.roleDiscord?.discordId) {
                        await member.roles.add(newGrade.roleDiscord.discordId, 'Changement de grade RH');
                    } else {
                        throw new Error(`Le grade ${newGrade.name} n'a pas de rôle Discord associé`);
                    }

                    const embed = {
                        title: `${titleEmoji} ${titleText}`,
                        description: message,
                        color: color,
                        thumbnail: {
                            url: member.user.displayAvatarURL({ size: 256 }), // ou ton URL custom
                        },
                        fields: [
                            {
                            name: "Membre",
                            value: member.displayName,
                            inline: false,
                            },
                            ...(oldGrade ? [{
                                name: "Ancien Grade",
                                value: oldGrade.name,
                                inline: true,
                            }] : []),
                            {
                            name: "Nouveau Grade",
                            value: newGrade.name,
                            inline: true,
                            },
                        ],
                        timestamp: new Date().toISOString(),
                    };  

                    const dmChannel = await member.createDM();
                    await dmChannel.send({ embeds: [embed] });
                    memberRhData.promotionSend = false;
                    await em.persist(memberRhData).flush();

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