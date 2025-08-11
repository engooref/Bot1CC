// src/entities/EventType.ts
import { Entity, PrimaryKey, Property, OneToMany, Collection } from '@mikro-orm/core';
import { Event } from './Event.js';

@Entity({ tableName: 'event_type' })
export class EventType {

  @PrimaryKey()
  id!: number;

  @Property({ length: 255 })
  name!: string;

  @Property({ type: 'int', nullable: false })
  xp!: number;

  @Property({ length: 7 })
  color!: string;

  /**
   * One-to-Many vers Event
   * mappedBy via la propriété `type` de Event
   */
  @OneToMany(() => Event, ev => ev.type)
  events = new Collection<Event>(this);

  constructor(name: string, color: string) {
    this.name = name;
    this.color = color;
  }

}
