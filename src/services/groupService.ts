/**
 * Worker groups. The owner creates them; each group can have its own manager,
 * who sees and records only that group (enforced online by the database).
 */

import { db } from '../db/db';
import { uid } from '../lib/id';
import { assertCan } from '../domain/rbac';
import type { Cooperative, ID, User } from '../domain/types';
import * as audit from './audit';
import { ValidationError } from './farmerService';
import { tx } from '../i18n/tx';

function clean(input: { name: string; district?: string; contact?: string }) {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2) throw new ValidationError(tx('Give the group a name.'), 'name');
  return { name, district: input.district?.trim() ?? '', contact: input.contact?.trim() ?? '' };
}

export async function createGroup(user: User, input: { name: string; district?: string; contact?: string }): Promise<Cooperative> {
  assertCan(user, 'settings.manage');
  const c = clean(input);
  const all = await db.cooperatives.toArray();
  if (all.some((g) => g.name.toLowerCase() === c.name.toLowerCase())) {
    throw new ValidationError(tx('A group called {name} already exists.', { name: c.name }), 'name');
  }
  const group: Cooperative = { id: uid('grp'), code: c.name.slice(0, 3).toUpperCase(), ...c };
  await db.cooperatives.put(group);
  await audit.record(user, 'group', group.id, 'create', `Created group ${group.name}`, { after: group });
  return group;
}

export async function updateGroup(user: User, id: ID, input: { name: string; district?: string; contact?: string }): Promise<Cooperative> {
  assertCan(user, 'settings.manage');
  const before = await db.cooperatives.get(id);
  if (!before) throw new ValidationError(tx('That group no longer exists.'));
  const after = { ...before, ...clean(input) };
  await db.cooperatives.put(after);
  await audit.record(user, 'group', id, 'update', `Renamed group ${before.name} to ${after.name}`, { before, after });
  return after;
}

/** Remove a group that has no workers. A group with workers keeps their history, so it stays. */
export async function deleteGroup(user: User, id: ID): Promise<void> {
  assertCan(user, 'settings.manage');
  const before = await db.cooperatives.get(id);
  if (!before) throw new ValidationError(tx('That group no longer exists.'));
  const workers = await db.farmers.where('cooperativeId').equals(id).count();
  if (workers > 0) {
    throw new ValidationError(tx('{name} still has {count} workers (archived ones count too). Move them to another group first.', { name: before.name, count: workers }));
  }
  if ((await db.cooperatives.count()) <= 1) throw new ValidationError(tx('Keep at least one group.'));
  await db.cooperatives.delete(id);
  await audit.record(user, 'group', id, 'delete', `Deleted group ${before.name}`, { before });
}
