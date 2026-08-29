/**
 * Local database.
 *
 * IndexedDB via Dexie. This is the whole persistence layer: the app is offline
 * first, so the device holds the real records and nothing is lost when the
 * network is not there. Every write goes through the service layer, never
 * straight from a component.
 */

import Dexie, { type Table } from 'dexie';
import type {
  Activity,
  ActivityType,
  AppNotification,
  AuditEvent,
  Cooperative,
  Crop,
  DocumentRecord,
  Farmer,
  Harvest,
  LedgerTransaction,
  Payment,
  PaymentBatch,
  SavedView,
  User,
} from '../domain/types';

/** Monotonic counters behind human-facing codes (FR-001, TXN-...). */
export interface Counter {
  key: string;
  value: number;
}

export interface Setting {
  key: string;
  value: unknown;
}

export class AgriLedgerDB extends Dexie {
  users!: Table<User, string>;
  cooperatives!: Table<Cooperative, string>;
  crops!: Table<Crop, string>;
  farmers!: Table<Farmer, string>;
  activityTypes!: Table<ActivityType, string>;
  activities!: Table<Activity, string>;
  harvests!: Table<Harvest, string>;
  payments!: Table<Payment, string>;
  batches!: Table<PaymentBatch, string>;
  transactions!: Table<LedgerTransaction, string>;
  audit!: Table<AuditEvent, string>;
  documents!: Table<DocumentRecord, string>;
  notifications!: Table<AppNotification, string>;
  views!: Table<SavedView, string>;
  counters!: Table<Counter, string>;
  settings!: Table<Setting, string>;

  constructor() {
    super('smart_agri_ledger');

    this.version(1).stores({
      users: 'id, email, role',
      cooperatives: 'id, code, district',
      crops: 'id, name',
      farmers: 'id, &code, lastName, district, cooperativeId, status, primaryCropId, archived',
      activityTypes: 'id, category',
      activities: 'id, farmerId, typeId, category, status, date, cropId, [farmerId+date]',
      harvests: 'id, farmerId, cropId, date, status, grade, batchId, [farmerId+date]',
      payments: 'id, farmerId, status, date, batchId, &reference',
      batches: 'id, &code, status, period',
      // The ledger is queried by farmer and by date far more than anything else.
      transactions: 'id, &code, farmerId, type, date, harvestId, paymentId, batchId, voided, [farmerId+date]',
      audit: 'id, entity, entityId, userId, at',
      documents: 'id, farmerId, activityId',
      notifications: 'id, kind, read, at',
      views: 'id, screen',
      counters: 'key',
      settings: 'key',
    });

    /*
     * v2 — crop colours moved from fixed hex to design-system tokens so charts
     * follow the light/dark theme. Same schema, so this only rewrites data.
     */
    this.version(2).upgrade(async (tx) => {
      const ORDER = [
        'crop_maize', 'crop_beans', 'crop_irish', 'crop_coffee',
        'crop_rice', 'crop_cassava', 'crop_banana', 'crop_soy',
      ];
      const crops = tx.table('crops');
      const rows = await crops.toArray();
      await Promise.all(
        rows.map((c: Crop, i: number) => {
          const slot = ORDER.indexOf(c.id);
          const colour = `var(--cat-${(slot >= 0 ? slot : i % 8) + 1})`;
          return colour === c.colour ? Promise.resolve() : crops.put({ ...c, colour });
        }),
      );
    });
  }
}

export const db = new AgriLedgerDB();

/**
 * Next value of a named counter, inside whatever transaction the caller already
 * opened. Dexie transactions are serialised per table, so two concurrent
 * callers cannot be handed the same number.
 */
export async function nextCounter(key: string): Promise<number> {
  const row = await db.counters.get(key);
  const value = (row?.value ?? 0) + 1;
  await db.counters.put({ key, value });
  return value;
}

/** Reserve a contiguous block of `count` numbers. Returns the first of them. */
export async function reserveCounters(key: string, count: number): Promise<number> {
  const row = await db.counters.get(key);
  const first = (row?.value ?? 0) + 1;
  await db.counters.put({ key, value: first + count - 1 });
  return first;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}
