import {
  Entity,
  PrimaryKey,
  Property,
  ManyToMany,
  Collection,
  type Rel,
} from '@mikro-orm/core';
import { User } from './../core/User.js';

@Entity({ tableName: 'temp_link' })
export class TempLink {
  @PrimaryKey()
  id!: number;

  @Property({ type: 'string', length: 64, unique: true })
  token!: string;

  @Property({ type: 'bigint' })
  userId!: string;

  @Property({ type: 'bigint' })
  operationId!: string;

  @Property({ type: 'string', length: 255 })
  responsable!: string;

  @Property({ type: 'bigint' })
  channelId!: string;

  @Property({ type: 'bigint', nullable: true })
  threadId?: string;

  @Property({ type: 'bigint' })
  expires!: number;

  @Property({ type: 'datetime' })
  startAt!: Date;

  @Property({ type: 'datetime' })
  createdAt: Date = new Date();

  @Property({ type: 'boolean', default: false })
  sent: boolean = false;

  @Property({ type: 'boolean', default: false })
  dmSent: boolean = false;

  @Property({ type: 'string', length: 255, nullable: true })
  viewUrl?: string;

  @Property({ type: 'boolean', default: false })
  archived: boolean = false;

  @Property({ type: 'datetime', nullable: true })
  archivedAt?: Date;

  @ManyToMany(() => User, undefined, { owner: true, pivotTable: 'temp_link_user' })
  users = new Collection<User>(this);

  isArchived(): boolean {
    return this.archived;
  }

  setArchived(archived: boolean): this {
    this.archived = archived;
    if (archived) {
      this.archivedAt = new Date();
    }
    return this;
  }

  getArchivedAt(): Date | undefined {
    return this.archivedAt;
  }

  getUrl(): string {
    const urlBase = process.env.APP_URL || 'https://www.1ercorpscolonial.fr';
    if (this.viewUrl) {
      return urlBase + this.viewUrl;
    }
    return '';
  }
}
