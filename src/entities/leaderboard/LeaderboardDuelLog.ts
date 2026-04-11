import { Entity, PrimaryKey, Property, ManyToOne, Index, Cascade } from '@mikro-orm/core';
import { LeaderboardDuel } from './LeaderboardDuel.js';
import { User } from './../core/User.js';

@Index({ properties: ['createdAt'], name: 'idx_ldlog_created_at' })
@Index({ properties: ['action'], name: 'idx_ldlog_action' })
@Entity({ tableName: 'leaderboard_duel_log' })
export class LeaderboardDuelLog {
    @PrimaryKey()
    id!: number;

    // relation vers le duel (cascade delete)
    @ManyToOne(() => LeaderboardDuel, { cascade: [Cascade.REMOVE] })
    duel!: LeaderboardDuel;

    // qui a fait l'action (nullable, set null on delete)
    @ManyToOne(() => User, { nullable: true, deleteRule: 'SET NULL' })
    actor?: User | null;

    // ex: "duel_created", "report_submitted", ...
    @Property({ length: 64 })
    action!: string;

    // payload libre (winnerId, reporterId, anciens/nouveaux statuts…)
    @Property({ type: 'json', nullable: true })
    details?: Record<string, any> | null;

    // created_at
    @Property({ name: 'created_at' })
    createdAt: Date = new Date();
}