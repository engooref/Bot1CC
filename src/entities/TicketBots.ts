// src/entities/TicketBots.ts
import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
} from '@mikro-orm/core';
import { TicketType } from './TicketType.js';

@Entity({ tableName: 'ticket_bot' })
export class TicketBots {

  @PrimaryKey()
  id!: number;

  /** Lien vers le type de ticket */
  @ManyToOne(() => TicketType)
  type!: TicketType;

  /** Utilisateur ayant ouvert le ticket (stocke l’ID Discord) */
  @Property({ type: 'bigint' })
  userId!: string;

  /** Canal associé (0 si aucun) */
  @Property({ type: 'bigint', defaultRaw: '0' })
  channelId: string = '0';

  /** Utilisateur ayant fermé le ticket (0 si aucun) */
  @Property({ type: 'bigint', defaultRaw: '0' })
  closedUserId: string = '0';

  /** Date d’ouverture du ticket */
  @Property({ type: 'datetime' })
  open!: Date;

  /** Date de fermeture, par défaut maintenant via la BDD */
  @Property({ type: 'datetime', defaultRaw: 'CURRENT_TIMESTAMP', nullable: false })
  closed: Date = new Date();

  /** Message de clôture */
  @Property({ length: 255, default: '' })
  closedMessage: string = '';

  /** Sujet ou description du ticket */
  @Property({ length: 255, default: '' })
  issue: string = '';

  constructor(type: TicketType, userId: string|number, open: Date) {
    this.type   = type;
    this.userId = String(userId);
    this.open   = open;
  }

}
