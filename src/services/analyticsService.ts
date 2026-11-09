/** Read models behind the dashboard and the reports section. */

import { db } from '../db/db';
import { grossValue, weightKg } from '../domain/money';
import { monthKey, monthLabel } from '../lib/date';
import { counts, summarise } from '../domain/ledger';
import type { Crop, ID } from '../domain/types';
import { financialsByFarmer } from './ledgerService';

export interface Overview {
  totalFarmers: number;
  activeFarmers: number;
  farmersHarvested: number;
  farmersFarming: number;
  produceKg: number;
  deliveries: number;
  totalOwed: number;
  totalPaid: number;
  outstanding: number;
  farmersOwed: number;
  advancesOutstanding: number;
  pendingPayments: number;
  unverifiedHarvests: number;
}

export async function overview(): Promise<Overview> {
  const [farmers, harvests, activities, payments, financials] = await Promise.all([
    db.farmers.toArray(),
    db.harvests.toArray(),
    db.activities.toArray(),
    db.payments.toArray(),
    financialsByFarmer(),
  ]);

  const live = farmers.filter((f) => !f.archived);
  const harvestedIds = new Set(harvests.filter((h) => h.status !== 'rejected').map((h) => h.farmerId));
  const farmingIds = new Set(activities.filter((a) => a.category === 'farming').map((a) => a.farmerId));

  let totalOwed = 0;
  let totalPaid = 0;
  let outstanding = 0;
  let advancesOutstanding = 0;
  let farmersOwed = 0;
  for (const f of financials.values()) {
    totalOwed += f.earned;
    totalPaid += f.paid;
    if (f.balance > 0) {
      outstanding += f.balance;
      farmersOwed += 1;
    } else advancesOutstanding += Math.abs(f.balance);
  }

  let produceKg = 0;
  let deliveries = 0;
  for (const h of harvests) {
    if (h.status === 'rejected') continue;
    produceKg += weightKg(h.quantity, h.unit);
    deliveries += 1;
  }

  return {
    totalFarmers: live.length,
    activeFarmers: live.filter((f) => f.status !== 'inactive').length,
    farmersHarvested: harvestedIds.size,
    farmersFarming: [...farmingIds].filter((id) => !harvestedIds.has(id)).length,
    produceKg,
    deliveries,
    totalOwed,
    totalPaid,
    outstanding,
    farmersOwed,
    advancesOutstanding,
    pendingPayments: payments.filter((p) => p.status === 'pending').length,
    unverifiedHarvests: harvests.filter((h) => h.status === 'recorded').length,
  };
}

export interface Series {
  label: string;
  value: number;
  colour?: string;
  secondary?: number;
}

export async function harvestByCrop(): Promise<Series[]> {
  const [harvests, crops] = await Promise.all([db.harvests.toArray(), db.crops.toArray()]);
  const byId = new Map(crops.map((c) => [c.id, c]));
  const map = new Map<ID, { qty: number; value: number }>();
  for (const h of harvests) {
    if (h.status === 'rejected') continue;
    const entry = map.get(h.cropId) ?? { qty: 0, value: 0 };
    entry.qty += weightKg(h.quantity, h.unit);
    entry.value += grossValue(h.quantity, h.pricePerUnit);
    map.set(h.cropId, entry);
  }
  return [...map.entries()]
    .map(([cropId, v]) => ({
      label: byId.get(cropId)?.name ?? 'Unknown',
      value: Math.round(v.qty),
      secondary: v.value,
      colour: byId.get(cropId)?.colour,
    }))
    .filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
}

export async function harvestOverTime(months = 6): Promise<Series[]> {
  const harvests = await db.harvests.toArray();
  const map = new Map<string, number>();
  for (const h of harvests) {
    if (h.status === 'rejected') continue;
    const key = monthKey(h.date);
    map.set(key, (map.get(key) ?? 0) + weightKg(h.quantity, h.unit));
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-months)
    .map(([key, value]) => ({ label: monthLabel(key), value: Math.round(value) }));
}

