import { Entity, PrimaryKey, Property, ManyToOne, OneToMany, Collection, type Rel } from '@mikro-orm/core';
import { RefineryWorkOrderLine } from './RefineryWorkOrderLine.js';
import { User } from './../core/User.js';
import { Poi } from '../starmap/Poi.js';

@Entity({ tableName: 'mining_refinery_work_order' })
export class RefineryWorkOrder {
    
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => User)
  user!: User;

  @Property()
  startedAt!: Date;

  @Property()
  durationSeconds!: number;

  @Property()
  notifyOnComplete: boolean = false;

  @Property()
  notified: boolean = false; // Pour éviter les doublons

  @Property({ nullable: true })
  notes?: string;

  @ManyToOne(() => Poi)
  refineryPoi!: Rel<Poi>;

  @Property({ nullable: true })
  method?: string;

  @OneToMany(() => RefineryWorkOrderLine, line => line.workOrder)
  lines = new Collection<RefineryWorkOrderLine>(this);
    
  get endAt(): Date {
    return new Date(this.startedAt.getTime() + this.durationSeconds * 1000);
  }

  get isReady(): boolean {
    return this.endAt <= new Date();
  }
}
