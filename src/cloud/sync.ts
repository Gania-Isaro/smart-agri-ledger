/**
 * Two-way sync between this device and the cooperative's online copy.
 *
 * The phone stays the place the app reads and writes, so it keeps working
 * with no signal. A Dexie middleware notes every record that changes; those
 * are uploaded when there is internet, and changes made on other phones are
 * downloaded and written in. The server clock orders changes, and the latest
 * change to a record wins.
 *
 * Two phones that were both offline can hand out the same farmer number or
 * transaction code. When a downloaded record clashes with a different local
 * record on one of those codes, the local one is renamed (FR-007 becomes
 * FR-007-2) and uploaded again, so nothing is lost and both phones agree.
 */

import Dexie, { type DBCore, type DBCoreMutateRequest, type Middleware } from 'dexie';
import type { AgriLedgerDB } from '../db/db';
import { supabase } from './client';

/** Tables that stay on this device only. */
const LOCAL_ONLY = new Set(['views', 'notifications']);

/** Fields that must be unique per table, used to resolve clashes. */
const UNIQUE: Record<string, string> = {
  farmers: 'code',
  transactions: 'code',
  payments: 'reference',
  batches: 'code',
};

const BATCH = 200;
const PAGE = 500;
const INTERVAL_MS = 30_000;

export interface SyncStatus {
  /** Changes on this device not yet uploaded. */
  pending: number;
  /** Last time a full upload and download finished. */
  lastSyncedAt: string | null;
  syncing: boolean;
  error: string | null;
}

type Listener = (s: SyncStatus) => void;

interface Engine {
  coopId: string;
  /** The owner tags their own audit entries so managers never read them. */
  isOwner: boolean;
  /** The manager's group; null for the owner. */
  myGroup: string | null;
  db: AgriLedgerDB;
  pending: Map<string, Set<string>>;
  status: SyncStatus;
  listeners: Set<Listener>;
  onRemote: () => void;
  timer: number | null;
  pushTimer: number | null;
  running: Promise<void> | null;
  stop: () => void;
}

let engine: Engine | null = null;

/* ------------------------------------------------------- pending changes */

const pendingKey = (coopId: string) => `agri.sync.pending.${coopId}`;
const cursorKey = (coopId: string) => `agri.sync.cursor.${coopId}`;
const lastKey = (coopId: string) => `agri.sync.last.${coopId}`;

function loadPending(coopId: string): Map<string, Set<string>> {
  try {
    const raw = JSON.parse(localStorage.getItem(pendingKey(coopId)) ?? '{}') as Record<string, string[]>;
    return new Map(Object.entries(raw).map(([t, ids]) => [t, new Set(ids)]));
  } catch {
    return new Map();
  }
}

function savePending(e: Engine) {
  const obj: Record<string, string[]> = {};
  for (const [t, ids] of e.pending) if (ids.size) obj[t] = [...ids];
  try {
    localStorage.setItem(pendingKey(e.coopId), JSON.stringify(obj));
  } catch {
    /* storage full or blocked: the changes are still uploaded this session */
  }
}

function countPending(e: Engine): number {
  let n = 0;
  for (const ids of e.pending.values()) n += ids.size;
  return n;
}

function setStatus(e: Engine, patch: Partial<SyncStatus>) {
  e.status = { ...e.status, ...patch, pending: countPending(e) };
  for (const l of e.listeners) l(e.status);
}

function markChanged(table: string, keys: unknown[]) {
  const e = engine;
  if (!e || !keys.length) return;
  const set = e.pending.get(table) ?? new Set<string>();
  for (const k of keys) if (k !== undefined && k !== null) set.add(String(k));
  e.pending.set(table, set);
  savePending(e);
  setStatus(e, {});
  // Upload shortly after the last change rather than on every keystroke.
  if (e.pushTimer) window.clearTimeout(e.pushTimer);
  e.pushTimer = window.setTimeout(() => void syncNow(), 1500);
}

/* ----------------------------------------------------------- middleware */

/** Marks transactions that are writing downloaded records, so they are not uploaded again. */
const REMOTE = '__agriRemote';

export function syncMiddleware(): Middleware<DBCore> {
  return {
    stack: 'dbcore',
    name: 'agriCloudSync',
    create(down) {
      return {
        ...down,
        table(name) {
          const t = down.table(name);
          if (LOCAL_ONLY.has(name)) return t;
          const keyPath = t.schema.primaryKey.keyPath as string;
          return {
            ...t,
            async mutate(req: DBCoreMutateRequest) {
              const res = await t.mutate(req);
              if ((req.trans as unknown as Record<string, unknown>)[REMOTE]) return res;
              if (req.type === 'add' || req.type === 'put') {
                markChanged(name, req.values.map((v) => (v as Record<string, unknown>)[keyPath]));
              } else if (req.type === 'delete') {
                markChanged(name, req.keys as unknown[]);
              }
              return res;
            },
          };
        },
      };
    },
  };
}

