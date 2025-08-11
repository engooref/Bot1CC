import { Entity, PrimaryKey, ManyToMany, Collection, Property } from '@mikro-orm/core';
import { RHMember } from './RHMember.js';

@Entity({ tableName: 'certifications' })
export class Certifications {
  @PrimaryKey()
  id!: number;

  @ManyToMany(() => RHMember, member => member.certifications)
  rHMembers = new Collection<RHMember>(this);

  @Property({ length: 255 })
  name!: string;

  @Property({ type: 'text' })
  description!: string;
}
