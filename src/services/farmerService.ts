/** Farmer register: create, edit, archive, and the derived list view. */

import { db, nextCounter, reserveCounters } from '../db/db';
import { padCode, uid } from '../lib/id';
import { nowStamp, today } from '../lib/date';
import { assertCan } from '../domain/rbac';
import type { FarmerFinancials } from '../domain/ledger';
import type { Farmer, FarmerStatus, ID, User } from '../domain/types';
import * as audit from './audit';
import { financialsByFarmer } from './ledgerService';

export class ValidationError extends Error {
  readonly field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export type FarmerDraft = Omit<Farmer, 'id' | 'code' | 'status' | 'archived'> & {
  status?: FarmerStatus;
};

function validate(draft: Partial<FarmerDraft>) {
  if (!draft.firstName?.trim()) throw new ValidationError('First name is required.', 'firstName');
  if (!draft.lastName?.trim()) throw new ValidationError('Last name is required.', 'lastName');
  if (!draft.district?.trim()) throw new ValidationError('District is required.', 'district');
  if (!draft.cooperativeId) throw new ValidationError('Select a cooperative.', 'cooperativeId');
  if (!draft.primaryCropId) throw new ValidationError('Select a primary crop.', 'primaryCropId');
  if (draft.phone && !/^[+0-9 ()-]{7,20}$/.test(draft.phone.trim())) {
    throw new ValidationError('That phone number does not look right.', 'phone');
  }
  if (draft.farmSizeHa !== undefined && (draft.farmSizeHa < 0 || draft.farmSizeHa > 500)) {
    throw new ValidationError('Farm size must be between 0 and 500 hectares.', 'farmSizeHa');
  }
  if (draft.plots !== undefined && (draft.plots < 0 || !Number.isInteger(draft.plots))) {
    throw new ValidationError('Number of plots must be a whole number.', 'plots');
  }
}

export async function create(user: User, draft: FarmerDraft): Promise<Farmer> {
  assertCan(user, 'farmer.create');
  validate(draft);

  const n = await nextCounter('farmer');
  const crops = draft.crops?.length ? draft.crops : [draft.primaryCropId];

  const farmer: Farmer = {
    ...draft,
    id: uid('frm'),
    code: padCode('FR-', n),
    crops: Array.from(new Set([draft.primaryCropId, ...crops])),
    status: draft.status ?? 'active',
    registeredAt: draft.registeredAt || today(),
    archived: false,
  };

  await db.farmers.put(farmer);
  await audit.record(user, 'farmer', farmer.id, 'create', `Registered ${farmer.code} — ${farmer.firstName} ${farmer.lastName}`, { after: farmer });
  return farmer;
}

export async function update(user: User, id: ID, patch: Partial<Farmer>): Promise<Farmer> {
  assertCan(user, 'farmer.edit');
  const before = await db.farmers.get(id);
  if (!before) throw new ValidationError('That farmer no longer exists.');

  const after: Farmer = { ...before, ...patch, id: before.id, code: before.code };
  validate(after);
  if (after.primaryCropId && !after.crops.includes(after.primaryCropId)) {
    after.crops = [after.primaryCropId, ...after.crops];
  }

  await db.farmers.put(after);
  const beforeRec = before as unknown as Record<string, unknown>;
  const afterRec = after as unknown as Record<string, unknown>;
  const changed = Object.keys(patch).filter((k) => beforeRec[k] !== afterRec[k]);
  await audit.record(user, 'farmer', id, 'update', `Updated ${before.code}: ${changed.join(', ') || 'no field change'}`, { before, after });
  return after;
}

/**
 * Farmers are archived, never deleted: their ledger history has to remain
 * readable, and a deleted farmer would orphan transactions.
 */
export async function archive(user: User, id: ID, archived: boolean): Promise<Farmer> {
  assertCan(user, 'farmer.archive');
  const before = await db.farmers.get(id);
  if (!before) throw new ValidationError('That farmer no longer exists.');

  const financials = (await financialsByFarmer()).get(id);
  if (archived && financials && financials.balance !== 0) {
    throw new ValidationError(
      `${before.code} still has a balance of ${financials.balance.toLocaleString()} RWF. Settle the account before archiving.`,
    );
  }

  const after = { ...before, archived, status: archived ? ('inactive' as FarmerStatus) : before.status };
  await db.farmers.put(after);
  await audit.record(user, 'farmer', id, 'update', `${archived ? 'Archived' : 'Restored'} ${before.code}`, { before, after });
  return after;
}

export async function setStatus(user: User, ids: ID[], status: FarmerStatus): Promise<number> {
  assertCan(user, 'farmer.edit');
  const rows = await db.farmers.bulkGet(ids);
  const updated = rows.filter(Boolean).map((f) => ({ ...(f as Farmer), status }));
  await db.farmers.bulkPut(updated);
  await audit.record(user, 'farmer', ids.join(','), 'update', `Set status "${status}" on ${updated.length} farmer(s)`);
  return updated.length;
}

export async function get(id: ID): Promise<Farmer | undefined> {
  return db.farmers.get(id);
}

export async function list(includeArchived = false): Promise<Farmer[]> {
  const rows = await db.farmers.toArray();
  return rows
    .filter((f) => includeArchived || !f.archived)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export interface FarmerRow extends Farmer {
  financials: FarmerFinancials;
}

/** The farmer register with its money attached, folded in a single pass. */
export async function listWithFinancials(includeArchived = false): Promise<FarmerRow[]> {
  const [farmers, financials] = await Promise.all([list(includeArchived), financialsByFarmer()]);
  const empty: FarmerFinancials = {
    earned: 0, paid: 0, advances: 0, deductions: 0,
    balance: 0, outstanding: 0, transactionCount: 0, lastActivityDate: null,
  };
  return farmers.map((f) => ({ ...f, financials: financials.get(f.id) ?? empty }));
}

/** Bulk register from an import. Rejects the whole file if any row is invalid. */
export async function importFarmers(user: User, drafts: FarmerDraft[]): Promise<Farmer[]> {
  assertCan(user, 'data.import');
  drafts.forEach((d, i) => {
    try {
      validate(d);
    } catch (e) {
      throw new ValidationError(`Row ${i + 2}: ${(e as Error).message}`);
    }
  });

  const first = await reserveCounters('farmer', drafts.length);
  const farmers: Farmer[] = drafts.map((draft, i) => ({
    ...draft,
    id: uid('frm'),
    code: padCode('FR-', first + i),
    crops: Array.from(new Set([draft.primaryCropId, ...(draft.crops ?? [])])),
    status: draft.status ?? 'active',
    registeredAt: draft.registeredAt || today(),
    archived: false,
  }));

  await db.farmers.bulkPut(farmers);
  await audit.record(user, 'farmer', 'import', 'import', `Imported ${farmers.length} farmers`, { after: { count: farmers.length, at: nowStamp() } });
  return farmers;
}
