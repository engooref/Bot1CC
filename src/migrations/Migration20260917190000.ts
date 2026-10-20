import { Migration } from '@mikro-orm/migrations';

export class Migration20260917190000 extends Migration {
    override async up(): Promise<void> {
        this.addSql('alter table `recrutement_demande` add `postulant_channel_access` json null;');
    }

    override async down(): Promise<void> {
        this.addSql('alter table `recrutement_demande` drop column `postulant_channel_access`;');
    }
}
