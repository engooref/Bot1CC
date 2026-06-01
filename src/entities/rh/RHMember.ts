// src/entities/RHMember.ts
import {
  Entity,
  PrimaryKey,
  Property,
  OneToOne,
  ManyToOne,
  type Rel,
  OneToMany,
  ManyToMany,
  Collection,
} from '@mikro-orm/core';
// ← IMPORT NORMAL pour le runtime
import { User } from '../core/User.js';
import { RHLog } from './RHLog.js';
import { RHAbsence } from './RHAbsence.js';
import { RHWarning } from './RHWarning.js';
import { Certifications } from '../certifications/Certifications.js';
import { Rank } from '../core/Rank.js';
import { ObjectifsAward } from './ObjectifAward.js';
import { Pole } from '../core/Pole.js';
import { CertifRequest } from '../certifications/CertifRequest.js';

@Entity({ tableName: 'rhmember' })
export class RHMember {

  @PrimaryKey()
  id!: number;

  @OneToOne(() => User, user => user.rhProfile, { owner: true, nullable: true, orphanRemoval: true })
  user?: Rel<User>;

  @Property({ length: 255, default: 'Actif' })
  status: string = 'Actif';

  @Property({ type: 'datetime', nullable: false })
  lastPromotion?: Date = new Date(0);

  @Property({ type: 'datetime', nullable: false, defaultRaw: "'1970-01-01 00:00:00'" })
  dateEntree: Date = new Date(0);

  @OneToMany(() => RHLog, (log: RHLog) => log.member)
  logs = new Collection<RHLog>(this);

  @OneToMany(() => RHAbsence, (absence: RHAbsence) => absence.member)
  abscences = new Collection<RHAbsence>(this);

  @OneToMany(() => RHWarning, (warning: RHWarning) => warning.member)
  warnings = new Collection<RHWarning>(this);

  @Property({ type: 'json', nullable: true })
  jsonEntrer?: any[];

  @ManyToOne(() => Rank, { inversedBy: 'rHMembers', nullable: true })
  grade?: Rel<Rank> | null = null;

  @ManyToMany(() => Certifications, certification => certification.rHMembers, { owner: true, pivotTable: 'rhmember_certifications' })
  certifications = new Collection<Certifications>(this);

  @ManyToOne(() => Rank, { inversedBy: 'memberApproval', nullable: true })
  pendingApproval?: Rel<Rank> | null = null;

  @Property({ nullable: false })
  promotionSend: boolean = false;

  @OneToMany(() => ObjectifsAward, (objectifsAward: ObjectifsAward) => objectifsAward.member)
  @OneToMany(() => ObjectifsAward, (objectifsAward: ObjectifsAward) => objectifsAward.member, { orphanRemoval: true })
  objectifsAwards = new Collection<ObjectifsAward>(this);

  @ManyToMany(() => Pole, pole => pole.rHMembers, { owner: true, pivotTable: 'rhmember_pole' })
  poles = new Collection<Pole>(this);

  @OneToMany(() => CertifRequest, (req) => req.member)
  certifRequests? = new Array<CertifRequest>();

}
