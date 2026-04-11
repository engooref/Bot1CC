import { Router, Request } from 'express';
import { BotManager } from '../../BotManager.js';
import { User } from '../../entities/core/User.js';
import multer from 'multer';
import { Role } from '../../entities/core/Role.js';


export interface UserDto {
  discordId: string;
}

export interface UserListDto {
  discordIds: string[] | string; // multipart => string JSON possible
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

function parseStringField(v: unknown, fieldName: string): string {
  const s = String(v ?? '').trim();
  if (!s) throw new Error(`${fieldName} required`);
  return s;
}

export default function createUserRouter(bot: BotManager): Router {
  
  const router = Router();

  router.use(async (_req, res, next) => {
    try {
      await bot.refreshParameters();
      next();
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Bot -> Erreur lors de la vérification des paramètres.', error: err?.message });
    }
  });
  

  router.post('/candidature', upload.none(), async (req: Request<{}, {}, UserDto>, res, next) => {
    try {
      const discordId = parseStringField((req.body as any).discordId, 'discordId');

      const em = bot.db.getEm();
      const syncResult = await syncUserRoles(discordId, em);
      if (!syncResult.success) throw new Error(syncResult.error);

      // Modifie le pseudo pour ajouter [1CC] devant si absent
      const member = await bot.guild.members.fetch(discordId);
      let newNickname = member.displayName;
      if (!newNickname.startsWith('[1CC]')) {
        newNickname = `[1CC] ${newNickname}`;
        await member.setNickname(newNickname);
      }

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/sync-batch', upload.none(), async (req: Request<{}, {}, UserListDto>, res, next) => {
    try {
      const discordIds = parseStringArrayField((req.body as any).discordIds, 'discordIds');
      if (!discordIds.length) throw new Error('discordIds array required');

      const em = bot.db.getEm();
      const results: Record<string, any> = {};

      for (const discordId of discordIds) {
        results[discordId] = await syncUserRoles(discordId, em);
      }

      res.json({ success: true, results });
    } catch (err) {
      next(err);
    }
  });

  router.post('/sync', upload.none(), async (req: Request<{}, {}, UserDto>, res, next) => {
    try {
      const discordId = parseStringField((req.body as any).discordId, 'discordId');

      const em = bot.db.getEm();
      const syncResult = await syncUserRoles(discordId, em);
      if (!syncResult.success) throw new Error(syncResult.error);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });


  // --- Fonction utilitaire (inchangée côté logique)
  async function syncUserRoles(discordId: string, em: any): Promise<{ success: boolean; error?: string }> {
    try {
      const member = await bot.guild.members.fetch(discordId);
      const user = await em.findOne(User, { discordId }, { populate: ['rolesDiscord'] });

      if (!user) throw new Error('Utilisateur non trouvé en BDD');

      const discordRoleIds = member.roles.cache.map((r: any) => r.id);
      const dbRoleIds = user.rolesDiscord.getItems().map((r: any) => r.discordId);

      const toAdd = dbRoleIds.filter((id: string) => !discordRoleIds.includes(id));
      const toRemove = discordRoleIds.filter((id: string) => !dbRoleIds.includes(id));

      if (toAdd.length) await member.roles.add(toAdd);

      if (toRemove.length) {
        const rolesDb = await em.find(Role, { discordId: { $in: toRemove } });

        // ton filtrage existant (si présent)
        const filtered = rolesDb
          .filter((r: any) => r.isRh === true) // exemple si tu as ce champ
          .map((r: any) => r.discordId);

        if (filtered.length) {
          await member.roles.remove(filtered);
        } else {
          await member.roles.remove(toRemove);
        }
      }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  
  return router;
}
