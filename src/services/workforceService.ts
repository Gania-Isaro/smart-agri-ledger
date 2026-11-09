/**
 * Daily work register.
 *
 * The manager records which farmers worked on a day, each with a photo taken
 * on the spot. Every day posts a "work" credit to that farmer's ledger, so
 * what they are owed flows into balances and payments like any other credit.
 * The owner reads the totals: per person, per week, per month and overall.
 * Totals are always folded from the day records, never typed or stored.
 */

import { db, getSetting, setSetting } from '../db/db';
import { uid } from '../lib/id';
import { addDays, monthKey, nowStamp, parseISODate, toISODate, today } from '../lib/date';
import { toPositiveMoney } from '../domain/money';
import { assertCan } from '../domain/rbac';
import type { Farmer, ID, ISODate, User, WorkDay } from '../domain/types';
import * as audit from './audit';
import { ValidationError } from './farmerService';
import { postSystem, voidTransaction } from './ledgerService';
import { refreshFarmerStatus } from './activityService';

import { tx as T } from '../i18n/tx';
const RATE_KEY = 'work.dailyRate';
export const DEFAULT_DAILY_RATE = 3000;

/* ----------------------------------------------------------------- dates */

/** Monday of the week that `iso` falls in. Weeks run Monday to Sunday. */
export function weekStart(iso: ISODate): ISODate {
  const d = parseISODate(iso);
  const offset = (d.getDay() + 6) % 7; // Monday = 0 ... Sunday = 6
  d.setDate(d.getDate() - offset);
  return toISODate(d);
}

export function weekDays(start: ISODate): ISODate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/* ------------------------------------------------------------- daily pay */

/** The usual pay for one day, used to prefill the form. */
export async function dailyRate(): Promise<number> {
  return getSetting<number>(RATE_KEY, DEFAULT_DAILY_RATE);
}

export async function setDailyRate(user: User, value: number | string): Promise<number> {
  assertCan(user, 'worker.manage');
  const rate = toPositiveMoney(value, 'Daily pay');
  await setSetting(RATE_KEY, rate);
  await audit.record(user, 'setting', RATE_KEY, 'update', `Usual daily pay set to ${rate} RWF`);
  return rate;
}

/* -------------------------------------------------------------- work days */

export interface WorkDayInput {
  farmerId: ID;
  date?: ISODate;
  amount: number | string;
  photo: string;
  photoTakenAt: string;
  notes?: string;
}

export async function recordDay(user: User, input: WorkDayInput): Promise<WorkDay> {
  assertCan(user, 'worker.manage');
  const farmer = await db.farmers.get(input.farmerId);
  if (!farmer) throw new ValidationError(T('Choose who worked.'), 'farmerId');
  if (farmer.archived) throw new ValidationError(T('{code} is archived. Restore the farmer first.', { code: farmer.code }), 'farmerId');

  const date = input.date || today();
  if (date > today()) throw new ValidationError(T('A work day cannot be in the future.'), 'date');
  if (!input.photo?.startsWith('data:image/')) {
    throw new ValidationError(T('Take a photo of the person before saving.'), 'photo');
  }
  const amount = toPositiveMoney(input.amount, 'Pay for the day');

  const existing = await db.workdays.where('[farmerId+date]').equals([farmer.id, date]).first();
  if (existing) throw new ValidationError(T('{v} is already recorded for this day.', { v: fullName(farmer) }), 'farmerId');

  const day: WorkDay = {
    id: uid('wdy'),
    farmerId: farmer.id,
    date,
    amount,
    photo: input.photo,
    photoTakenAt: input.photoTakenAt || nowStamp(),
    notes: input.notes?.trim() || undefined,
    recordedBy: user.id,
    recordedAt: nowStamp(),
  };
  await db.workdays.put(day);

  // Recording a day is itself the authorised action, so the credit that goes
  // with it is a system posting, the same way a harvest posts its credit.
  const tx = await postSystem(user, {
    farmerId: farmer.id,
    type: 'work',
    amount,
    description: day.notes ? T("Day's work, {note}", { note: day.notes }) : T("Day's work"),
    date,
  });
  day.transactionId = tx.id;
  await db.workdays.put(day);

  await refreshFarmerStatus(farmer.id);
  // The photo is left out of the audit copy: it is large and already on the record.
  await audit.record(user, 'workday', day.id, 'create', `${fullName(farmer)} worked on ${date}, ${amount} RWF`, { after: { ...day, photo: undefined } });
  return day;
}

