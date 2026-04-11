import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { User } from './User.js';

@Entity()
export class FleetLink {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => User)
  user!: User;

  @Property({ type: 'string', nullable: true })
  customName?: string;

  @Property({ type: 'boolean', default: false })
  pledge: boolean = false;
}