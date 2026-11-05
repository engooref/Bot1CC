// Crée, dans la base de DÉVELOPPEMENT LOCAL, les tables que le bot possède lui-même et que le schéma du site ne contient pas :
// view_context, diplomatie_corporation, diplomatie_demande (la même liste que src/FilteredMigrationGenerator.ts).
// Les autres tables viennent des migrations de Site1CC. Aucune table existante n'est modifiée, rien n'est supprimé.
// Usage : node scripts/dev-init-tables.mjs          (affiche seulement ce qui serait créé)
//         node scripts/dev-init-tables.mjs --run    (crée les tables absentes)
// Demande le code compilé : npm run build d'abord. Voir docs/test-local.md.
import 'dotenv/config';
import { MikroORM } from '@mikro-orm/mysql';
import config from '../dist/src/mikro-orm.config.js';

const TABLES = ['view_context', 'diplomatie_corporation', 'diplomatie_demande'];
const HOTES_LOCAUX = ['host.docker.internal', 'localhost', '127.0.0.1', 'db'];
const executer = process.argv.includes('--run');

// Garde-fou : ce script ne doit jamais viser une autre base que celle du poste de développement.
const hote = new URL(process.env.MYSQL_URL ?? '').hostname;
if (!HOTES_LOCAUX.includes(hote)) {
  console.error(`Refus : MYSQL_URL vise « ${hote} », qui n'est pas une base locale (${HOTES_LOCAUX.join(', ')}).`);
  process.exit(2);
}

const orm = await MikroORM.init(config);
try {
  const connexion = orm.em.getConnection();
  const absentes = [];
  for (const table of TABLES) {
    const lignes = await connexion.execute('SHOW TABLES LIKE ?', [table]);
    if (lignes.length === 0) absentes.push(table);
  }
  if (absentes.length === 0) {
    console.log('Rien à créer : les tables du bot existent déjà.');
  } else {
    const sql = await orm.getSchemaGenerator().getUpdateSchemaSQL({ wrap: false, safe: true, dropTables: false });
    const cible = new RegExp(`^(create table|alter table)\\s+\`?(${absentes.join('|')})\`?[\\s(]`, 'i');
    const requetes = sql
      .split(/;\s*\n/)
      .map((r) => r.trim().replace(/;$/, ''))
      .filter((r) => cible.test(r));
    if (requetes.length === 0) {
      console.error(`Aucune requête de création trouvée pour : ${absentes.join(', ')}. Compare avec « npm run mikro-orm -- schema:update --dump » avant d'aller plus loin.`);
      process.exitCode = 1;
    } else {
      console.log(`Tables absentes : ${absentes.join(', ')}`);
      for (const requete of requetes) {
        console.log(`${executer ? 'EXÉCUTE' : 'À CRÉER '} ${requete.split('\n')[0].slice(0, 120)}`);
        if (executer) await connexion.execute(requete);
      }
      if (!executer) console.log('Aucune modification faite. Relance avec --run pour créer ces tables.');
    }
  }
} finally {
  await orm.close();
}
