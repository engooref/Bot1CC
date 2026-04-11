// src/entities/LeaderboardRating.ts
import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Unique,
  Enum,
  Index,
  Cascade,
} from '@mikro-orm/core';
import { User } from './../core/User.js';

// Adapte selon ton enum existant (tu as déjà duel.type côté bot)
export enum LeaderboardDuelType {
  FPS = 'fps',
  AERIEN = 'aerien',
  // ...
}

@Entity({ tableName: 'leaderboard_rating' })
@Unique({ name: 'uniq_rating_user_type', properties: ['user', 'type'] })
@Index({ name: 'idx_rating_type', properties: ['type'] })
export class LeaderboardRating {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => User, { nullable: false, cascade: [Cascade.REMOVE] })
  user!: User;

  // Stocké en string (comme ton enumType PHP)
  @Enum({ items: () => LeaderboardDuelType })
  type!: LeaderboardDuelType;

  @Property({ type: 'int', default: 0 })
  rating: number = 0;

  @Property({ type: 'int', default: 0 })
  wins: number = 0;

  @Property({ type: 'int', default: 0 })
  losses: number = 0;

  @Property({ type: 'int', default: 0 })
  games: number = 0;

  // Jetons de refus gratuits (max 3 chez toi)
  @Property({ type: 'int', default: 3 })
  freeRefus: number = 3;

  @Property({ type: 'int', default: 0 })
  refus: number = 0;
}
