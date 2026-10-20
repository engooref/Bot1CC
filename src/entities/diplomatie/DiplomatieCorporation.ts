import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core';

/** Corporation et salon permanent utilisé pour ses échanges diplomatiques. */
@Entity({ tableName: 'diplomatie_corporation' })
@Unique({ name: 'diplomatie_corporation_guild_name_unique', properties: ['guildId', 'name'] })
export class DiplomatieCorporation {
    @PrimaryKey()
    id!: number;

    @Property({ length: 20 })
    guildId!: string;

    @Property({ length: 100 })
    name!: string;

    /** Salon créé ou salon existant associé à la corporation. */
    @Property({ length: 20, unique: true })
    channelId!: string;

    @Property({ type: Date })
    createdAt: Date = new Date();
}
