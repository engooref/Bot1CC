// src/entities/RHMember.ts
import {
  Entity,
  PrimaryKey,
  Property,
  OneToOne,
  ManyToOne,
  type Rel,
} from '@mikro-orm/core';
// ← IMPORT NORMAL pour le runtime
import { User } from './User.js';
import { Role } from './Role.js';

@Entity({ tableName: 'rhmember' })
export class RHMember {

  @PrimaryKey()
  id!: number;

  @OneToOne(() => User, user => user.rhProfile, { owner: true, nullable: true, orphanRemoval: true })
  user?: Rel<User>;

  @Property({ length: 255, default: 'Actif' })
  status: string = 'Actif';

  @Property({ type: 'datetime', nullable: true, defaultRaw: 'CURRENT_TIMESTAMP' })
  lastPromotion?: Date;

  @ManyToOne(() => Role, { inversedBy: 'rHMembers', nullable: true })
  grade?: Rel<Role>;

  @Property({ type: 'datetime', nullable: false, defaultRaw: "'1970-01-01 00:00:00'" })
  dateEntree: Date = new Date(0);

  @Property({ type: 'datetime', nullable: false, defaultRaw: "'1970-01-01 00:00:00'" })
  dateDemand: Date = new Date(0);


}
