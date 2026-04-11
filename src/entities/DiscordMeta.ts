// src/entities/DiscordMeta.ts
import { Embeddable, Property } from '@mikro-orm/core';

@Embeddable()
export class DiscordMeta {
  // on garde string pour les ids Discord (souvent > 2^53)
  @Property({ nullable: true })
  messageId?: string | null;

  @Property({ nullable: true })
  briefingMessageId?: string | null;

  @Property({ nullable: true })
  attributionMessageId?: string | null;

  @Property({ nullable: true })
  vocalParentId?: string | null;
}
