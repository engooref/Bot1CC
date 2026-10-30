import { TSMigrationGenerator } from '@mikro-orm/migrations';

const ALLOWED_TABLES = ['view_context', 'diplomatie_corporation', 'diplomatie_demande'];  // tableName en base

export class FilteredMigrationGenerator extends TSMigrationGenerator {

  generateMigrationFile(className: string, diff: { up: string[]; down: string[] }): string {
    // on ne garde que les statements touchant nos tables “autorisées”
    diff.up   = diff.up.filter(sql => this.isAllowed(sql));
    diff.down = diff.down.filter(sql => this.isAllowed(sql));
    return super.generateMigrationFile(className, diff);
  }

  private isAllowed(sql: string): boolean {
    return ALLOWED_TABLES.some(tbl =>
      new RegExp(`\\b${tbl}\\b`, 'i').test(sql)
    );
  }
  
}