/* ---------------------------------------------------------------- upload */

/** Tables whose rows belong to one worker, and so to that worker's group. */
const BY_WORKER = new Set(['activities', 'harvests', 'payments', 'transactions', 'workdays', 'documents']);
const OWNER_ONLY = '__owner';

/**
 * Which group a record belongs to, for the database to decide who may read it.
 * Workers belong to their group, everything about a worker follows them, and
 * a group record belongs to itself. Shared records (crops, settings, activity
 * types, counters, people) have no group.
 */
async function groupOf(e: Engine, table: string, row: Record<string, unknown> | undefined, workerGroup: Map<string, string>): Promise<string | null> {
  if (!row) return e.myGroup;
  if (table === 'farmers') return (row.cooperativeId as string) ?? null;
  if (table === 'cooperatives') return (row.id as string) ?? null;
  if (table === 'audit') return e.isOwner ? OWNER_ONLY : e.myGroup;
  if (BY_WORKER.has(table) && row.farmerId) {
    const id = row.farmerId as string;
    if (!workerGroup.has(id)) {
      const f = (await e.db.table('farmers').get(id)) as { cooperativeId?: string } | undefined;
      workerGroup.set(id, f?.cooperativeId ?? '');
    }
    return workerGroup.get(id) || e.myGroup;
  }
  return null;
}

async function push(e: Engine) {
  const sb = supabase();
  const workerGroup = new Map<string, string>();
  for (const [table, ids] of [...e.pending.entries()]) {
    const list = [...ids];
    for (let i = 0; i < list.length; i += BATCH) {
      const chunk = list.slice(i, i + BATCH);
      const rows = await e.db.table(table).bulkGet(chunk);
      const payload = [];
      for (let j = 0; j < chunk.length; j++) {
        const row = rows[j] as Record<string, unknown> | undefined;
        payload.push({
          coop_id: e.coopId,
          tbl: table,
          id: chunk[j]!,
          data: row ?? null,
          deleted: !row,
          group_id: await groupOf(e, table, row, workerGroup),
        });
      }
      const { error } = await sb.from('records').upsert(payload, { onConflict: 'coop_id,tbl,id' });
      if (error && error.code === '42501') {
        // Something this person may not write (for example another group's
        // record): send the rest one by one and drop the refused ones.
        for (const one of payload) {
          const r = await sb.from('records').upsert([one], { onConflict: 'coop_id,tbl,id' });
          if (r.error && r.error.code !== '42501') throw new Error(r.error.message);
        }
      } else if (error) throw new Error(error.message);
      for (const id of chunk) ids.delete(id);
      if (!ids.size) e.pending.delete(table);
      savePending(e);
      setStatus(e, {});
    }
  }
}

/* -------------------------------------------------------------- download */

interface RemoteRow {
  tbl: string;
  id: string;
  data: Record<string, unknown> | null;
  deleted: boolean;
  updated_at: string;
}

async function applyRows(e: Engine, rows: RemoteRow[]): Promise<number> {
  const tables = [...new Set(rows.map((r) => r.tbl))].filter((t) => e.db.tables.some((x) => x.name === t));
  if (!tables.length) return 0;
  let applied = 0;
  const renamed: { table: string; id: string }[] = [];

  await e.db.transaction('rw', tables.map((t) => e.db.table(t)), async () => {
    (Dexie.currentTransaction!.idbtrans as unknown as Record<string, unknown>)[REMOTE] = true;
    for (const r of rows) {
      if (!tables.includes(r.tbl)) continue;
      // A local edit not uploaded yet is newer than what the server has.
      if (e.pending.get(r.tbl)?.has(r.id)) continue;
      const table = e.db.table(r.tbl);
      if (r.deleted || !r.data) {
        await table.delete(r.id);
        applied++;
        continue;
      }
      if (r.tbl === 'counters') {
        // Counters only ever move forward, so codes are never handed out twice.
        const local = (await table.get(r.id)) as { value?: number } | undefined;
        if (local && (local.value ?? 0) >= ((r.data.value as number) ?? 0)) continue;
      }
      const field = UNIQUE[r.tbl];
      if (field && r.data[field] !== undefined) {
        const clash = (await table.where(field).equals(r.data[field] as string).first()) as Record<string, unknown> | undefined;
        if (clash && clash.id !== r.id) {
          let n = 2;
          let next = `${clash[field]}-${n}`;
          while (await table.where(field).equals(next).first()) next = `${clash[field]}-${++n}`;
          await table.put({ ...clash, [field]: next });
          renamed.push({ table: r.tbl, id: String(clash.id) });
        }
      }
      await table.put(r.data);
      applied++;
    }
  });

  // Renamed local records must be uploaded under their new code.
  for (const r of renamed) markChanged(r.table, [r.id]);
  return applied;
}

