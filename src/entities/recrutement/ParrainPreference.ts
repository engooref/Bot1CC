import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core';

// Schéma géré par Site1CC, ne pas migrer ici.
@Entity({ tableName: 'recruitment_mentor_preference' })
@Unique({ properties: ['guildId', 'userId'] })
export class ParrainPreference {
    @PrimaryKey() id!: number;
    @Property({ length: 20 }) guildId!: string;
    @Property({ length: 20 }) userId!: string;
    @Property() capacity = 2;
    @Property() paused = false;
    @Property({ nullable: true, type: Date }) returnAt?: Date;
    @Property({ type: 'text', nullable: true }) reason?: string;
    @Property({ nullable: true, type: Date }) remindedAt?: Date;
    @Property({ type: 'json' }) history: { actorId: string; at: string; action: string }[] = [];
}
