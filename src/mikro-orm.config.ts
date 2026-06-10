import 'reflect-metadata';
import 'dotenv/config';
import { defineConfig, FlushMode, UnderscoreNamingStrategy } from '@mikro-orm/mysql';
import { FilteredMigrationGenerator} from './FilteredMigrationGenerator.js';

const isProd = process.env.NODE_ENV === 'prod';
const logMikro = process.env.LOG_MIKRO === 'true';
export default defineConfig({
  clientUrl: process.env.MYSQL_URL!,

  // en dev on peut garder le TsMorph pour auto-complétion,  
  // mais en prod on passe au provider par défaut
  metadataProvider: isProd 
    ? undefined 
    : (await import('@mikro-orm/reflection')).TsMorphMetadataProvider,

  // en prod on ne regarde plus en .ts
  entitiesTs: !isProd ? ['src/entities/**/*.ts'] : [],
  // EN PROD (JavaScript compilé) :
  entities:   isProd ? ['dist/src/entities/**/*.js'] : [],
  flushMode: FlushMode.COMMIT,
  
  debug: logMikro,
  namingStrategy: UnderscoreNamingStrategy,

  migrations: {
    path: './dist/migrations',              // dossier compilé JS
    pathTs: './src/migrations',             // dossier TS
    glob: '!(*.d).{js,ts}',                 // ignore les .d.ts
    emit: 'ts',                             // génère des migrations en TS
    transactional: false,      
    allOrNothing: true,                     // rollback complet si erreur
    disableForeignKeys: true,               // désactive temporairement les FK lors du up/down
    generator: FilteredMigrationGenerator,  // notre filtre pour ne garder que certaines tables
  },
});
