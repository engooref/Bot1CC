import { Entity, PrimaryKey, Property, Unique } from '@mikro-orm/core';

export interface RecruitmentMentorship {
    closedAt?: string; closedReason?: string; closedBy?: string; waitingSince?: string; remindedAt?: string; needsSync?: boolean;
    ticketNotice?: string; rhNotice?: string; periodRemindedAt?: string; interviewRemindedAt?: string;
    /** Période de candidat (ticket #43) : « le mois repart » fixe le début, la prolongation s'ajoute en jours. `periodRemindedAt` / `mentorRemindedAt` = dernière relance. */
    periodStartAt?: string; periodExtraDays?: number; mentorRemindedAt?: string;
    /** Ticket Mentora (statut awaiting_mentor). */
    mentoraChannelId?: string; mentoraMessageId?: string;
    /** Posé quand le salon d'admission d'un dossier clos a été supprimé (ticket #41) : plus aucune recréation. */
    ticketDeletedAt?: string;
}
export type RecrutementStatus = 'waiting_rsi' | 'review' | 'postulant' | 'awaiting_mentor' | 'candidate' | 'refused' | 'expired' | 'integrated';
export interface PostulantChannelAccess { viewChannel: boolean | null; hadOverwrite: boolean; }
export interface RecruitmentDecision { from: RecrutementStatus; to: RecrutementStatus; actorId: string; at: string; reason?: string; ticketMessageId?: string; }

/** Independent of User: an applicant is not yet an official member. */
// Schéma géré par Site1CC, ne pas migrer ici.
@Entity({ tableName: 'recruitment_application' })
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
    /** Champ JSON : toute écriture doit conserver les clés existantes ({ ...mentorship, … }). */
    @Property({ type: 'json', nullable: true }) mentorship?: RecruitmentMentorship;
    @Property({ type: 'boolean' }) needsSync = true;
    @Property({ type: 'text', nullable: true }) lastError?: string;
}
