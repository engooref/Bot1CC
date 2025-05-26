// src/entities/SCLocationsType.ts
import {
  Entity,
  PrimaryKey,
  Property,
  OneToMany,
  Collection,
} from '@mikro-orm/core';
import { SCLocations } from './SCLocations.js';

@Entity({ tableName: 'sclocations_type' })
export class SCLocationsType {

  @PrimaryKey()
  id!: number;

  @Property({ length: 255 })
  name!: string;

  /** Liste des emplacements rattachés à ce type */
  @OneToMany(() => SCLocations, loc => loc.type)
  locations = new Collection<SCLocations>(this);

  /**
   * @param name Nom du type de location
   */
  constructor(name: string) {
    this.name = name;
  }

  toString(): string {
    return this.name;
  }

}
