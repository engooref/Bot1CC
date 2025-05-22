// src/entities/SCLocations.ts
import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  OneToMany,
  Collection,
} from '@mikro-orm/core';
import { SCLocationsType } from './SCLocationsType.js';

@Entity({ tableName: 'sclocations' })
export class SCLocations {

  @PrimaryKey()
  id!: number;

  @Property({ length: 255, default: '' })
  name: string = '';

  @Property({ length: 255, default: '' })
  designation: string = '';

  /**
   * Many-to-One vers SCLocationsType
   * on précise inversedBy pour le côté inverse
   */
  @ManyToOne(() => SCLocationsType, { inversedBy: 'locations' })
  type!: SCLocationsType;

  /**
   * Many-to-One vers le parent (nullable)
   * on indique inversedBy pour la collection inverse `children`
   */
  @ManyToOne(() => SCLocations, { nullable: true, inversedBy: 'children' })
  parent?: SCLocations;

  /**
   * One-to-Many vers les enfants
   * mappedBy via la propriété `parent`
   */
  @OneToMany(() => SCLocations, loc => loc.parent)
  children = new Collection<SCLocations>(this);

  constructor(init?: Partial<SCLocations>) {
    if (init) {
      Object.assign(this, init);
      // si on passe un tableau `children`, on l’instancie dans la Collection
      if (Array.isArray(init.children)) {
        this.children = new Collection<SCLocations>(this, init.children);
      }
    }
  }

  toString(): string {
    return `${this.name} (${this.designation})`;
  }
}
