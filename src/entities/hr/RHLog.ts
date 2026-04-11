import { Entity, PrimaryKey, ManyToOne, Property, Rel } from '@mikro-orm/core';
import { RHMember } from './RHMember.js';

@Entity({ tableName: 'rhlog' })
export class RHLog {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => RHMember, { nullable: false })
  member!: Rel<RHMember>;

  @Property({ type: 'text' })
  description!: string;

  @Property({ type: 'datetime', nullable: false })
  createdAt: Date = new Date();
}
