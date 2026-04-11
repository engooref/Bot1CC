import { Entity, PrimaryKey, ManyToMany, Collection, Property, ManyToOne, type Rel, OneToMany } from '@mikro-orm/core';
import { RHMember } from './../hr/RHMember.js';
import { CertifCat } from './CertifCat.js';
import { VoicePresence } from './../event/VoicePresence.js';
import { Pole } from './../core/Pole.js';
import { CertifRequest } from './CertifRequest.js';

@Entity({ tableName: 'certifications' })
export class Certifications {
  @PrimaryKey()
  id!: number;

  @ManyToMany(() => RHMember, member => member.certifications)
  rHMembers = new Collection<RHMember>(this);

  @Property({ length: 255 })
  name!: string;

  @ManyToOne(() => CertifCat, { nullable: false })
  categorie!: Rel<CertifCat>;

  @ManyToMany(() => VoicePresence, voicePresence => voicePresence.certifications, { nullable: true })
  voicePresences = new Collection<VoicePresence>(this);

  @ManyToOne(() => Pole, { nullable: false })
  pole!: Rel<Pole>;

  @OneToMany(() => CertifRequest, (req) => req.certification)
  certifRequests = new Array<CertifRequest>();
}
