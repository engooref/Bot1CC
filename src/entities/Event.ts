// src/entities/Event.ts
import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  ManyToMany,
  OneToMany,
  Collection,
  Embedded,
  Index,
  Enum,
  type Rel,
} from '@mikro-orm/core';

import { EventType } from './EventType.js';
import { Response as ResponseEvent } from './Response.js';
import { User } from './User.js';
import { VoicePresence } from './VoicePresence.js';
import { Certifications } from './Certifications.js';
import { DiscordMeta } from './DiscordMeta.js';

export enum EventStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  PROGRAMMED = 'PROGRAMMED',
}

export enum EventVisibility {
  PUBLIC = 'PUBLIC',
  PRIVATE = 'PRIVATE',
}


@Entity({ tableName: 'event' })
@Index({ name: 'idx_event_start', properties: ['start'] })
@Index({ name: 'idx_event_status', properties: ['status'] })
@Index({ name: 'idx_event_visibility', properties: ['visibility'] })
export class Event {

  // === Identité ===
  @PrimaryKey()
  id!: number;

  // === Métadonnées Discord (embeddable, prefix déjà posé dans DiscordMeta) ===
  @Embedded(() => DiscordMeta)
  discord = new DiscordMeta();

  // === Données principales ===
  @Property({ length: 255 })
  name: string = '';

  @ManyToOne(() => EventType, { nullable: true })
  type?: Rel<EventType>;

  // Doctrine: DateTimeImmutable -> JS: Date (UTC en DB)
  @Property({ type: 'datetime', nullable: false })
  start!: Date;

  @Property({ type: 'datetime', nullable: false })
  end!: Date;

  // Heures de lancement (on unifie: datetime pour éviter date+time séparées)
  @Property({ type: 'datetime', nullable: false })
  launchServer!: Date;

  @Property({ type: 'datetime', nullable: false })
  launchScenario!: Date;

  // Lieu / serveur / illustration
  @Property({ length: 255, nullable: true })
  location?: string | null; // ancien "lieuEvent"

  @Property({ length: 255, nullable: true })
  spawn?: string | null;

  @Property({ length: 255, nullable: true })
  picture?: string | null;

  // Objectifs / commentaires / description
  @Property({ type: 'text', nullable: true })
  object1CC?: string | null;

  @Property({ type: 'text', nullable: true })
  objectAdv?: string | null;

  @Property({ type: 'text', nullable: true })
  commentaire?: string | null;

  @Property({ type: 'text', nullable: true })
  description?: string | null;

  // Règles, rôles, comptages (JSON)
  @Property({ type: 'json' })
  vehicleRules: Record<string, unknown> = {
    aerien: '',
    vehicules: '',
    infanterie: '',
  };

  @Property({ type: 'json' })
  engagementRules: Record<string, unknown> = {
    aerien: '',
    vehicules: '',
    infanterie: '',
  };

  @Property({ type: 'json' })
  equipmentRules: Record<string, unknown> = {
    aerien: '',
    vehicules: '',
    infanterie: '',
  };

  /**
   * Structure: [{ roleId: number, count: number }, ...]
   */
  @Property({ type: 'json' })
  availableRoles: string[] = [];

  @Property({ length: 255 })
  nbResp: string = '';

  // Statut & visibilité
  @Enum({ items: () => EventStatus, nativeEnumName: 'event_status_enum' })
  status: EventStatus = EventStatus.DRAFT;

  @Enum({ items: () => EventVisibility, nativeEnumName: 'event_visibility_enum' })
  visibility: EventVisibility = EventVisibility.PUBLIC;

  // Divers
  @Property({ length: 255, nullable: true })
  briefingTemplateName?: string | null;

  @Property({ length: 255, nullable: true })
  respawn?: string | null;

  @Property({ type: 'boolean' })
  appelMsgDiscord: boolean = false;

  @Property({ type: 'boolean' })
  rapportEnv: boolean = false;

  // Publication
  @Property({ type: 'datetime', nullable: true })
  publishAt?: Date | null;

  @Property({ type: 'datetime', nullable: true })
  publishedAt?: Date | null;

  @Property({ length: 255, nullable: true })
  responsable?: string | null;

  // === Relations ===
  @OneToMany(() => ResponseEvent, (resp: ResponseEvent) => resp.event, { orphanRemoval: true })
  responses = new Collection<ResponseEvent>(this);

  @ManyToMany(() => User, (user) => user.events, { owner: true, pivotTable: 'event_user' })
  users = new Collection<User>(this);

  @ManyToOne(() => User, { nullable: false })
  userOrig!: Rel<User>;

  @OneToMany(() => VoicePresence, (vp) => vp.event)
  voicePresences = new Collection<VoicePresence>(this);

  @ManyToMany(() => Certifications, undefined, { owner: true })
  certifications = new Collection<Certifications>(this);

  
  /** True si publié au moins sur un canal Discord. */
  get isSend(): boolean {
    return !!(this.discord?.messageId || this.discord?.briefingMessageId || this.discord?.attributionMessageId);
  }

  /** URL publique (utile bot). */
  getUrl(): string {
    const base = process.env.APP_URL ?? 'https://www.1ercorpscolonial.fr';
    return `${base.replace(/\/$/, '')}/event/${this.id}`;
  }

  // Helpers d’affichage (optionnels)
  get startDate(): string {
    const d = this.start;
    return d ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}` : '';
  }

  get startTime(): string {
    const d = this.start;
    return d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
  }

  toString(): string {
    return this.name;
  }
}
