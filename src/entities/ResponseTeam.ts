// src/entities/ResponseTeam.js
import {
    Entity,
    PrimaryKey,
    Property,
    OneToMany,
    Collection,
} from '@mikro-orm/core';
import { Response } from './Response.js';
  
@Entity({ tableName: 'response_team' })
export class ResponseTeam {
  
  @PrimaryKey()
  id!: number;

  @Property({ length: 255 })
  name! : string;

  @Property({ length: 7 })
  color! : string;

  // Inverse side of the One-to-Many with Response
  @OneToMany(() => Response, resp => resp.team)
  responses = new Collection(this);

  
}
  