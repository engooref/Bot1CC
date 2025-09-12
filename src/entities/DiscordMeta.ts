// src/entities/DiscordMeta.ts
import { Embeddable, Property } from '@mikro-orm/core';

@Embeddable()
export class DiscordMeta {
  // on garde string pour les ids Discord (souvent > 2^53)
  @Property({ type: 'string', nullable: true })
  messageId?: string | null;

  @Property({ type: 'string', nullable: true })
  briefingMessageId?: string | null;

  @Property({ type: 'string', nullable: true })
  attributionMessageId?: string | null;

  @Property({ type: 'string', nullable: true })
  vocalParentId?: string | null;
}
