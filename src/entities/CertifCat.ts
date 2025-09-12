import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'certif_cat' })
export class CertifCat {
  @PrimaryKey()
  id!: number;

  @Property({ length: 255 })
  name!: string;

  
}