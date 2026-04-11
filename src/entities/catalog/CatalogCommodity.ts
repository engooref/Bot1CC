import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/core';

@Entity({ tableName: 'catalog_commodity' })
@Index({ properties: ['code'] })
@Index({ properties: ['kind'] })
export class CatalogCommodity {
  @PrimaryKey()
  id!: number;

  @Property({ unique: true })
  externalId!: number;

  @Property({ length: 255 })
  name!: string;

  @Property({ length: 64 })
  code!: string;

  @Property({ length: 64 })
  kind!: string;
}