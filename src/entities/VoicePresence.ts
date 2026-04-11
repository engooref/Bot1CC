import { Entity, PrimaryKey, Property, ManyToOne, ManyToMany, Collection, type Rel } from '@mikro-orm/core';
import { Event } from './Event.js';
import { User } from './User.js';
import { Certifications } from './Certifications.js';

@Entity({ tableName: 'voice_presence' })
export class VoicePresence {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => Event, { nullable: true })
  event?: Rel<Event>;

  @ManyToOne(() => User)
  user!: Rel<User>;

  @Property({ type: 'int', nullable: false })
  xp: number = 0;

  @Property()
  present: boolean = false;

  @Property()
  promote: boolean = false;  

  @ManyToMany(() => Certifications, (certification) => certification.voicePresences, { owner: true, pivotTable: 'voice_presence_certifications' })
  certifications = new Collection<Certifications>(this);
}