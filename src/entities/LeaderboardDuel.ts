import { Entity, PrimaryKey, Property, ManyToOne } from '@mikro-orm/core';
import { User } from './User.js';

export enum LeaderboardDuelStatus {
  WAITING_CONFIRMATION = 'waiting_confirmation',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  REFUSED = 'refused',
  IN_REVIEW = 'in_review',
  EXPIRED_WHILE_WAITING = 'expired_while_waiting',
}

export enum LeaderboardDuelType {
  FPS = 'fps',
  AERIEN = 'aerien',
}

export interface DuelPlayerPreview {
  win: number;
  loss: number;
  penalty: number;
}

export interface DuelPreview {
    player1: DuelPlayerPreview;
    player2: DuelPlayerPreview;
}


@Entity()
export class LeaderboardDuel {

  @PrimaryKey()
  id!: number;

  @ManyToOne(() => User, { nullable: false })
  player1!: User;

  @ManyToOne(() => User, { nullable: false })
  player2!: User;

  // Si tu veux garder l'historique même si le user est supprimé => SET NULL est OK
  @ManyToOne(() => User, { nullable: true, deleteRule: 'SET NULL' })
  winner?: User | null;

  @Property({ onCreate: () => new Date() })
  createdAt!: Date;

  @Property({ nullable: true })
  resolveAt?: Date | null;

  @Property({ onCreate: () => new Date() }) // optionnel mais souvent voulu
  startAt!: Date;

  @Property({ type: 'string', columnType: 'varchar(20)' })
  status: LeaderboardDuelStatus = LeaderboardDuelStatus.WAITING_CONFIRMATION;

  @Property({ type: 'string', columnType: 'varchar(16)' })
  type!: LeaderboardDuelType;

  @Property({ type: 'json', onCreate: () => ({ player1: { win: 0, loss: 0, penalty: 0 }, player2: { win: 0, loss: 0, penalty: 0 } }) })
  preview!: DuelPreview;
}