/**
 * Remove a day recorded by mistake. Its ledger credit is voided (never
 * deleted) and the reason stays in the audit trail.
 */
export async function removeDay(user: User, id: ID, reason: string): Promise<void> {
  assertCan(user, 'worker.manage');
  const why = reason.trim();
  if (why.length < 5) throw new ValidationError(T('Give a reason of at least 5 characters.'));
  const before = await db.workdays.get(id);
  if (!before) return;
  const farmer = await db.farmers.get(before.farmerId);

  if (before.transactionId) {
    const tx = await db.transactions.get(before.transactionId);
    if (tx && !tx.voided) await voidTransaction(user, tx.id, `Work day removed: ${why}`);
  }
  await db.workdays.delete(id);
  await refreshFarmerStatus(before.farmerId);
  await audit.record(user, 'workday', id, 'delete', `Removed ${farmer ? fullName(farmer) : 'farmer'} on ${before.date} (${before.amount} RWF): ${why}`, { before: { ...before, photo: undefined } });
}

export async function daysBetween(from: ISODate, to: ISODate): Promise<WorkDay[]> {
  await pruneVoidedDays();
  return db.workdays.where('date').between(from, to, true, true).toArray();
}

/** Who has already been recorded on a date, keyed by farmer. */
export async function recordedOn(date: ISODate): Promise<Map<ID, WorkDay>> {
  await pruneVoidedDays();
  const rows = await db.workdays.where('date').equals(date).toArray();
  return new Map(rows.map((d) => [d.farmerId, d]));
}

export async function daysFor(farmerId: ID): Promise<WorkDay[]> {
  const rows = await db.workdays.where('farmerId').equals(farmerId).toArray();
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1));
}

/**
 * Remove work days whose ledger credit was voided from the Ledger screen.
 * Newer versions do this at the moment of voiding; this also tidies up days
 * left behind by older versions, so the totals never count pay that was
 * cancelled.
 */
