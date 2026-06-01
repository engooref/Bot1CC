import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  type Rel,
} from '@mikro-orm/core';
import { User } from '../core/User.js';
import { CelestialBody } from '../../entities/operations/CelestialBody.js';


export enum MiningSessionStatus {
  OPEN = 'open',
  ACTIVE = 'active',
  CLOSED = 'closed',
}

@Entity({ tableName: 'mining_session' })
export class MiningSession {
  @PrimaryKey()
  id!: number;

  @Property({ length: 255 })
  name: string = '';

  @ManyToOne(() => CelestialBody, { nullable: true })
  defaultBody?: Rel<CelestialBody> | null;

  @ManyToOne(() => User, { nullable: false })
  createdBy!: Rel<User>;

  @Property({ default: false })
  operationCreated: boolean = false;

}
