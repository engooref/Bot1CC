import fs from 'fs';
import path from 'path';

/** Extensions d'image acceptées pour les visuels d'opération, par ordre de priorité. */
export const OPERATION_VISUAL_EXTENSIONS = ['.png', '.jpg', '.jpeg'] as const;

/**
 * Cherche `<dossier>/<nom>` avec l'une des extensions acceptées (png, puis jpg, puis jpeg).
 * La casse de l'extension est ignorée (`.JPG` fonctionne sur un serveur Linux).
 * Retourne le chemin du premier fichier trouvé, ou null.
 */
export function findOperationVisual(dir: string, baseName: string): string | null {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }

  for (const extension of OPERATION_VISUAL_EXTENSIONS) {
    const wanted = `${baseName}${extension}`.toLowerCase();
    const match = entries.find((entry) => entry.toLowerCase() === wanted);
    if (match) {
      return path.join(dir, match);
    }
  }
  return null;
}
