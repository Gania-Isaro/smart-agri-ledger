/**
 * Keeping the data safe beyond this app.
 *
 * Two things: the phone is asked to keep the app's data even when it runs
 * low on space, and the owner can download every record into one file to
 * keep somewhere else. The file is the copy that survives whatever happens
 * to the phones or the online service.
 */

import { db, getSetting, setSetting } from '../db/db';
import { assertCan } from '../domain/rbac';
import type { User } from '../domain/types';
import { nowStamp, today } from '../lib/date';

/** Tables that only help this phone (screen layouts, notifications) are left out. */
const SKIP = new Set(['views', 'notifications']);

const LAST_KEY = 'backup.last';
/** Days after which the owner is reminded to download a new backup. */
export const REMIND_AFTER_DAYS = 7;

/**
 * Ask the browser to keep this app's data for good. Without this, a phone
 * that is low on space may clear it. Safe to call many times; returns whether
 * the data is protected.
 */
export async function protectStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageProtected(): Promise<boolean> {
  try {
    return Boolean(await navigator.storage?.persisted?.());
  } catch {
    return false;
  }
}

export interface BackupFile {
  app: 'smart-agri-ledger';
  format: 1;
  cooperative: string;
  madeAt: string;
  madeBy: string;
  /** Rows per table, so anyone can check the file is complete. */
  counts: Record<string, number>;
  tables: Record<string, unknown[]>;
}

/** Every record on this device, in one file. Owner only. */
export async function makeBackup(user: User, cooperative: string): Promise<{ name: string; bytes: number; counts: Record<string, number> }> {
  assertCan(user, 'settings.manage');
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of db.tables) {
    if (SKIP.has(t.name)) continue;
    const rows = await t.toArray();
    tables[t.name] = rows;
    counts[t.name] = rows.length;
  }
  const file: BackupFile = {
    app: 'smart-agri-ledger',
    format: 1,
    cooperative,
    madeAt: nowStamp(),
    madeBy: user.name,
    counts,
    tables,
  };
  const text = JSON.stringify(file);
  const safe = cooperative.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'cooperative';
  const name = `smart-agri-ledger-backup-${safe}-${today()}.json`;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  await setSetting(LAST_KEY, file.madeAt);
  return { name, bytes: blob.size, counts };
}

/** When the last backup was downloaded, on any of the owner's devices. */
export async function lastBackup(): Promise<string | null> {
  return getSetting<string | null>(LAST_KEY, null);
}

/** Whole days since the last backup, or null if there has never been one. */
export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}
