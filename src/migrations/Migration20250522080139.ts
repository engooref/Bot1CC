import { Migration } from '@mikro-orm/migrations';

export class Migration20250522080139 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table \`view_context\` (\`id\` int unsigned not null auto_increment primary key, \`message_id\` varchar(255) not null, \`channel_id\` varchar(255) not null, \`custom_id\` varchar(255) not null, \`handler_key\` varchar(255) not null, \`component_type\` enum('button', 'select') not null, \`data\` text not null) default character set utf8mb4 engine = InnoDB;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists \`view_context\`;`);
  }

}
