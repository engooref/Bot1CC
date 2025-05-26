// src/entities/Channel.ts
import { Entity, PrimaryKey, Property } from '@mikro-orm/core';


@Entity({ tableName: 'channel' })
export class Channel {

  @PrimaryKey()
  id!: number;

  @Property({ type: 'bigint', fieldName: 'discord_id' })
  discordId!: string;

  @Property({ length: 255 })
  name!: string;

  /**
   * @param name        Le nom du channel
   * @param discordId   L’ID Discord du channel (string ou number)
   */
  constructor(name: string, discordId: string | number) {
    this.name = name;
    // on stocke les bigints en string pour éviter les limites JS
    this.discordId = String(discordId);
  }

}
