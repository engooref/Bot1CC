import { Entity, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'starmap_poi' })
export class Poi {
  @PrimaryKey()
  id!: number;

  @Property({ length: 255 })
  name: string = '';
}