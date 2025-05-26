// src/entities/Response.ts
import {
    Entity,
    PrimaryKey,
    Property,
    ManyToOne,
    ManyToMany,
    Collection,
    type Rel,
  } from '@mikro-orm/core';
  import { User }         from './User.js';
  import { Event }        from './Event.js';
  import { ResponseTeam } from './ResponseTeam.js';
  import { ResponseRoles }from './ResponseRoles.js';
  
  export interface ResponseInit {
    user: User;
    event: Event;
    typeRep: string;
    team?: ResponseTeam;
    commentaire?: string;
    vaisseau?: string;
    roleVaisseau?: string;
    roleDemand?: string[];
    // ici, **uniquement** un tableau**, pas une Collection**
    roles?: ResponseRoles[];
  }
  
  @Entity({ tableName: 'response_event' })
  export class Response {
  
    @PrimaryKey()
    id!: number;
  
    @ManyToOne(() => User)
    users!: Rel<User>;
  
    @ManyToOne(() => Event, { inversedBy: 'responses' })
    event!: Rel<Event>;
  
    @Property({ length: 255 })
    typeRep!: string;
  
    @ManyToOne(() => ResponseTeam, { nullable: true, inversedBy: 'responses' })
    team?: Rel<ResponseTeam>;
  
    @Property({ length: 255, nullable: true })
    commentaire?: string;
  
    @Property({ length: 255, nullable: true })
    vaisseau?: string;
  
    @Property({ length: 255, nullable: true })
    roleVaisseau?: string;
  
    @Property({ type: 'json', default: [] })
    roleDemand: string[] = [];
  
    @ManyToMany(() => ResponseRoles, r => r.responses, {
      owner: true,
      pivotTable: 'response_event_response_roles',
      joinColumn: 'response_event_id',         // nom exact de la FK vers Response
      inverseJoinColumn: 'response_roles_id',
    })
    roles = new Collection<ResponseRoles>(this);
  
    constructor(init?: ResponseInit) {
      if (init) {
        this.users        = init.user;
        this.event       = init.event;
        this.typeRep     = init.typeRep;
        this.team        = init.team;
        this.commentaire = init.commentaire;
        this.vaisseau    = init.vaisseau;
        this.roleVaisseau= init.roleVaisseau;
        this.roleDemand  = init.roleDemand ?? [];
  
        // **on n’accepte qu’un tableau**, pas une Collection**
        if (Array.isArray(init.roles)) {
          // réinitialise la Collection avec les items du tableau
          this.roles = new Collection<ResponseRoles>(this, init.roles);
        }
      }
    }
  
  }
  