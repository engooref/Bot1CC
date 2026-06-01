import { Entity, PrimaryKey, Property, ManyToMany, OneToMany, ManyToOne, type Rel } from '@mikro-orm/core';
import { Collection } from '@mikro-orm/core';
import { Certifications } from "./../certifications/Certifications.js";
import { RHMember } from "../rh/RHMember.js";
import { Channel } from "./Channel.js";

@Entity()
export class Pole {
  @PrimaryKey()
  id!: number;

  @Property({ nullable: true })
  name?: string;

  @ManyToMany(() => RHMember, member => member.poles)
  rHMembers = new Collection<RHMember>(this);

  @ManyToOne(() => Channel, { nullable: true })
  channelDemand?: Rel<Channel> | null;
}
