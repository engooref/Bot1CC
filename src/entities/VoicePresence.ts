import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { Event } from './Event.js';
import { User } from './User.js';

@Entity({ tableName: 'voice_presence' })
export class VoicePresence {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => Event, { nullable: true })
  event?: Event;

  @ManyToOne(() => User)
  user!: User;

  @Property({ type: 'datetime' })
  lastJoin!: Date;

  @Property({ type: 'bigint', nullable: false, defaultRaw: '0' })
  totalMs: number = 0;

  @Property({ type: 'int', nullable: false })
  xpMan: number = 0;

  @Property()
  isInChannel: boolean = false;
}