/** Money earned vs money paid, month by month. */
export async function moneyOverTime(months = 6): Promise<Series[]> {
  const txs = await db.transactions.toArray();
  const map = new Map<string, { earned: number; paid: number }>();
  for (const tx of txs) {
    if (!counts(tx)) continue;
    const key = monthKey(tx.date);
    const entry = map.get(key) ?? { earned: 0, paid: 0 };
    // Same definition of "earned" as the farmer summary, so the chart agrees with the totals.
    if (tx.type === 'harvest' || tx.type === 'work' || tx.type === 'bonus' || tx.type === 'reimbursement' || (tx.type === 'adjustment' && tx.direction === 'credit')) entry.earned += tx.amount;
    if (tx.type === 'payment') entry.paid += tx.amount;
    map.set(key, entry);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-months)
    .map(([key, v]) => ({ label: monthLabel(key), value: v.earned, secondary: v.paid }));
}

export async function farmersByStatus(): Promise<Series[]> {
  const farmers = await db.farmers.toArray();
  const map = new Map<string, number>();
  for (const f of farmers) {
    if (f.archived) continue;
    map.set(f.status, (map.get(f.status) ?? 0) + 1);
  }
  return [...map.entries()].map(([label, value]) => ({ label, value }));
}

export async function productionByDistrict(): Promise<Series[]> {
  const [harvests, farmers] = await Promise.all([db.harvests.toArray(), db.farmers.toArray()]);
  const district = new Map(farmers.map((f) => [f.id, f.district]));
  const map = new Map<string, number>();
  for (const h of harvests) {
    if (h.status === 'rejected') continue;
    const key = district.get(h.farmerId) ?? 'Unknown';
    map.set(key, (map.get(key) ?? 0) + weightKg(h.quantity, h.unit));
  }
  return [...map.entries()].map(([label, value]) => ({ label, value: Math.round(value) })).sort((a, b) => b.value - a.value);
}

export async function productionByCooperative(): Promise<Series[]> {
  const [harvests, farmers, coops] = await Promise.all([
    db.harvests.toArray(),
    db.farmers.toArray(),
    db.cooperatives.toArray(),
  ]);
  const coopOf = new Map(farmers.map((f) => [f.id, f.cooperativeId]));
  const name = new Map(coops.map((c) => [c.id, c.name]));
  const map = new Map<string, number>();
  for (const h of harvests) {
    if (h.status === 'rejected') continue;
    const key = name.get(coopOf.get(h.farmerId) ?? '') ?? 'Unknown';
    map.set(key, (map.get(key) ?? 0) + grossValue(h.quantity, h.pricePerUnit));
  }
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

export async function activityMix(): Promise<Series[]> {
  const activities = await db.activities.toArray();
  const map = new Map<string, number>();
  for (const a of activities) map.set(a.category, (map.get(a.category) ?? 0) + 1);
  return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

export async function activityCompletion(): Promise<{ completed: number; total: number; rate: number }> {
  const activities = await db.activities.toArray();
  const done = activities.filter((a) => a.status === 'completed' || a.status === 'verified').length;
  return { completed: done, total: activities.length, rate: activities.length ? done / activities.length : 0 };
}

/** Farmers owed the most, for the dashboard work queue. */
export async function topOutstanding(limit = 6) {
  const [farmers, financials] = await Promise.all([db.farmers.toArray(), financialsByFarmer()]);
  return farmers
    .filter((f) => !f.archived)
    .map((f) => ({ farmer: f, balance: financials.get(f.id)?.balance ?? 0 }))
    .filter((r) => r.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);
}

export async function cropList(): Promise<Crop[]> {
  return db.crops.toArray();
}

/** Per-farmer figures for the reports section. */
export async function farmerReport() {
  const [farmers, harvests, crops, coops] = await Promise.all([
    db.farmers.toArray(),
    db.harvests.toArray(),
    db.crops.toArray(),
    db.cooperatives.toArray(),
  ]);
  const financials = await financialsByFarmer();
  const cropName = new Map(crops.map((c) => [c.id, c.name]));
  const coopName = new Map(coops.map((c) => [c.id, c.name]));

  return farmers
    .filter((f) => !f.archived)
    .map((f) => {
      const rows = harvests.filter((h) => h.farmerId === f.id && h.status !== 'rejected');
      const fin = financials.get(f.id) ?? summarise([]);
      return {
        code: f.code,
        name: `${f.firstName} ${f.lastName}`,
        district: f.district,
        cooperative: coopName.get(f.cooperativeId) ?? '',
        crop: cropName.get(f.primaryCropId) ?? '',
        deliveries: rows.length,
        quantity: rows.reduce((s, h) => s + weightKg(h.quantity, h.unit), 0),
        earned: fin.earned,
        paid: fin.paid,
        advances: fin.advances,
        deductions: fin.deductions,
        balance: fin.balance,
        status: f.status,
      };
    });
}
