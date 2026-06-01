export interface PendingLink {
  id: string;
  userId: string;
  tempUrl: string;
  sendAt: number;
  channelId?: string;
  attempts?: number;
  lastAttemptAt?: number;
  lastError?: string;
}
