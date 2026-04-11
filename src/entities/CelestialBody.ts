import {
  Collection,
  Entity,
  Enum,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
  Unique,
  type Rel,
} from '@mikro-orm/core';
import { StarSystem } from './StarSystem.js';

export enum CelestialBodyType {
  PLANET = 'PLANET',
  MOON = 'MOON',
  ASTEROID = 'ASTEROID',
}

@Entity({ tableName: 'starmap_body' })
@Unique({ properties: ['type', 'externalId'] })
export class CelestialBody {

  @PrimaryKey()
  id!: number;

  @ManyToOne(() => StarSystem, { nullable: false, deleteRule: 'cascade', inversedBy: 'bodies' })
  system!: Rel<StarSystem>;

  @ManyToOne(() => CelestialBody, { nullable: true, deleteRule: 'cascade', inversedBy: 'moons' })
  parent?: Rel<CelestialBody> | null;

  @OneToMany(() => CelestialBody, (body) => body.parent)
  moons = new Collection<CelestialBody>(this);

  @Enum({ items: () => CelestialBodyType })
  type: CelestialBodyType = CelestialBodyType.PLANET;

  @Property({ length: 255 })
  name: string = '';

  @Property({ nullable: true })
  externalId?: number | null;

  toString(): string {
    return this.name;
  }
}
