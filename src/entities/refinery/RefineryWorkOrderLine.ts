import { Entity, PrimaryKey, Property, ManyToOne, type Rel } from '@mikro-orm/core';
import { RefineryWorkOrder } from './RefineryWorkOrder.js';
import { CatalogCommodity } from '../catalog/CatalogCommodity.js';

@Entity({ tableName: 'mining_refinery_work_order_line' })
export class RefineryWorkOrderLine {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => RefineryWorkOrder)
  workOrder!: Rel<RefineryWorkOrder>;

  @ManyToOne(() => CatalogCommodity)
  commodity?: Rel<CatalogCommodity>;

 
  @Property()
  quantityScuInput!: number;

  @Property()
  yieldPercent!: number;

  @Property()
  quantityScuOutput!: number;
}
