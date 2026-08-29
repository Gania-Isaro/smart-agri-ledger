/** Audit trail. Every service mutation writes one of these. */

import { db } from '../db/db';
import { uid } from '../lib/id';
import { nowStamp } from '../lib/date';
import type { AuditAction, AuditEvent, ID, User } from '../domain/types';

export async function record(
  user: User,
  entity: string,
  entityId: ID,
  action: AuditAction,
  summary: string,
  payload?: { before?: unknown; after?: unknown },
): Promise<AuditEvent> {
  const event: AuditEvent = {
    id: uid('aud'),
    entity,
    entityId,
    action,
    summary,
    before: payload?.before,
    after: payload?.after,
    userId: user.id,
    at: nowStamp(),
  };
  await db.audit.put(event);
  return event;
}

export async function trailFor(entity: string, entityId: ID): Promise<AuditEvent[]> {
  const rows = await db.audit.where('entityId').equals(entityId).toArray();
  return rows.filter((r) => r.entity === entity).sort((a, b) => (a.at < b.at ? 1 : -1));
}

export async function recentTrail(limit = 200): Promise<AuditEvent[]> {
  const rows = await db.audit.orderBy('at').reverse().limit(limit).toArray();
  return rows;
}
