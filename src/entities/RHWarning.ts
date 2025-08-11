import { Entity, PrimaryKey, ManyToOne, Property, Rel } from '@mikro-orm/core';
import { RHMember } from './RHMember.js';

@Entity({ tableName: 'rhwarning' })
export class RHWarning {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => RHMember, { nullable: false })
  member!: Rel<RHMember>;

  @Property({ type: 'text' })
  message!: string;

  @Property({ type: 'datetime', nullable: false })
  issuedAt: Date = new Date();
}