async function pruneVoidedDays(): Promise<void> {
  const days = await db.workdays.toArray();
  const ids = days.map((d) => d.transactionId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  const txs = await db.transactions.bulkGet(ids);
  const voided = new Set(txs.filter((t) => t?.voided).map((t) => t!.id));
  const stale = days.filter((d) => d.transactionId && voided.has(d.transactionId)).map((d) => d.id);
  if (stale.length) await db.workdays.bulkDelete(stale);
}

/* ------------------------------------------------------------- read side */

export function fullName(f: Pick<Farmer, 'firstName' | 'lastName'>): string {
  return `${f.firstName} ${f.lastName}`.trim();
}

export interface WeekRow {
  farmer: Farmer;
  /** Keyed by ISO date; missing means the person did not work that day. */
  days: Record<ISODate, WorkDay | undefined>;
  daysWorked: number;
  total: number;
}

export interface WeekView {
  start: ISODate;
  end: ISODate;
  dates: ISODate[];
  rows: WeekRow[];
  totalByDate: Record<ISODate, number>;
  peopleByDate: Record<ISODate, number>;
  total: number;
  people: number;
  daysWorked: number;
}

/** Everyone who worked in one week, with their days and what they are owed. */
export async function weekView(anyDayInWeek: ISODate): Promise<WeekView> {
  const start = weekStart(anyDayInWeek);
  const dates = weekDays(start);
  const end = dates[6]!;
  const [days, farmers] = await Promise.all([daysBetween(start, end), db.farmers.toArray()]);
  const byId = new Map(farmers.map((f) => [f.id, f]));

  const rows = new Map<ID, WeekRow>();
  const totalByDate: Record<ISODate, number> = Object.fromEntries(dates.map((d) => [d, 0]));
  const peopleByDate: Record<ISODate, number> = Object.fromEntries(dates.map((d) => [d, 0]));

  for (const day of days) {
    const farmer = byId.get(day.farmerId);
    if (!farmer) continue;
    const row = rows.get(farmer.id) ?? { farmer, days: {}, daysWorked: 0, total: 0 };
    row.days[day.date] = day;
    row.daysWorked += 1;
    row.total += day.amount;
    rows.set(farmer.id, row);
    totalByDate[day.date] = (totalByDate[day.date] ?? 0) + day.amount;
    peopleByDate[day.date] = (peopleByDate[day.date] ?? 0) + 1;
  }

  const list = [...rows.values()].sort((a, b) => fullName(a.farmer).localeCompare(fullName(b.farmer)));
  return {
    start,
    end,
    dates,
    rows: list,
    totalByDate,
    peopleByDate,
    total: list.reduce((s, r) => s + r.total, 0),
    people: list.length,
    daysWorked: list.reduce((s, r) => s + r.daysWorked, 0),
  };
}

export interface PeriodTotal {
  key: string;
  total: number;
  daysWorked: number;
  people: number;
}

export interface PersonTotal {
  farmer: Farmer;
  daysWorked: number;
  total: number;
  thisWeek: number;
  thisMonth: number;
  lastDate: ISODate | null;
}

export interface WorkTotals {
  thisWeek: number;
  thisMonth: number;
  allTime: number;
  daysWorked: number;
  /** Most recent first. */
  byWeek: PeriodTotal[];
  /** Most recent first. */
  byMonth: PeriodTotal[];
  /** Only people with at least one day, highest total first. */
  byPerson: PersonTotal[];
}

/** Money needed this week, this month and in total, plus the breakdowns. */
export async function totals(asOf: ISODate = today()): Promise<WorkTotals> {
  await pruneVoidedDays();
  const [days, farmers] = await Promise.all([db.workdays.toArray(), db.farmers.toArray()]);
  const byId = new Map(farmers.map((f) => [f.id, f]));
  const currentWeek = weekStart(asOf);
  const currentMonth = monthKey(asOf);

  type Bucket = { total: number; daysWorked: number; people: Set<ID> };
  const weeks = new Map<string, Bucket>();
  const months = new Map<string, Bucket>();
  const perPerson = new Map<ID, PersonTotal>();

  let thisWeek = 0;
  let thisMonth = 0;
  let allTime = 0;

  for (const day of days) {
    const wk = weekStart(day.date);
    const mo = monthKey(day.date);
    allTime += day.amount;
    if (wk === currentWeek) thisWeek += day.amount;
    if (mo === currentMonth) thisMonth += day.amount;

    for (const [map, key] of [[weeks, wk], [months, mo]] as const) {
      const e = map.get(key) ?? { total: 0, daysWorked: 0, people: new Set<ID>() };
      e.total += day.amount;
      e.daysWorked += 1;
      e.people.add(day.farmerId);
      map.set(key, e);
    }

    const farmer = byId.get(day.farmerId);
    if (!farmer) continue;
    const p = perPerson.get(farmer.id) ?? { farmer, daysWorked: 0, total: 0, thisWeek: 0, thisMonth: 0, lastDate: null };
    p.daysWorked += 1;
    p.total += day.amount;
    if (wk === currentWeek) p.thisWeek += day.amount;
    if (mo === currentMonth) p.thisMonth += day.amount;
    if (!p.lastDate || day.date > p.lastDate) p.lastDate = day.date;
    perPerson.set(farmer.id, p);
  }

  const flatten = (map: Map<string, Bucket>): PeriodTotal[] =>
    [...map.entries()]
      .map(([key, e]) => ({ key, total: e.total, daysWorked: e.daysWorked, people: e.people.size }))
      .sort((a, b) => (a.key < b.key ? 1 : -1));

  return {
    thisWeek,
    thisMonth,
    allTime,
    daysWorked: days.length,
    byWeek: flatten(weeks),
    byMonth: flatten(months),
    byPerson: [...perPerson.values()].sort((a, b) => b.total - a.total || fullName(a.farmer).localeCompare(fullName(b.farmer))),
  };
}
