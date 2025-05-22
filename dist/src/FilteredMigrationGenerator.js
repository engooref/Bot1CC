import { TSMigrationGenerator } from '@mikro-orm/migrations';
const ALLOWED_TABLES = ['view_context']; // tableName en base
export class FilteredMigrationGenerator extends TSMigrationGenerator {
    generateMigrationFile(className, diff) {
        // on ne garde que les statements touchant nos tables “autorisées”
        diff.up = diff.up.filter(sql => this.isAllowed(sql));
        diff.down = diff.down.filter(sql => this.isAllowed(sql));
        return super.generateMigrationFile(className, diff);
    }
    isAllowed(sql) {
        return ALLOWED_TABLES.some(tbl => new RegExp(`\\b${tbl}\\b`, 'i').test(sql));
    }
}
//# sourceMappingURL=FilteredMigrationGenerator.js.map