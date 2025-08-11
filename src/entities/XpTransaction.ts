import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { RHMember } from './RHMember.js';

@Entity({ tableName: 'xp_transaction' })
export class XpTransaction {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => RHMember, { nullable: false, fieldName: 'r_hmember_id' })
  rHMember!: RHMember;

  @Property({ type: 'int', nullable: false })
  amount!: number;

  @Property({ length: 255, nullable: false })
  sourceType!: string;

  @Property({ type: 'bigint', nullable: true })
  sourceId?: string;

  @Property({ type: 'longtext', nullable: true, default: null })
  description?: string | null = null;

  @Property({ type: 'datetime', nullable: false })
  createdAt!: Date;
}
