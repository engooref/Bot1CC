// src/entities/ResponseRoles.js
import {
    Entity,
    PrimaryKey,
    Property,
    ManyToMany,
    Collection,
} from '@mikro-orm/core';
import { Response } from './Response.js';

@Entity({ tableName: 'response_roles' })
export class ResponseRoles {

    @PrimaryKey()
    id!: number;

    @Property({ length: 255 })
    name! : string;

    @Property({ length: 7 })
    color! : string;

    // Inverse side of the many-to-many with Response
    @ManyToMany(() => Response, resp => resp.roles)
    responses = new Collection(this);

}
