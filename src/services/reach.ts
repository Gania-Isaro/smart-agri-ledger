/**
 * A group manager works only on their own group's workers. Their phone only
 * downloads that group, and the online database refuses anything else, but
 * the app checks it too, on every change, so a mistake is stopped at once
 * instead of being refused later during sync.
 */

import { db } from '../db/db';
import type { ID, User } from '../domain/types';
import { tx } from '../i18n/tx';

export class OtherGroupError extends Error {
  constructor() {
    super(tx('This worker belongs to another group. You can only change workers in your own group.'));
    // Shown like any other "not allowed" message.
    this.name = 'PermissionError';
  }
}

/** Refuses when a manager acts on a group that is not theirs. The owner reaches every group. */
export function assertGroup(user: User | null, groupId: string | null | undefined): void {
  if (user?.role === 'manager' && user.cooperativeId && groupId !== user.cooperativeId) throw new OtherGroupError();
}

/** The same, for the group of the worker with this id. */
export async function assertWorker(user: User | null, farmerId: ID | null | undefined): Promise<void> {
  if (!farmerId || user?.role !== 'manager') return;
  const f = await db.farmers.get(farmerId);
  if (f) assertGroup(user, f.cooperativeId);
}
