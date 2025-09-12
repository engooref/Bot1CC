import { Entity, PrimaryKey, ManyToMany, Collection, Property, ManyToOne, type Rel } from '@mikro-orm/core';
import { RHMember } from './RHMember.js';
import { CertifCat } from './CertifCat.js';

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
}
