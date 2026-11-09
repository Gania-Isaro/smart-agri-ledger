/** Harvest records: verification, correction and the production read models. */

import { db } from '../db/db';
import { nowStamp } from '../lib/date';
import { grossValue, toNonNegativeMoney, toQuantity, weightKg } from '../domain/money';
import { assertCan } from '../domain/rbac';
import type { Harvest, HarvestStatus, ID, QualityGrade, User } from '../domain/types';
import * as audit from './audit';
import { postSystem, voidTransaction } from './ledgerService';
import { counts } from '../domain/ledger';
import { refreshFarmerStatus } from './activityService';
import { ValidationError } from './farmerService';

export interface HarvestRow extends Harvest {
  gross: number;
  net: number;
}

const enrich = (h: Harvest): HarvestRow => {
  const gross = grossValue(h.quantity, h.pricePerUnit);
  return { ...h, gross, net: gross - h.deductions };
};

export async function list(filter?: { farmerId?: ID; batchId?: ID }): Promise<HarvestRow[]> {
  let rows: Harvest[];
  if (filter?.farmerId) rows = await db.harvests.where('farmerId').equals(filter.farmerId).toArray();
  else rows = await db.harvests.toArray();
  if (filter?.batchId) rows = rows.filter((h) => h.batchId === filter.batchId);
  return rows.sort((a, b) => (a.date < b.date ? 1 : -1)).map(enrich);
}

export async function get(id: ID): Promise<HarvestRow | undefined> {
  const h = await db.harvests.get(id);
  return h ? enrich(h) : undefined;
}

export async function setStatus(user: User, ids: ID[], status: HarvestStatus): Promise<number> {
  assertCan(user, status === 'verified' || status === 'rejected' ? 'harvest.verify' : 'harvest.edit');
  const rows = (await db.harvests.bulkGet(ids)).filter(Boolean) as Harvest[];

  for (const h of rows) {
    /*
     * Rejecting produce that was already credited has to take the money back
     * too, and the only honest way to do that is a reversing ledger entry.
     * Every entry tied to the delivery goes: the credit, the intake deduction
     * and any correction. Voiding only the credit would leave the farmer
     * owing the deductions on produce that was never accepted.
     */
    if (status === 'rejected' && h.status !== 'rejected') {
      const tx = await db.transactions.where('harvestId').equals(h.id).toArray();
      const live = tx.filter(counts);
      if (live.length) assertCan(user, 'ledger.void');
      for (const t of live) await voidTransaction(user, t.id, 'Harvest rejected at verification');
    }
    await db.harvests.put({ ...h, status, updatedAt: nowStamp() });
    await refreshFarmerStatus(h.farmerId);
  }

  await audit.record(user, 'harvest', ids.join(','), status === 'verified' ? 'approve' : 'update', `Marked ${rows.length} harvest record(s) as ${status}`);
  return rows.length;
}

/**
 * Correct a harvest. Quantity, price and grade all feed the farmer credit, so
 * changing them writes a balancing ledger entry rather than quietly rewriting
 * history. The farmer must be able to see why their balance moved.
 */
export async function correct(
  user: User,
  id: ID,
  patch: { quantity?: number; pricePerUnit?: number; grade?: QualityGrade; deductions?: number; notes?: string },
  reason: string,
): Promise<HarvestRow> {
  assertCan(user, 'harvest.edit');
  if (reason.trim().length < 5) throw new ValidationError('Give a reason for the correction.');

  const before = await db.harvests.get(id);
  if (!before) throw new ValidationError('That harvest record no longer exists.');
  if (before.status === 'rejected') throw new ValidationError('A rejected harvest cannot be edited. Record a new delivery instead.');

  const after: Harvest = {
    ...before,
    quantity: patch.quantity !== undefined ? toQuantity(patch.quantity, 'Quantity') : before.quantity,
    pricePerUnit: patch.pricePerUnit !== undefined ? toNonNegativeMoney(patch.pricePerUnit, 'Price per unit') : before.pricePerUnit,
    grade: patch.grade ?? before.grade,
    deductions: patch.deductions !== undefined ? toNonNegativeMoney(patch.deductions, 'Deductions') : before.deductions,
    notes: patch.notes ?? before.notes,
    updatedAt: nowStamp(),
  };
  if (after.quantity <= 0) throw new ValidationError('Quantity must be greater than zero.', 'quantity');

  const beforeGross = grossValue(before.quantity, before.pricePerUnit);
  const afterGross = grossValue(after.quantity, after.pricePerUnit);
  const delta = afterGross - beforeGross;
  if (after.deductions > afterGross) {
    throw new ValidationError('Deductions cannot exceed the value of the delivery.', 'deductions');
  }
  const deductionDelta = after.deductions - before.deductions;

  await db.harvests.put(after);

  if (delta !== 0) {
    await postSystem(user, {
      farmerId: after.farmerId,
      type: 'adjustment',
      direction: delta > 0 ? 'credit' : 'debit',
      amount: Math.abs(delta),
      description: `Harvest correction, ${reason.trim()}`,
      date: after.date,
      harvestId: after.id,
    });
  }

  /* Deductions posted at intake as their own entry, so a change to them has to
     reach the ledger too, or the harvest record and the balance disagree. */
  if (deductionDelta > 0) {
    await postSystem(user, {
      farmerId: after.farmerId,
      type: 'deduction',
      amount: deductionDelta,
      description: `Deduction correction, ${reason.trim()}`,
      date: after.date,
      harvestId: after.id,
    });
  } else if (deductionDelta < 0) {
    await postSystem(user, {
      farmerId: after.farmerId,
      type: 'adjustment',
      direction: 'credit',
      amount: -deductionDelta,
      description: `Deduction correction, ${reason.trim()}`,
      date: after.date,
      harvestId: after.id,
    });
  }

  await refreshFarmerStatus(after.farmerId);
  await audit.record(user, 'harvest', id, 'update', `Corrected harvest ${id}: ${reason.trim()} (${delta >= 0 ? '+' : ''}${delta} RWF)`, { before, after });
  return enrich(after);
}

/* ------------------------------------------------------------- analytics */

export interface CropTotals {
  cropId: ID;
  quantity: number;
  unit: string;
  value: number;
  deliveries: number;
}

export async function totalsByCrop(): Promise<CropTotals[]> {
  const rows = await db.harvests.toArray();
  const map = new Map<ID, CropTotals>();
  for (const h of rows) {
    if (h.status === 'rejected') continue;
    const entry = map.get(h.cropId) ?? { cropId: h.cropId, quantity: 0, unit: h.unit, value: 0, deliveries: 0 };
    entry.quantity += h.quantity;
    entry.value += grossValue(h.quantity, h.pricePerUnit);
    entry.deliveries += 1;
    map.set(h.cropId, entry);
  }
  return [...map.values()].sort((a, b) => b.value - a.value);
}

export async function totalProduce(): Promise<{ quantity: number; value: number; deliveries: number }> {
  const rows = await db.harvests.toArray();
  let quantity = 0;
  let value = 0;
  let deliveries = 0;
  for (const h of rows) {
    if (h.status === 'rejected') continue;
    // Bunches and crates are not kilograms; only weight-based units are summed.
    quantity += weightKg(h.quantity, h.unit);
    value += grossValue(h.quantity, h.pricePerUnit);
    deliveries += 1;
  }
  return { quantity, value, deliveries };
}