async function pull(e: Engine): Promise<number> {
  const sb = supabase();
  let since = localStorage.getItem(cursorKey(e.coopId)) ?? '1970-01-01T00:00:00Z';
  let total = 0;
  for (;;) {
    const { data, error } = await sb
      .from('records')
      .select('tbl,id,data,deleted,updated_at')
      .eq('coop_id', e.coopId)
      .gt('updated_at', since)
      .order('updated_at', { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as RemoteRow[];
    if (!rows.length) break;
    total += await applyRows(e, rows);
    since = rows[rows.length - 1]!.updated_at;
    try {
      localStorage.setItem(cursorKey(e.coopId), since);
    } catch {
      /* next session simply downloads a little more */
    }
    if (rows.length < PAGE) break;
  }
  return total;
}

/* ---------------------------------------------------------------- control */

/** Upload, then download. Safe to call at any time; overlapping calls share one run. */
export function syncNow(): Promise<void> {
  const e = engine;
  if (!e) return Promise.resolve();
  if (e.running) return e.running;
  if (!navigator.onLine) {
    setStatus(e, { error: null });
    return Promise.resolve();
  }
  e.running = (async () => {
    setStatus(e, { syncing: true });
    try {
      await push(e);
      const changed = await pull(e);
      // Records renamed during the download are uploaded straight away.
      if (countPending(e)) await push(e);
      const at = new Date().toISOString();
      try {
        localStorage.setItem(lastKey(e.coopId), at);
      } catch {
        /* ignore */
      }
      setStatus(e, { syncing: false, error: null, lastSyncedAt: at });
      if (changed) e.onRemote();
    } catch (err) {
      setStatus(e, { syncing: false, error: (err as Error).message || 'Sync failed' });
    } finally {
      e.running = null;
    }
  })();
  return e.running;
}

/**
 * Start syncing one cooperative's database. Returns once the first download
 * has finished (or failed), so a phone joining an existing cooperative opens
 * with its records already there.
 */
export async function startSync(
  db: AgriLedgerDB,
  coopId: string,
  onRemote: () => void,
  who: { isOwner: boolean; myGroup: string | null } = { isOwner: true, myGroup: null },
): Promise<void> {
  stopSync();
  const e: Engine = {
    coopId,
    isOwner: who.isOwner,
    myGroup: who.myGroup,
    db,
    pending: loadPending(coopId),
    status: { pending: 0, lastSyncedAt: localStorage.getItem(lastKey(coopId)), syncing: false, error: null },
    listeners: new Set(),
    onRemote,
    timer: null,
    pushTimer: null,
    running: null,
    stop: () => undefined,
  };
  engine = e;

  const onOnline = () => void syncNow();
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow();
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  e.timer = window.setInterval(() => void syncNow(), INTERVAL_MS);
  e.stop = () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
    if (e.timer) window.clearInterval(e.timer);
    if (e.pushTimer) window.clearTimeout(e.pushTimer);
  };

  setStatus(e, {});

  // Records uploaded before groups existed carry no group. The owner's phone
  // uploads everything once more so each record gets its group.
  const tagged = `agri.sync.grouped.${coopId}`;
  if (who.isOwner && !localStorage.getItem(tagged)) {
    for (const t of db.tables) {
      if (LOCAL_ONLY.has(t.name)) continue;
      const keys = (await t.toCollection().primaryKeys()) as unknown[];
      if (keys.length) markChanged(t.name, keys);
    }
    try {
      localStorage.setItem(tagged, '1');
    } catch {
      /* it simply runs again next time */
    }
  }
  await syncNow();
}

export function stopSync(): void {
  engine?.stop();
  engine = null;
}

export function syncStatus(): SyncStatus | null {
  return engine?.status ?? null;
}

export function onSyncStatus(l: Listener): () => void {
  const e = engine;
  if (!e) return () => undefined;
  e.listeners.add(l);
  l(e.status);
  return () => e.listeners.delete(l);
}

/** Forget this device's sync position, e.g. after signing out. */
export function forgetDevice(coopId: string): void {
  for (const k of [pendingKey(coopId), cursorKey(coopId), lastKey(coopId)]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}
