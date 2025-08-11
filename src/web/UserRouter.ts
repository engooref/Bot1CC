import { Router, Request } from 'express';
import BotManager from '../BotManager.js';
import { User } from '../entities/User.js';
import multer from 'multer';
import { Role } from '../entities/Role.js';


// DTO pour les requêtes utilisateur
export interface UserDto {
    discordId: string;
}

export interface UserListDto {
    discordIds: string[];
}

const upload = multer({ storage: multer.memoryStorage() });

export function createUserRouter(bot: BotManager): Router {
  
  
  const router = Router();

  router.use(async (req, res, next) => {
    try {
      await bot.refreshParameters();
      const param = bot.getParameter('PARAM_DISCORD');
      const discordUpdate = req.body?.discordUpdate ?? 'N';
      if (param !== 'O' || discordUpdate !== 'O') {
        res.status(403).json({ success: false, message: 'Modifications Discord désactivées par configuration.' });
        return;
      }
      
      next();
    } catch (err: any) {
      res.status(500).json({ success: false, message: 'Erreur interne lors de la vérification des paramètres.', error: err?.message });
    }
  });
  

  // Modifie le pseudo d'un utilisateur
  router.post('/candidature', upload.none(), async (req: Request<{}, {}, UserDto>, res, next) => {
    const { discordId } = req.body;
    try {
        
        const em = bot.dbMgr.getEm();
        // Synchronise les rôles
        const syncResult = await syncUserRoles(discordId, em);
        if (!syncResult.success) throw new Error(syncResult.error);

        // Modifie le pseudo pour ajouter [1CC] devant si absent
        const member = await bot.guild.members.fetch(discordId);
        let newNickname = member.displayName;
        if (!newNickname.startsWith('[1CC]')) {
          newNickname = `[1CC] ${newNickname}`;
          await member.setNickname(newNickname);
        }
        res.json({ success: true, message: `Rôles synchronisés et pseudo modifié pour l'utilisateur ${discordId}` });
    } catch (err) {
        next(err);
    }
  });

    // Synchronise les rôles de plusieurs utilisateurs
  router.post('/sync-batch', upload.none(), async (req: Request<{}, {}, UserListDto>, res, next) => {
    try {
        // Vérifie le paramètre du bot avant toute modification Discord
        

        const { discordIds } = req.body;
        if (!Array.isArray(discordIds) || discordIds.length === 0) {
            throw new Error('discordIds array required');
        }
        const em = bot.dbMgr.getEm();
        const results: { discordId: string; success: boolean; error?: string }[] = [];
        for (const discordId of discordIds) {
            try {
                const result = await syncUserRoles(discordId, em);
                results.push({ discordId, ...result });
            } catch (err: any) {
                results.push({ discordId, success: false, error: err.message });
            }
        }
        res.json({ success: true, results });
    } catch (err) {
      next(err);
    }
  });


  // Synchronise les rôles d'un utilisateur
  router.post('/sync', upload.none(), async (req: Request<{}, {}, UserDto>, res, next) => {
    try {
      const { discordId } = req.body;
      

      const em = bot.dbMgr.getEm();
      const result = await syncUserRoles(discordId, em);
      if (result.success) {
        res.json({ success: true, message: `Rôles synchronisés pour l'utilisateur ${discordId}` });
      } else {
        next(new Error(result.error));
      }
    } catch (err) {
      next(err);
    }
  });


  // Fonction utilitaire pour synchroniser les rôles d'un utilisateur
  async function syncUserRoles(discordId: string, em: any): Promise<{ success: boolean; error?: string }> {
    try {
        const member = await bot.guild.members.fetch(discordId);
        const user = await em.findOne(User, { discordId }, { populate: ['rolesDiscord'] });

        if (!user) throw new Error('Utilisateur non trouvé en BDD');

        const discordRoleIds = member.roles.cache.map((r: any) => r.id);
        const dbRoleIds = user.rolesDiscord.getItems().map((r: any) => r.discordId);
        const toAdd = dbRoleIds.filter((id: string) => !discordRoleIds.includes(id));

        if (toAdd.length) await member.roles.add(toAdd);

        // Gestion spéciale pour le rôle "membre"
        const memberRoleId = bot.roleMember?.id;
        const toRemove = discordRoleIds.filter((id: string) => !dbRoleIds.includes(id));
        if (toRemove.length) {
          if (memberRoleId && toRemove.includes(memberRoleId)) {
            // Ajoute le rôle membre en BDD si on tente de le retirer
            const dbRole = await em.findOne(Role, { discordId: memberRoleId });
            if (dbRole && !user.rolesDiscord.contains(dbRole)) {
              user.rolesDiscord.add(dbRole);
              await em.persistAndFlush(user);
            }
            // Retire les autres rôles sauf membre
            const filtered = toRemove.filter((id: string) => id !== memberRoleId);
            if (filtered.length) await member.roles.remove(filtered);
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