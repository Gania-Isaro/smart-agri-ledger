/**
 * Activity service.
 *
 * This is where the "+" button lands. One recorded activity can touch three
 * tables at once. The activity itself, a harvest record, and a ledger entry,
 * and they are written in a single Dexie transaction so a phone that dies
 * mid-save can never leave produce recorded with no money against it.
 */

import { db } from '../db/db';
import { uid } from '../lib/id';
import { nowStamp, today } from '../lib/date';
import { grossValue, toNonNegativeMoney, toPositiveMoney, toQuantity } from '../domain/money';
import { assertCan, can, type Permission } from '../domain/rbac';
import { BUILT_IN_ACTIVITY_TYPES } from '../domain/activityCatalog';
import { summarise } from '../domain/ledger';
import type {
  Activity,
  ActivityCategory,
  ActivityStatus,
  ActivityType,
  Direction,
  FieldSpec,
  Harvest,
  ID,
  Unit,
  User,
} from '../domain/types';
import * as audit from './audit';
import { postSystem } from './ledgerService';
import { ValidationError } from './farmerService';

import { tx as T, txLang } from '../i18n/tx';
import { ACTIVITY_LABELS_RW, FIELD_LABELS_RW } from '../i18n/strings';
/** A financial activity that would overdraw an account raises this instead of
 *  silently posting, so the UI can ask for an explicit confirmation. */
export class ConfirmationRequired extends Error {
  readonly detail: { balance: number; amount: number };
  constructor(message: string, detail: { balance: number; amount: number }) {
    super(message);
    this.name = 'ConfirmationRequired';
    this.detail = detail;
  }
}

export interface ActivityInput {
  farmerId: ID;
  typeId: string;
  date?: string;
  cropId?: ID;
  status?: ActivityStatus;
  notes?: string;
  data: Record<string, string | number | undefined>;
  documentIds?: ID[];
  /** Set by the UI after the user confirms an over-balance payment. */
  confirmOverdraft?: boolean;
}

/** The permission each activity category requires to record. */
function permissionFor(type: ActivityType): Permission {
  if (type.category === 'financial') {
    return type.postsLedger === 'payment' ? 'payment.create' : 'ledger.post';
  }
  if (type.category === 'harvest' && type.createsHarvest) return 'harvest.create';
  return 'activity.create';
}

export async function catalog(): Promise<ActivityType[]> {
  const stored = await db.activityTypes.toArray();
  if (stored.length === 0) return BUILT_IN_ACTIVITY_TYPES;
  const custom = stored.filter((t) => t.custom);
  const builtIn = BUILT_IN_ACTIVITY_TYPES;
  return [...builtIn, ...custom.filter((c) => !builtIn.some((b) => b.id === c.id))];
}

/** Activity types the given user is actually allowed to record. */
export function allowedTypes(user: User | null, types: ActivityType[]): ActivityType[] {
  return types.filter((t) => can(user, permissionFor(t)));
}

/* ------------------------------------------------- custom activity types */

/** The building blocks a custom type can be assembled from. */
export const CUSTOM_FIELD_LIBRARY: { key: string; label: string; spec: FieldSpec }[] = [
  { key: 'quantity', label: 'Quantity and unit', spec: { key: 'quantity', label: 'Quantity', type: 'number', min: 0, half: true } },
  { key: 'unit', label: 'Unit', spec: { key: 'unit', label: 'Unit', type: 'select', half: true, options: [
    { value: 'KG', label: 'Kilogram (KG)' },
    { value: 'TONNE', label: 'Tonne' },
    { value: 'BAG', label: 'Bag' },
    { value: 'CRATE', label: 'Crate' },
    { value: 'LITRE', label: 'Litre' },
    { value: 'BUNCH', label: 'Bunch' },
    { value: 'PIECE', label: 'Piece' },
  ] } },
  { key: 'areaHa', label: 'Area covered', spec: { key: 'areaHa', label: 'Area covered', type: 'number', unit: 'ha', min: 0, half: true } },
  { key: 'hours', label: 'Duration in hours', spec: { key: 'hours', label: 'Duration', type: 'number', unit: 'hours', min: 0, half: true } },
  { key: 'people', label: 'Number of people', spec: { key: 'people', label: 'People involved', type: 'number', min: 0, half: true } },
  { key: 'inputName', label: 'Input or product used', spec: { key: 'inputName', label: 'Input used', type: 'text', half: true } },
  { key: 'location', label: 'Location', spec: { key: 'location', label: 'Location', type: 'text', half: true } },
  { key: 'cost', label: 'Cost (does not touch the ledger)', spec: { key: 'cost', label: 'Cost', type: 'currency', min: 0, half: true } },
  { key: 'attachment', label: 'Photo or document', spec: { key: 'attachment', label: 'Supporting document or photo', type: 'file' } },
];

