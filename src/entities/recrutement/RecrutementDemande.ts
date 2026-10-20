import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core';

export type RecrutementStatus = 'waiting_rsi' | 'review' | 'postulant' | 'candidate' | 'refused' | 'expired';
export interface PostulantChannelAccess { viewChannel: boolean | null; hadOverwrite: boolean; }
export interface RecruitmentDecision { from: RecrutementStatus; to: RecrutementStatus; actorId: string; at: string; reason?: string; ticketMessageId?: string; }

/** Independent of User: an applicant is not yet an official member. */
@Entity({ tableName: 'recrutement_demande' })
@Unique({ properties: ['guildId', 'applicantId'] })
export class RecrutementDemande {
    @PrimaryKey() id!: number;
    @Property({ length: 20 }) guildId!: string;
    @Property({ length: 20 }) applicantId!: string;
    @Property({ length: 20, nullable: true }) channelId?: string;
    @Property({ length: 20, nullable: true }) welcomeMessageId?: string;
    @Property({ length: 20, nullable: true }) notificationChannelId?: string;
    @Property({ length: 20, nullable: true }) notificationMessageId?: string;
    @Property({ length: 20, nullable: true }) alertMessageId?: string;
    @Property({ length: 20 }) status: RecrutementStatus = 'waiting_rsi';
    /** Committed intent before Discord mutations; resumed after failures/restarts. */
    @Property({ length: 20, nullable: true }) pendingStatus?: RecrutementStatus;
    @Property({ type: 'json', nullable: true }) postulantChannelAccess?: Record<string, PostulantChannelAccess>;
    @Property({ type: 'json' }) decisions: RecruitmentDecision[] = [];
    @Property({ type: Date }) openedAt = new Date();
    @Property({ type: Date }) lastActivityAt = new Date();
    @Property({ type: Date, nullable: true }) submittedAt?: Date;
    @Property({ type: Date, nullable: true }) candidateAt?: Date;
    @Property({ type: Date, nullable: true }) arrivalTaggedAt?: Date;
    @Property({ type: Date, nullable: true }) arrivalRemovedAt?: Date;
    @Property({ type: 'json', nullable: true }) mentorship?: { closedAt?: string; closedReason?: string; closedBy?: string; waitingSince?: string; remindedAt?: string; needsSync?: boolean; ticketNotice?: string; rhNotice?: string; periodRemindedAt?: string };
    @Property({ type: 'boolean' }) needsSync = true;
    @Property({ type: 'text', nullable: true }) lastError?: string;
}
