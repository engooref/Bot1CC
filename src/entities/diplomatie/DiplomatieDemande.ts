import { Entity, Enum, Index, ManyToOne, PrimaryKey, Property, type Rel } from '@mikro-orm/core';
import { DiplomatieCorporation } from './DiplomatieCorporation.js';

export enum DiplomatieDemandeStatut {
    Pending = 'pending',
    Accepted = 'accepted',
    Refused = 'refused',
}

/** Suivi d’une candidature, indépendant des utilisateurs internes du 1CC. */
@Entity({ tableName: 'diplomatie_demande' })
@Index({ name: 'diplomatie_demande_guild_applicant_status_index', properties: ['guildId', 'applicantId', 'status'] })
export class DiplomatieDemande {
    @PrimaryKey()
    id!: number;

    @Property({ length: 20 })
    guildId!: string;

    /** ID Discord : un ambassadeur externe n’a pas nécessairement de ligne User. */
    @Property({ length: 20 })
    applicantId!: string;

    @Property({ length: 20 })
    threadId!: string;

    /** Renseignés après l’envoi de la notification et de ses boutons. */
    @Property({ length: 20, nullable: true })
    notificationChannelId?: string;

    @Property({ length: 20, nullable: true, unique: true })
    notificationMessageId?: string;

    @Enum({ items: () => DiplomatieDemandeStatut, default: DiplomatieDemandeStatut.Pending })
    status: DiplomatieDemandeStatut = DiplomatieDemandeStatut.Pending;

    /** Renseignée lors de l’acceptation ; conserve le lien pour l’historique. */
    @ManyToOne(() => DiplomatieCorporation, { nullable: true, deleteRule: 'restrict' })
    corporation?: Rel<DiplomatieCorporation>;

    @Property({ length: 20, nullable: true })
    processedById?: string;

    @Property({ type: Date })
    requestedAt: Date = new Date();

    @Property({ type: Date, nullable: true })
    processedAt?: Date;
}
