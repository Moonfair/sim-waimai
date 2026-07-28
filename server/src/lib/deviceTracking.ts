import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { bannedDevices, userDevices } from '../db/schema';

export async function isDeviceBanned(deviceId: string): Promise<boolean> {
  const [row] = await db.select().from(bannedDevices).where(eq(bannedDevices.deviceId, deviceId));
  return !!row;
}

/** Upserts the user↔device association so a later ban can find every device this user logged in from. */
export async function recordDeviceSeen(userId: string, deviceId: string): Promise<void> {
  await db
    .insert(userDevices)
    .values({ userId, deviceId })
    .onConflictDoUpdate({
      target: [userDevices.userId, userDevices.deviceId],
      set: { lastSeenAt: new Date() },
    });
}
