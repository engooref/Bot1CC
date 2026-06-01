// src/entities/CertifRequest.ts
import {
  Entity,
  PrimaryKey,
  Property,
  ManyToOne,
  Unique,
  type Rel,
} from '@mikro-orm/core';
import { RHMember } from '../rh/RHMember.js';
import { Certifications } from './Certifications.js';

export enum CertifRequestStatus {
  PENDING   = 'pending',
  APPROVED  = 'approved',
  REJECTED  = 'rejected',
  CANCELLED = 'cancelled',
}

@Entity({ tableName: 'certif_request' })
@Unique({
  name: 'uniq_member_certif_status',
  properties: ['member', 'certification', 'status'],
})
export class CertifRequest {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => RHMember, { inversedBy: 'certifRequests' })
  member!: Rel<RHMember>;

  @ManyToOne(() => Certifications,{ inversedBy: 'certifRequests' })
  certification!: Rel<Certifications>;

  @Property({ length: 16 })
  status: CertifRequestStatus = CertifRequestStatus.PENDING;

  @Property({type: Date,})
  requestedAt: Date = new Date();

  @Property({ nullable: true, type: Date })
  processedAt?: Date | null = null;

  @Property({ type: 'text', nullable: true })
  comment?: string | null = null;
}
