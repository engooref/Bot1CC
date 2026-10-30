import { Entity, PrimaryKey, Property, ManyToOne, type Rel } from '@mikro-orm/core';
import { RecrutementDemande } from './RecrutementDemande.js';

export type ParrainAvis = 'favorable' | 'prolonger' | 'defavorable';
export interface ParrainageDetails {
    actorId?: string;
    endActorId?: string;
    endReason?: string;
    reason?: string;
    relay?: { at: string; reason: string; notified?: boolean };
    reviews?: { avis: ParrainAvis; comment: string; at: string; actorId: string; notified?: boolean }[];
    access?: { channelId: string; hadOverwrite: boolean; permissions: Record<string, boolean | null> };
    accessRestored?: boolean;
    announced?: boolean;
}
/** Historique des accompagnements, indépendant du profil membre et de l’XP. */
// Schéma géré par Site1CC, ne pas migrer ici.
@Entity({ tableName: 'recruitment_mentorship' })
export class RecrutementParrainage {
    @PrimaryKey() id!: number;
    @ManyToOne(() => RecrutementDemande, { deleteRule: 'restrict' }) demande!: Rel<RecrutementDemande>;
    @Property({ length: 20 }) parrainId!: string;
    @Property({ type: 'json', nullable: true }) details?: ParrainageDetails;
    @Property({ type: Date }) startedAt = new Date();
    @Property({ type: Date, nullable: true }) endedAt?: Date;
}
