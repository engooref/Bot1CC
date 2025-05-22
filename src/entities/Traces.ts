// src/entities/Traces.ts
import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  type Rel
} from '@mikro-orm/core';
import { User } from './User.js';

@Entity({ tableName: 'traces' })
export class Traces {

  @PrimaryKey()
  id!: number;

  /**
   * Many-to-One vers User (nullable).
   * Si tu veux pouvoir faire user.traces, ajoute { inversedBy: 'traces' } ici
   */
  @ManyToOne(() => User, { nullable: true })
  user?: Rel<User>;

  @Property({ length: 255 })
  message!: string;

  /** Date de la trace, initialisée à NOW() par la BDD */
  @Property({ type: 'datetime', defaultRaw: 'CURRENT_TIMESTAMP' })
  time!: Date;

  @Property({ type: 'text', nullable: true })
  parameter?: string;

  constructor(message: string, user?: User, parameter?: string) {
    this.message   = message;
    this.user      = user;
    this.parameter = parameter;
    // `time` sera rempli par la BDD via CURRENT_TIMESTAMP
  }

  toString(): string {
    return this.id?.toString() ?? '';
  }

}
