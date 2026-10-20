// src/entities/Role.ts
import {
  Entity,
  PrimaryKey,
  Property,
  ManyToMany,
  Collection,
  OneToOne,
  Rel,
} from '@mikro-orm/core';
import { User }      from './User.js';
import { Rank } from './Rank.js';

@Entity({ tableName: 'role' })
export class Role {
  @OneToOne(() => Rank, rank => rank.roleDiscord, { nullable: true })
  rank?: Rel<Rank>;

  @PrimaryKey()
  id!: number;

  /** ID Discord stocké en string pour gérer les bigints */
  @Property({ fieldName: 'discord_id' })
  discordId!: string;

  @Property({ length: 255 })
  name!: string;

  /** Utilisateurs liés (Many-To-Many) */
  @ManyToMany(() => User, user => user.rolesDiscord)
  users = new Collection<User>(this);

  /**
   * @param name       Nom du rôle
   * @param discordId  ID Discord (string ou number)
   */
  constructor(name: string, discordId: string | number) {
    this.name      = name;
    this.discordId = String(discordId);

  }

  /** Comparaison basée sur l’ID Discord */
  equals(other: unknown): boolean {
    return other instanceof Role && other.discordId === this.discordId;
  }

  /** Hash simplifié pour collections ou maps */
  hash(): string {
    return this.discordId;
  }

  toString(): string {
    return this.name;
  }

}
