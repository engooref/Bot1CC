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

  
  @Property({ type: 'int', nullable: false })
  xp: number = 0;

  @Property()
  presence: boolean = false;
}