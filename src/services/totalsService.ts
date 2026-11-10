/**
 * Money totals for the owner: what was spent on work and produce, what was
 * paid and what is still owed, per worker and per group, for any period.
 *
 * Everything is folded from the ledger and the work days, the same sources as
 * every other screen, so these totals always agree with the rest of the app.
 */

import { db } from '../db/db';
import { counts } from '../domain/ledger';
import { addDays, monthKey, today } from '../lib/date';
import { weekStart } from './workforceService';
import type { Cooperative, Farmer, ID, ISODate } from '../domain/types';

export type Period = 'today' | 'week' | 'month' | 'year' | 'all';

export interface Range {
  from: ISODate;
  to: ISODate;
}

/** The dates a period covers, ending at `asOf` (today by default). */
export function periodRange(period: Period, asOf: ISODate = today()): Range {
  switch (period) {
    case 'today':
      return { from: asOf, to: asOf };
    case 'week': {
      const start = weekStart(asOf);
      return { from: start, to: addDays(start, 6) };
    }
    case 'month': {
      const m = monthKey(asOf);
      const [y, mo] = m.split('-').map(Number);
      const last = new Date(y!, mo!, 0).getDate();
      return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
    }
    case 'year': {
      const y = asOf.slice(0, 4);
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    default:
      return { from: '0000-01-01', to: '9999-12-31' };
  }
}

export interface Money {
  /** Days worked in the period. */
  days: number;
  /** Pay for days worked. */
  workPay: number;
  /** Value of produce brought in. */
  produce: number;
  /** Bonuses, reimbursements and corrections in the worker's favour. */
  other: number;
  /** Deductions and corrections against the worker. */
  deductions: number;
  /** Advances and loans given. */
  advances: number;
  /** Money handed over. */
  paid: number;
  /** What the cooperative still owes today (all time, not just the period). */
  owedNow: number;
}

export interface WorkerTotal extends Money {
  farmer: Farmer;
  groupId: ID;
}

export interface GroupTotal extends Money {
  groupId: ID;
  name: string;
  workers: number;
}

export interface Totals {
  range: Range;
  workers: WorkerTotal[];
  groups: GroupTotal[];
  all: GroupTotal;
}

const empty = (): Money => ({ days: 0, workPay: 0, produce: 0, other: 0, deductions: 0, advances: 0, paid: 0, owedNow: 0 });

/** Total for the period: work pay plus produce plus other credits, minus deductions. */
export function totalCost(m: Money): number {
  return m.workPay + m.produce + m.other - m.deductions;
}

export async function totals(range: Range): Promise<Totals> {
  const [farmers, groups, txs, days] = await Promise.all([
    db.farmers.toArray(),
    db.cooperatives.toArray(),
    db.transactions.toArray(),
    db.workdays.toArray(),
  ]);

  const perWorker = new Map<ID, WorkerTotal>();
  const row = (f: Farmer) => {
    let r = perWorker.get(f.id);
    if (!r) {
      r = { ...empty(), farmer: f, groupId: f.cooperativeId };
      perWorker.set(f.id, r);
    }
    return r;
  };
  const byId = new Map(farmers.map((f) => [f.id, f]));
  const inRange = (d: ISODate) => d >= range.from && d <= range.to;

  for (const t of txs) {
    if (!counts(t)) continue;
    const f = byId.get(t.farmerId);
    if (!f) continue;
    const r = row(f);
    // Balance today, whatever the period.
    r.owedNow += t.direction === 'credit' ? t.amount : -t.amount;
    if (!inRange(t.date)) continue;
    switch (t.type) {
      case 'work': r.workPay += t.amount; break;
      case 'harvest': r.produce += t.amount; break;
      case 'bonus':
      case 'reimbursement': r.other += t.amount; break;
      case 'adjustment':
        if (t.direction === 'credit') r.other += t.amount;
        else r.deductions += t.amount;
        break;
      case 'deduction': r.deductions += t.amount; break;
      case 'advance':
      case 'loan': r.advances += t.amount; break;
      case 'payment': r.paid += t.amount; break;
    }
  }
  for (const d of days) {
    const f = byId.get(d.farmerId);
    if (f && inRange(d.date)) row(f).days += 1;
  }

  // Only people with something in the period, or money still owed either way.
  const workers = [...perWorker.values()]
    .filter((w) => w.days || w.workPay || w.produce || w.other || w.deductions || w.advances || w.paid || w.owedNow)
    .sort((a, b) => a.groupId.localeCompare(b.groupId) || `${a.farmer.firstName} ${a.farmer.lastName}`.localeCompare(`${b.farmer.firstName} ${b.farmer.lastName}`));

  const name = new Map(groups.map((g: Cooperative) => [g.id, g.name]));
  const perGroup = new Map<ID, GroupTotal>();
  const all: GroupTotal = { ...empty(), groupId: '', name: '', workers: 0 };
  const add = (into: GroupTotal, w: WorkerTotal) => {
    into.workers += 1;
    for (const k of Object.keys(empty()) as (keyof Money)[]) {
      // Owed now counts only what is owed, not advances carried by others.
      into[k] += k === 'owedNow' ? Math.max(w[k], 0) : w[k];
    }
  };
  for (const w of workers) {
    let g = perGroup.get(w.groupId);
    if (!g) {
      g = { ...empty(), groupId: w.groupId, name: name.get(w.groupId) ?? '-', workers: 0 };
      perGroup.set(w.groupId, g);
    }
    add(g, w);
    add(all, w);
  }
  return { range, workers, groups: [...perGroup.values()].sort((a, b) => a.name.localeCompare(b.name)), all };
}
