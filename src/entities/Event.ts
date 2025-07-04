// src/entities/Event.ts
import {
    Entity,
    PrimaryKey,
    Property,
    ManyToOne,
    ManyToMany,
    OneToMany,
    Collection,
    type Rel,
  } from '@mikro-orm/core';
  import { EventType } from './EventType.js';
  import { Response }  from './Response.js';
  import { User }      from './User.js';
  
  @Entity({ tableName: 'event' })
  export class Event {
  
    @PrimaryKey()
    id!: number;
  
    @Property({ type: 'bigint', nullable: true })
    discordId?: string;
  
    @Property({ type: 'datetime' })
    start!: Date;
  
    @Property({ type: 'time' })
    lancServ!: string;
  
    @Property({ type: 'time' })
    lancScen!: string;
  
    @Property({ type: 'datetime' })
    end!: string;
  
    @Property({ length: 255, default: '' })
    name: string = '';
  
    @ManyToOne(() => EventType, { nullable: true })
    type?: EventType;
  
    @Property({ type: 'text', fieldName: 'object1_cc', default: '' })
    object1Cc: string = '';
  
    @Property({ type: 'text', default: '' })
    objectAdv: string = '';
  
    @Property({ type: 'text', default: '' })
    commentaire: string = '';
  
    @Property({ length: 255, default: '' })
    spawn: string = '';
  
    @Property({ length: 255, default: '' })
    lieuEvent: string = '';
  
    @Property({ length: 255, nullable: true, default: '' })
    picture?: string = '';
  
    @Property({ length: 255, default: '' })
    nbResp: string = '';
  
    @Property({ type: 'json', default: '{}', name: 'reglevehicule' })
    regleVehicule: Record<string, any> = {};
  
    @Property({ type: 'json', default: '{}', name: 'regleenga' })
    regleEnga: Record<string, any> = {};
  
    @Property({ type: 'json', default: '{}', name: 'regequi' })
    regleQui: Record<string, any> = {};
  
    @Property({ type: 'boolean', default: false })
    isValid: boolean = false;
  
    @Property({ length: 255, default: '' })
    respawn: string = '';
  
    @Property({ type: 'bigint', nullable: true })
    briefingDiscordId?: string;
  
    @Property({ type: 'bigint', nullable: true })
    attributionDiscordId?: string;
  
    @Property({ type: 'text', nullable: true, default: '' })
    description: string = '';
  
    @Property({ type: 'boolean', default: false })
    appelMsgDiscord: boolean = false;
  
    @Property({ length: 255, nullable: true, default: '' })
    briefingTemplateName: string = '';
  
    @Property({ length: 255, default: '' })
    roleDispo: string = '';
  
    @Property({ length: 255, nullable: true })
    vocalParentId?: string;
  
    @OneToMany(() => Response, resp => resp.event, { orphanRemoval: true })
    responses = new Collection<Response>(this);
  
    @ManyToMany(() => User, user => user.events, { owner: true, pivotTable: 'event_user' })
    users = new Collection<User>(this);
  
    @ManyToOne(() => User, { nullable: false })
    userOrig!: Rel<User>;
  
    constructor(init?: Partial<Event>) {
      if (init) {
        Object.assign(this, init);
        if (Array.isArray(init.responses)) {
          this.responses = new Collection<Response>(this, init.responses);
        }
        if (Array.isArray(init.users)) {
          this.users = new Collection<User>(this, init.users);
        }
      }
    }
  
    get startDate(): string {
      const d = this.start;
      return d
        ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
        : '';
    }
  
    get startTime(): string {
      const d = this.start;
      return d
        ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        : '';
    }
  
    toString(): string {
      return this.name;
    }
  
  }
