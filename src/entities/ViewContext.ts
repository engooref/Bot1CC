// src/entities/InteractionContext.ts
import { Entity, PrimaryKey, Property, Enum } from '@mikro-orm/core';

export enum ComponentType {
  Button = 'button',
  Select = 'select',
}

@Entity({ tableName: 'view_context' })
export class InteractionContext {

  @PrimaryKey()
  id!: number;

  @Property()
  messageId!: string;

  @Property()
  channelId!: string;

  @Property()
  customId!: string;

  @Property()
  handlerKey!: string;

  @Enum({ items: () => Object.values(ComponentType) })
  componentType!: ComponentType;

  @Property({ type: 'json', columnType: 'text' })
  data!: Record<string, any>;
}
