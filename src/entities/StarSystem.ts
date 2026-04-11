import {
  Collection,
  Entity,
  OneToMany,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import { CelestialBody } from './CelestialBody.js';

@Entity({ tableName: 'starmap_system' })
export class StarSystem {

  @PrimaryKey()
  id!: number;

  @Property({ length: 255 })
  name: string = '';

  @OneToMany(() => CelestialBody, (body) => body.system)
  bodies = new Collection<CelestialBody>(this);

  toString(): string {
    return this.name;
  }
}
