// src/entities/TicketType.js
import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'ticket_type' })
export class TicketType {

  @PrimaryKey()
  id! : number;

  @Property({ length: 255 })
  name;

  @Property({ type: 'bigint' })
  roleAuth: string;

  /**
   * @param {string} name
   * @param {string|number} roleAuth
   */
  constructor(name : string, roleAuth : bigint) {
    this.name = name;
    this.roleAuth = roleAuth ? roleAuth.toString() : '';
  }

  toString() {
    return this.name;
  }
}
