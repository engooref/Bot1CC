// src/entities/Role.ts
import {
  Entity,
  PrimaryKey,
  Property,
  OneToMany,
  ManyToMany,
  Collection,
} from '@mikro-orm/core';
import { RHMember }  from './RHMember.js';
import { Parameter } from './Parameter.js';
import { User }      from './User.js';

@Entity({ tableName: 'role' })
export class Role {

  @PrimaryKey()
  id!: number;

  /** ID Discord stocké en string pour gérer les bigints */
  @Property({ type: 'bigint', fieldName: 'discord_id' })
  discordId!: string;

  @Property({ length: 255 })
  name!: string;

  @Property({ type: 'boolean' })
  isGrade: boolean = false;

  /** Profils RH liés (One-To-Many) */
  @OneToMany(() => RHMember, rh => rh.grade)
  rHMembers = new Collection<RHMember>(this);

  /** Paramètres associés (Many-To-Many) */
  @ManyToMany(() => Parameter, parameter => parameter.roles)
  parameters = new Collection<Parameter>(this);

  /** Utilisateurs liés (Many-To-Many) */
  @ManyToMany(() => User, user => user.rolesDiscord)
  users = new Collection<User>(this);

  /**
   * @param name       Nom du rôle
   * @param discordId  ID Discord (string ou number)
   * @param isGrade    Indique s’il s’agit d’un grade RH
   */
  constructor(name: string, discordId: string | number, isGrade = false) {
    this.name      = name;
    this.discordId = String(discordId);
    this.isGrade   = isGrade;
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
