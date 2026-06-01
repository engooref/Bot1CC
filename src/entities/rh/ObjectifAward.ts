// src/entities/EventType.ts
import { Entity, ManyToOne, PrimaryKey, Rel } from '@mikro-orm/core';
import { RHMember } from './RHMember.js';

@Entity({ tableName: 'objectifs_award' })
export class ObjectifsAward {

  @PrimaryKey()
  id!: number;

  @ManyToOne(() => RHMember, { nullable: false })
  member!: Rel<RHMember>;
}
