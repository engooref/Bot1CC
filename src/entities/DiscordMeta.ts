// src/entities/DiscordMeta.ts
import { Embeddable, Property } from '@mikro-orm/core';

@Embeddable()
export class DiscordMeta {
  // on garde string pour les ids Discord (souvent > 2^53)
  @Property({ type: 'bigint', nullable: true, fieldName: 'discord_message_id' })
  messageId?: string | null;

  @Property({ type: 'bigint', nullable: true, fieldName: 'discord_briefing_message_id' })
  briefingMessageId?: string | null;

  @Property({ type: 'bigint', nullable: true, fieldName: 'discord_attribution_message_id' })
  attributionMessageId?: string | null;

  @Property({ type: 'bigint', nullable: true, fieldName: 'discord_vocal_parent_id' })
  vocalParentId?: string | null;
}