function slugify(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * Create an activity type at runtime.
 *
 * Custom types are deliberately limited to descriptive fields: they can record
 * what happened, but they cannot post to the ledger. Letting a user invent a
 * money-moving activity would put the posting rules, the one thing the whole
 * ledger depends on, into a text box. Money still moves only through the
 * built-in financial activities, which have reviewed posting rules behind them.
 */
export async function createActivityType(
  user: User,
  input: { label: string; category: ActivityCategory; description?: string; fieldKeys: string[]; icon?: string },
): Promise<ActivityType> {
  assertCan(user, 'settings.manage');

  const label = input.label.trim();
  if (label.length < 2) throw new ValidationError(T('Give the activity a name.'), 'label');
  if (label.length > 48) throw new ValidationError(T('Keep the name under 48 characters.'), 'label');

  const existing = await catalog();
  if (existing.some((t) => t.label.toLowerCase() === label.toLowerCase())) {
    throw new ValidationError(T('An activity called "{label}" already exists.', { label }), 'label');
  }

  const base = slugify(label) || 'custom';
  let id = base;
  let n = 2;
  while (existing.some((t) => t.id === id)) id = `${base}_${n++}`;

  const chosen = CUSTOM_FIELD_LIBRARY.filter((f) => input.fieldKeys.includes(f.key)).map((f) => f.spec);

  const type: ActivityType = {
    id,
    label,
    category: input.category,
    icon: input.icon ?? 'dots',
    description: input.description?.trim() || undefined,
    custom: true,
    // No notes field here: every activity form already ends with a shared Notes
    // box, and adding one would render the same question twice.
    fields: chosen,
  };

  await db.activityTypes.put(type);
  await audit.record(user, 'activityType', type.id, 'create', `Created activity type "${label}"`, { after: type });
  return type;
}

/** Remove a custom type. Records already filed against it are untouched. */
export async function deleteActivityType(user: User, id: string): Promise<void> {
  assertCan(user, 'settings.manage');
  const type = await db.activityTypes.get(id);
  if (!type) throw new ValidationError(T('That activity type no longer exists.'));
  if (!type.custom) throw new ValidationError(T('Built-in activities cannot be removed.'));

  const used = await db.activities.where('typeId').equals(id).count();
  await db.activityTypes.delete(id);
  await audit.record(
    user,
    'activityType',
    id,
    'delete',
    `Removed activity type "${type.label}"${used ? ` (${used} existing records keep it)` : ''}`,
    { before: type },
  );
}

/* ------------------------------------------------------------ validation */

/** A form field's name in the language in use, for error messages. */
function fieldName(field: FieldSpec): string {
  return txLang() === 'rw' ? FIELD_LABELS_RW[field.key] ?? T(field.label) : field.label;
}

function validateFields(type: ActivityType, data: Record<string, string | number | undefined>) {
  for (const field of type.fields) {
    if (field.computed) continue;
    const raw = data[field.key];
    const empty = raw === undefined || raw === '' || raw === null;

    if (field.required && empty) {
      throw new ValidationError(T('{label} is required.', { label: fieldName(field) }), field.key);
    }
    if (empty) continue;

    if (field.type === 'number' || field.type === 'currency') {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new ValidationError(T('{label} must be a number.', { label: fieldName(field) }), field.key);
      if (n < 0) throw new ValidationError(T('{label} cannot be negative.', { label: fieldName(field) }), field.key);
      if (field.min !== undefined && n < field.min) {
        throw new ValidationError(T('{label} must be at least {min}.', { label: fieldName(field), min: field.min }), field.key);
      }
      if (field.max !== undefined && n > field.max) {
        throw new ValidationError(T('{label} cannot be more than {max}.', { label: fieldName(field), max: field.max }), field.key);
      }
    }
    if (field.type === 'select' && field.options && !field.options.some((o) => o.value === String(raw))) {
      throw new ValidationError(T('Choose a valid option for {label}.', { label: fieldName(field) }), field.key);
    }
  }
}

/** Recompute derived fields so a tampered client value never reaches storage. */
function applyComputed(type: ActivityType, data: Record<string, string | number | undefined>) {
  const out = { ...data };
  for (const field of type.fields) {
    if (field.computed === 'grossValue') {
      out[field.key] = grossValue(Number(out.quantity ?? 0), Number(out.pricePerUnit ?? 0));
    }
  }
  return out;
}

/* ---------------------------------------------------------------- create */

export async function createActivity(user: User, input: ActivityInput): Promise<Activity> {
  const types = await catalog();
  const type = types.find((t) => t.id === input.typeId);
  if (!type) throw new ValidationError(T('That activity type does not exist.'));

  assertCan(user, permissionFor(type));

  const farmer = await db.farmers.get(input.farmerId);
  if (!farmer) throw new ValidationError(T('Select a worker.'), 'farmerId');
  if (farmer.archived) throw new ValidationError(T('{code} is archived. Restore the worker before recording activity.', { code: farmer.code }));

  validateFields(type, input.data);
  const data = applyComputed(type, input.data);
  const date = input.date || today();
  if (date > today()) throw new ValidationError(T('An activity cannot be dated in the future.'), 'date');

  const at = nowStamp();
  const activityId = uid('act');
  const cropId = input.cropId || (data.cropId as string | undefined) || farmer.primaryCropId;

  /* ---- harvest side ---- */
  let harvest: Harvest | undefined;
  if (type.createsHarvest) {
    const quantity = toQuantity(data.quantity, 'Quantity');
    if (quantity <= 0) throw new ValidationError(T('Quantity must be greater than zero.'), 'quantity');
    const pricePerUnit = toNonNegativeMoney(data.pricePerUnit ?? 0, 'Price per unit');
    const deductions = toNonNegativeMoney(data.deductions ?? 0, 'Deductions');
    const gross = grossValue(quantity, pricePerUnit);
    if (deductions > gross) {
      throw new ValidationError(T('Deductions cannot exceed the value of the delivery.'), 'deductions');
    }

    harvest = {
      id: uid('hrv'),
      farmerId: farmer.id,
      cropId,
      activityId,
      date,
      quantity,
      unit: (data.unit as Unit) || 'KG',
      pricePerUnit,
      deductions,
      status: 'recorded',
      notes: input.notes,
      createdBy: user.id,
      createdAt: at,
      updatedAt: at,
    };
  }

  /* ---- financial side ---- */
  let ledgerAmount = 0;
  let ledgerDirection: Direction | undefined;
  if (type.postsLedger) {
    if (type.postsLedger === 'harvest') {
      ledgerAmount = grossValue(Number(data.quantity ?? 0), Number(data.pricePerUnit ?? 0));
    } else {
      ledgerAmount = toPositiveMoney(data.amount, 'Amount');
    }
    if (type.postsLedger === 'adjustment') ledgerDirection = (data.direction as Direction) || 'debit';

    // A payment larger than what is owed is legal but never accidental.
    if (type.postsLedger === 'payment' && !input.confirmOverdraft) {
      const txs = await db.transactions.where('farmerId').equals(farmer.id).toArray();
      const { balance } = summarise(txs);
      if (ledgerAmount > balance) {
        throw new ConfirmationRequired(
          T('{firstName} {lastName} is owed {v} RWF, but this payment is {v2} RWF. Paying more than the balance puts the account into advance.', { firstName: farmer.firstName, lastName: farmer.lastName, v: balance.toLocaleString(), v2: ledgerAmount.toLocaleString() }),
          { balance, amount: ledgerAmount },
        );
      }
    }
  }

  const activity: Activity = {
    id: activityId,
    farmerId: farmer.id,
    typeId: type.id,
    category: type.category,
    status: input.status ?? (type.category === 'financial' || type.createsHarvest ? 'completed' : 'completed'),
    date,
    cropId: type.category === 'financial' ? undefined : cropId,
    notes: input.notes,
    data,
    harvestId: harvest?.id,
    documentIds: input.documentIds ?? [],
    createdBy: user.id,
    createdAt: at,
    updatedAt: at,
  };

  await db.transaction('rw', [db.activities, db.harvests, db.transactions, db.counters, db.farmers, db.audit], async () => {
    if (harvest) await db.harvests.put(harvest);
    await db.activities.put(activity);
  });

  /* The ledger entry is posted after the record exists so it can reference it. */
  if (type.postsLedger && ledgerAmount > 0) {
    const tx = await postSystem(user, {
      farmerId: farmer.id,
      type: type.postsLedger,
      amount: ledgerAmount,
      direction: ledgerDirection,
      description: describeTransaction(type, data, harvest?.unit),
      date,
      reference: data.reference as string | undefined,
      harvestId: harvest?.id,
      activityId: activity.id,
    });
    activity.transactionId = tx.id;
    await db.activities.put(activity);
  }

  /* Deductions taken at intake post as their own entry, so the farmer can see
     exactly what was withheld rather than a silently reduced credit. */
  if (harvest && harvest.deductions > 0) {
    await postSystem(user, {
      farmerId: farmer.id,
      type: 'deduction',
      amount: harvest.deductions,
      description: T('Deductions at intake'),
      date,
      harvestId: harvest.id,
      activityId: activity.id,
    });
  }

  await refreshFarmerStatus(farmer.id);
  await audit.record(user, 'activity', activity.id, 'create', `${type.label} recorded for ${farmer.code}`, { after: activity });
  return activity;
}

/** Activity name in the language in use when the record is written. */
function activityName(type: ActivityType): string {
  return txLang() === 'rw' ? ACTIVITY_LABELS_RW[type.id] ?? type.label : type.label;
}

function describeTransaction(
  type: ActivityType,
  data: Record<string, string | number | undefined>,
  unit?: string,
): string {
  if (type.createsHarvest) {
    return T('{activity}, {quantity} {unit} @ {price} RWF', { activity: activityName(type), quantity: data.quantity, unit: unit ?? data.unit ?? '', price: data.pricePerUnit });
  }
  const reason = (data.reason as string | undefined)?.trim();
  return reason ? `${activityName(type)}, ${reason}` : activityName(type);
}

/* ---------------------------------------------------------------- update */

export async function updateActivity(user: User, id: ID, patch: Partial<ActivityInput>): Promise<Activity> {
  assertCan(user, 'activity.edit');
  const before = await db.activities.get(id);
  if (!before) throw new ValidationError(T('That activity no longer exists.'));

  if (before.transactionId) {
    throw new ValidationError(
      T('This activity already changed what the worker is owed. Cancel that entry on the worker’s Account tab and record it again instead of editing it.'),
    );
  }

  const types = await catalog();
  const type = types.find((t) => t.id === before.typeId)!;
  const data = { ...before.data, ...(patch.data ?? {}) };
  validateFields(type, data);

  const after: Activity = {
    ...before,
    ...patch,
    data: applyComputed(type, data),
    id: before.id,
    updatedAt: nowStamp(),
  };
  await db.activities.put(after);
  await audit.record(user, 'activity', id, 'update', `Updated ${type.label} for activity ${id}`, { before, after });
  return after;
}

export async function setActivityStatus(user: User, ids: ID[], status: ActivityStatus): Promise<number> {
  assertCan(user, status === 'verified' ? 'activity.verify' : 'activity.edit');
  const rows = (await db.activities.bulkGet(ids)).filter(Boolean) as Activity[];
  const updated = rows.map((a) => ({ ...a, status, updatedAt: nowStamp() }));
  await db.activities.bulkPut(updated);
  await audit.record(user, 'activity', ids.join(','), 'update', `Set "${status}" on ${updated.length} activity record(s)`);
  return updated.length;
}

/* ------------------------------------------------------------------ read */

export async function listActivities(filter?: { farmerId?: ID; category?: ActivityCategory }): Promise<Activity[]> {
  let rows: Activity[];
  if (filter?.farmerId) rows = await db.activities.where('farmerId').equals(filter.farmerId).toArray();
  else rows = await db.activities.toArray();
  if (filter?.category) rows = rows.filter((a) => a.category === filter.category);
  return rows.sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
}

/**
 * Keep the farmer status honest. Status is a summary of what the records say,
 * so it is recomputed rather than typed. The one exception is `disputed`,
 * which a human sets deliberately and which this must not clear.
 */
export async function refreshFarmerStatus(farmerId: ID): Promise<void> {
  const farmer = await db.farmers.get(farmerId);
  if (!farmer || farmer.archived || farmer.status === 'disputed') return;

  const [txs, harvests, activities, workDays] = await Promise.all([
    db.transactions.where('farmerId').equals(farmerId).toArray(),
    db.harvests.where('farmerId').equals(farmerId).toArray(),
    db.activities.where('farmerId').equals(farmerId).toArray(),
    db.workdays.where('farmerId').equals(farmerId).count(),
  ]);
  const { balance, paid } = summarise(txs);

  let status = farmer.status;
  if (balance > 0 && (harvests.length > 0 || workDays > 0)) status = 'awaiting_payment';
  else if (paid > 0 && balance <= 0) status = 'paid';
  else if (harvests.length > 0) status = 'harvested';
  else if (activities.some((a) => a.category === 'farming')) status = 'in_progress';
  else status = 'active';

  if (status !== farmer.status) await db.farmers.put({ ...farmer, status });
}

export function fieldsFor(type: ActivityType): FieldSpec[] {
  return type.fields;
}
