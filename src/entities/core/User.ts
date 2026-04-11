// src/entities/User.ts
import {
  Entity,
  PrimaryKey,
  Property,
  ManyToMany,
  OneToMany,
  OneToOne,
  Collection,
  type Rel,
  Cascade,
} from '@mikro-orm/core';
import { Role }      from './Role.js';
import { Traces }    from './Traces.js';
import { Response }  from './../event/Response.js';
import { Event }     from './../event/Event.js';
import { RHMember }  from './../hr/RHMember.js';


@Entity({ tableName: 'user' })
export class User {

  @PrimaryKey()
  id!: number;

  // Si tu veux stocker un JSON brut, nomme-le pour éviter conflit
  @Property({ type: 'json', fieldName: 'roles' })
  rolesJson: any = [];

  @Property({ length: 255 })
  username!: string;

  @Property({ unique: true, fieldName: 'discord_id' })
  discordId!: string;

  @Property({ length: 255 })
  avatar!: string;

  @ManyToMany(() => Role, role => role.users, {
    owner: true,
    pivotTable: 'user_role',
  })
  rolesDiscord = new Collection<Role>(this);

  @ManyToMany(() => Event, ev => ev.users)
  events = new Collection<Event>(this);

  @OneToMany(() => Event, ev => ev.userOrig, { nullable: true })
  eventsOrig = new Collection<Event>(this);

  @OneToOne(
    () => RHMember,              // callback pour reporter la résolution
    rh => rh.user,               // lien inverse côté RHMember.user
    { nullable: true, orphanRemoval: true }
  )
  rhProfile?: Rel<RHMember>;     // ← on utilise Rel<…> ici

  constructor(
    username: string,
    discordId: string|number,
    avatar: string,
    rolesDiscord: Role[] = [],
  ) {
    this.username      = username;
    this.discordId     = String(discordId);
    this.avatar        = avatar;
    this.rolesDiscord  = new Collection(this, rolesDiscord);

  }

  reset(): void {
    this.rolesJson = [];
    this.avatar = '';
    this.rolesDiscord.removeAll();
    this.username = this.username.replace(/\[[^\]]*\]/g, '');
  }

}
