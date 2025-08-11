import { Entity, PrimaryKey, ManyToOne, Property, Rel } from '@mikro-orm/core';
import { RHMember } from './RHMember.js';

@Entity({ tableName: 'rhabsence' })
export class RHAbsence {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => RHMember, { nullable: false })
  member!: Rel<RHMember>;

  @Property({ type: 'datetime', nullable: false })
  startDate!: Date;

  @Property({ type: 'datetime', nullable: false })
  endDate!: Date;

  @Property({ type: 'text', nullable: true })
  reason?: string;
}
