import { Entity, PrimaryKey, OneToMany, Collection, Property, OneToOne, ManyToOne, Rel } from '@mikro-orm/core';
import { RHMember } from '../rh/RHMember.js';
import { Role } from './Role.js';

@Entity({ tableName: 'rank' })
export class Rank {
  @PrimaryKey()
  id!: number;

  @Property({ length: 255 })
  name!: string;

  @OneToMany(() => RHMember, member => member.grade)
  rHMembers = new Collection<RHMember>(this);

  @OneToOne(() => Role, { nullable: true })
  roleDiscord?: Rel<Role>;

  @OneToMany(() => RHMember, member => member.pendingApproval)
  memberApproval = new Collection<RHMember>(this);

  @ManyToOne(() => Rank, { nullable: true })
  baseRank?: Rel<Rank> | null = null;

}
