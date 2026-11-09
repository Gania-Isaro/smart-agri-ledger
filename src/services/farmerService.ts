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
  /** Leave empty to generate the next code in sequence. */
  code?: string;
};

/** Farmer codes are typed by hand, so keep them short and predictable. */
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ._/-]{1,23}$/;

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
  if (draft.code && !CODE_PATTERN.test(draft.code.trim())) {
    throw new ValidationError('A farmer ID must be 2 to 24 letters, digits, spaces or . _ - /', 'code');
  }
}

/**
 * A farmer ID has to be unique: it is what appears on payment references and
 * exports, and two farmers sharing one is how money reaches the wrong person.
 */
async function assertCodeFree(code: string, exceptId?: ID) {
  const clash = await db.farmers.where('code').equals(code).first();
  if (clash && clash.id !== exceptId) {
    throw new ValidationError(`Farmer ID ${code} is already used by ${clash.firstName} ${clash.lastName}.`, 'code');
  }
}

export async function create(user: User, draft: FarmerDraft): Promise<Farmer> {
  assertCan(user, 'farmer.create');
  validate(draft);

  const crops = draft.crops?.length ? draft.crops : [draft.primaryCropId];

  // A typed code is used as given; an empty one continues the sequence.
  let code = draft.code?.trim() ?? '';
  if (code) {
    await assertCodeFree(code);
  } else {
    code = padCode('FR-', await nextCounter('farmer'));
    // The counter can fall behind if codes were typed in by hand, so step
    // past anything already taken rather than failing on a duplicate.
    while (await db.farmers.where('code').equals(code).first()) {
      code = padCode('FR-', await nextCounter('farmer'));
    }
  }

  const farmer: Farmer = {
    ...draft,
    id: uid('frm'),
    code,
    crops: Array.from(new Set([draft.primaryCropId, ...crops])),
    status: draft.status ?? 'active',
    registeredAt: draft.registeredAt || today(),
    archived: false,
  };

  await db.farmers.put(farmer);
  await audit.record(user, 'farmer', farmer.id, 'create', `Registered ${farmer.code}, ${farmer.firstName} ${farmer.lastName}`, { after: farmer });
  return farmer;
}

export async function update(user: User, id: ID, patch: Partial<Farmer>): Promise<Farmer> {
  assertCan(user, 'farmer.edit');
  const before = await db.farmers.get(id);
  if (!before) throw new ValidationError('That farmer no longer exists.');

  const after: Farmer = { ...before, ...patch, id: before.id };
  after.code = (patch.code?.trim() || before.code).trim();
  validate(after);
  if (after.code !== before.code) await assertCodeFree(after.code, before.id);
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

/** How many records hang off a farmer. Any at all means they cannot be deleted. */
export async function historyCount(id: ID): Promise<number> {
  const counts = await Promise.all([
    db.transactions.where('farmerId').equals(id).count(),
    db.harvests.where('farmerId').equals(id).count(),
    db.activities.where('farmerId').equals(id).count(),
    db.payments.where('farmerId').equals(id).count(),
    db.workdays.where('farmerId').equals(id).count(),
  ]);
  return counts.reduce((s, n) => s + n, 0);
}

/**
 * Delete a farmer for good. Only allowed when nothing was ever recorded for
 * them (a typo or a duplicate). Anyone with history is archived instead, so
 * their payments and ledger keep pointing at a real person.
 */
export async function remove(user: User, id: ID): Promise<void> {
  assertCan(user, 'farmer.archive');
  const before = await db.farmers.get(id);
  if (!before) return;
  if ((await historyCount(id)) > 0) {
    throw new ValidationError(`${before.code} has records in the books, so it can only be archived, not deleted.`);
  }
  await db.transaction('rw', [db.farmers, db.documents, db.audit], async () => {
    await db.documents.where('farmerId').equals(id).delete();
    await db.farmers.delete(id);
  });
  await audit.record(user, 'farmer', id, 'delete', `Deleted ${before.code}, ${before.firstName} ${before.lastName}`, { before });
}

/**
 * Farmers with history are archived, never deleted: their ledger history has to remain
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
