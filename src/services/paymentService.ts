/**
 * Payments and payment batches.
 *
 * This app does not move money. Cooperatives pay farmers the way they always
 * have, in cash or by mobile money, and this records what was paid so the
 * balances stay right. Nothing here talks to a bank.
 *
 * A payment moves through pending -> approved -> processing -> paid, and only
 * the step that reaches `paid` posts to the ledger, because that is the step
 * where a human confirms the money genuinely changed hands. A farmer account is
 * therefore never debited for a payment that has not actually been handed over,
 * which is the difference between a balance you can trust and one you cannot.
 */

import { db, nextCounter, reserveCounters } from '../db/db';
import { uid, padCode } from '../lib/id';
import { monthKey, nowStamp, today } from '../lib/date';
import { toPositiveMoney } from '../domain/money';
import { assertCan } from '../domain/rbac';
import { summarise } from '../domain/ledger';
import { canTransitionPayment } from '../domain/status';
import type {
  BatchStatus,
  ID,
  Payment,
  PaymentBatch,
  PaymentMethod,
  PaymentStatus,
  User,
} from '../domain/types';
import * as audit from './audit';
import { postSystem, voidTransaction, financialsByFarmer } from './ledgerService';
import { refreshFarmerStatus } from './activityService';
import { ValidationError } from './farmerService';
import { ConfirmationRequired } from './activityService';

/* --------------------------------------------------------------- create */

export interface PaymentDraft {
  farmerId: ID;
  amount: number;
  method: PaymentMethod;
  date?: string;
  reason: string;
  reference?: string;
  batchId?: ID;
  harvestIds?: ID[];
  notes?: string;
  confirmOverdraft?: boolean;
}

async function nextReference(): Promise<string> {
  const n = await nextCounter('payment');
  return padCode(`PAY-${String(new Date().getFullYear()).slice(2)}-`, n, 5);
}

export async function create(user: User, draft: PaymentDraft): Promise<Payment> {
  assertCan(user, 'payment.create');

  const farmer = await db.farmers.get(draft.farmerId);
  if (!farmer) throw new ValidationError('Select a farmer.', 'farmerId');
  const amount = toPositiveMoney(draft.amount, 'Amount');
  if (!draft.reason?.trim()) throw new ValidationError('Say what this payment is for.', 'reason');

  const txs = await db.transactions.where('farmerId').equals(farmer.id).toArray();
  const { balance } = summarise(txs);
  if (amount > balance && !draft.confirmOverdraft) {
    throw new ConfirmationRequired(
      `${farmer.firstName} ${farmer.lastName} is owed ${balance.toLocaleString()} RWF. Paying ${amount.toLocaleString()} RWF leaves the account in advance by ${(amount - balance).toLocaleString()} RWF.`,
      { balance, amount },
    );
  }

  const payment: Payment = {
    id: uid('pay'),
    farmerId: farmer.id,
    amount,
    method: draft.method,
    status: 'pending',
    date: draft.date || today(),
    reference: draft.reference?.trim() || (await nextReference()),
    reason: draft.reason.trim(),
    batchId: draft.batchId,
    harvestIds: draft.harvestIds ?? [],
    notes: draft.notes,
    createdBy: user.id,
    createdAt: nowStamp(),
  };

  const clash = await db.payments.where('reference').equals(payment.reference).first();
  if (clash) throw new ValidationError(`Reference ${payment.reference} is already used by another payment.`, 'reference');

  await db.payments.put(payment);
  await audit.record(user, 'payment', payment.id, 'create', `Created ${payment.reference} for ${farmer.code}: ${amount} RWF`, { after: payment });
  return payment;
}

/* --------------------------------------------------------- status moves */

const PERMISSION_BY_TARGET: Partial<Record<PaymentStatus, 'payment.approve' | 'payment.settle' | 'payment.cancel'>> = {
  approved: 'payment.approve',
  processing: 'payment.approve',
  paid: 'payment.settle',
  cancelled: 'payment.cancel',
};

export async function transition(
  user: User,
  id: ID,
  to: PaymentStatus,
  opts: { reason?: string } = {},
): Promise<Payment> {
  const permission = PERMISSION_BY_TARGET[to];
  if (permission) assertCan(user, permission);
  else assertCan(user, 'payment.create');

  const before = await db.payments.get(id);
  if (!before) throw new ValidationError('That payment no longer exists.');
  if (before.status === to) return before;
  if (!canTransitionPayment(before.status, to)) {
    throw new ValidationError(`A ${before.status} payment cannot be moved to ${to}.`);
  }
  if (to === 'cancelled' && !opts.reason?.trim()) {
    throw new ValidationError('Give a reason for cancelling this payment.');
  }

  const at = nowStamp();
  const after: Payment = { ...before, status: to };

  if (to === 'approved') {
    after.approvedBy = user.id;
    after.approvedAt = at;
  }

  if (to === 'paid') {
    after.paidAt = at;
    /* The user is telling us the money has now genuinely been handed over,
       so this is the point where the debit belongs in the ledger. */
    const tx = await postSystem(user, {
      farmerId: before.farmerId,
      type: 'payment',
      amount: before.amount,
      description: `Payment ${before.reference}, ${before.reason}`,
      date: today(),
      reference: before.reference,
      paymentId: before.id,
      batchId: before.batchId,
    });
    after.transactionId = tx.id;
  }

  if (to === 'cancelled') {
    after.cancelledReason = opts.reason?.trim();
    /* A cancelled payment that had already posted has to be reversed. */
    if (before.transactionId) {
      assertCan(user, 'ledger.void');
      await voidTransaction(user, before.transactionId, `Payment ${before.reference} cancelled: ${opts.reason?.trim()}`);
      after.transactionId = undefined;
    }
  }

  await db.payments.put(after);
  await refreshFarmerStatus(before.farmerId);
  if (before.batchId) await refreshBatchStatus(before.batchId);
  await audit.record(user, 'payment', id, to === 'paid' ? 'pay' : to === 'approved' ? 'approve' : to === 'cancelled' ? 'cancel' : 'update', `${before.reference}: ${before.status} to ${to}${opts.reason ? `, ${opts.reason}` : ''}`, { before, after });
  return after;
}

export async function transitionMany(user: User, ids: ID[], to: PaymentStatus, opts: { reason?: string } = {}) {
  const results = { done: 0, skipped: [] as { id: ID; reason: string }[] };
  for (const id of ids) {
    try {
      await transition(user, id, to, opts);
      results.done += 1;
    } catch (e) {
      results.skipped.push({ id, reason: (e as Error).message });
    }
  }
  return results;
}

/* ------------------------------------------------------------------ read */

export async function list(filter?: { farmerId?: ID; status?: PaymentStatus; batchId?: ID }): Promise<Payment[]> {
  let rows = filter?.farmerId
    ? await db.payments.where('farmerId').equals(filter.farmerId).toArray()
    : await db.payments.toArray();
  if (filter?.status) rows = rows.filter((p) => p.status === filter.status);
  if (filter?.batchId) rows = rows.filter((p) => p.batchId === filter.batchId);
  return rows.sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
}

export interface PaymentTotals {
  owed: number;
  paid: number;
  pending: number;
  approved: number;
  outstanding: number;
  farmersOwed: number;
}

export async function totals(): Promise<PaymentTotals> {
  const [payments, financials] = await Promise.all([db.payments.toArray(), financialsByFarmer()]);
  let owed = 0;
  let paid = 0;
  let farmersOwed = 0;
  for (const f of financials.values()) {
    owed += f.earned;
    paid += f.paid;
    if (f.balance > 0) farmersOwed += 1;
  }
  const outstanding = [...financials.values()].reduce((s, f) => s + Math.max(f.balance, 0), 0);
  return {
    owed,
    paid,
    outstanding,
    farmersOwed,
    pending: payments.filter((p) => p.status === 'pending').reduce((s, p) => s + p.amount, 0),
    approved: payments.filter((p) => p.status === 'approved' || p.status === 'processing').reduce((s, p) => s + p.amount, 0),
  };
}

/* ---------------------------------------------------------------- batches */

export interface BatchSummary extends PaymentBatch {
  farmers: number;
  total: number;
  paidAmount: number;
  remaining: number;
  produceQuantity: number;
}

export async function listBatches(): Promise<BatchSummary[]> {
  const [batches, payments, harvests] = await Promise.all([
    db.batches.toArray(),
    db.payments.toArray(),
    db.harvests.toArray(),
  ]);

  return batches
    .map((b) => {
      const rows = payments.filter((p) => p.batchId === b.id && p.status !== 'cancelled');
      const paidAmount = rows.filter((p) => p.status === 'paid').reduce((s, p) => s + p.amount, 0);
      const total = rows.reduce((s, p) => s + p.amount, 0);
      const produceQuantity = harvests
        .filter((h) => h.batchId === b.id && h.status !== 'rejected' && (h.unit === 'KG' || h.unit === 'TONNE'))
        .reduce((s, h) => s + (h.unit === 'TONNE' ? h.quantity * 1000 : h.quantity), 0);
      return {
        ...b,
        farmers: new Set(rows.map((p) => p.farmerId)).size,
        total,
        paidAmount,
        remaining: total - paidAmount,
        produceQuantity,
      };
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export async function getBatch(id: ID): Promise<BatchSummary | undefined> {
  return (await listBatches()).find((b) => b.id === id);
}

/**
 * Build a batch from the farmers who are currently owed money. Amounts come
 * from the ledger, so a batch can never contain a figure someone typed.
 */
export async function createBatch(
  user: User,
  input: { name: string; farmerIds?: ID[]; period?: string; notes?: string },
): Promise<{ batch: PaymentBatch; payments: Payment[] }> {
  assertCan(user, 'batch.create');
  if (!input.name.trim()) throw new ValidationError('Give the batch a name.', 'name');

  const financials = await financialsByFarmer();
  const candidates = [...financials.entries()]
    .filter(([farmerId, f]) => f.balance > 0 && (!input.farmerIds?.length || input.farmerIds.includes(farmerId)));

  if (candidates.length === 0) {
    throw new ValidationError('No farmer in that selection is currently owed money.');
  }

  const n = await nextCounter('batch');
  const period = input.period || monthKey(today());
  const batch: PaymentBatch = {
    id: uid('bat'),
    code: padCode(`PB-${period.replace('-', '')}-`, n, 2),
    name: input.name.trim(),
    period,
    status: 'draft',
    createdBy: user.id,
    createdAt: nowStamp(),
    notes: input.notes,
  };

  const first = await reserveCounters('payment', candidates.length);
  const payments: Payment[] = candidates.map(([farmerId, f], i) => ({
    id: uid('pay'),
    farmerId,
    amount: f.balance,
    method: 'mobile_money',
    status: 'pending',
    date: today(),
    reference: padCode(`PAY-${String(new Date().getFullYear()).slice(2)}-`, first + i, 5),
    reason: `${batch.name} settlement`,
    batchId: batch.id,
    harvestIds: [],
    createdBy: user.id,
    createdAt: nowStamp(),
  }));

  await db.transaction('rw', [db.batches, db.payments, db.audit], async () => {
    await db.batches.put(batch);
    await db.payments.bulkPut(payments);
  });

  await audit.record(user, 'batch', batch.id, 'create', `Created ${batch.code} with ${payments.length} farmers, ${payments.reduce((s, p) => s + p.amount, 0)} RWF`, { after: batch });
  return { batch, payments };
}

export async function setBatchStatus(user: User, id: ID, status: BatchStatus): Promise<PaymentBatch> {
  assertCan(user, status === 'approved' ? 'batch.approve' : 'batch.create');
  const before = await db.batches.get(id);
  if (!before) throw new ValidationError('That batch no longer exists.');

  const after: PaymentBatch = { ...before, status };
  if (status === 'approved') {
    after.approvedBy = user.id;
    after.approvedAt = nowStamp();
    /* Approving the batch approves the payments inside it. */
    const rows = await db.payments.where('batchId').equals(id).toArray();
    await db.payments.bulkPut(
      rows.filter((p) => p.status === 'pending').map((p) => ({ ...p, status: 'approved' as PaymentStatus, approvedBy: user.id, approvedAt: nowStamp() })),
    );
  }
  if (status === 'completed') after.completedAt = nowStamp();

  await db.batches.put(after);
  await audit.record(user, 'batch', id, status === 'approved' ? 'approve' : 'update', `${before.code}: ${before.status} to ${status}`, { before, after });
  return after;
}

/** Recompute a batch status from the payments inside it. */
export async function refreshBatchStatus(batchId: ID): Promise<void> {
  const batch = await db.batches.get(batchId);
  if (!batch || batch.status === 'cancelled' || batch.status === 'draft') return;

  const rows = (await db.payments.where('batchId').equals(batchId).toArray()).filter((p) => p.status !== 'cancelled');
  if (rows.length === 0) return;

  const paid = rows.filter((p) => p.status === 'paid').length;
  const status: BatchStatus = paid === 0 ? batch.status : paid === rows.length ? 'completed' : 'partially_paid';
  if (status !== batch.status) {
    await db.batches.put({ ...batch, status, completedAt: status === 'completed' ? nowStamp() : batch.completedAt });
  }
}

/** Record every approved payment in a list as paid, in one action. */
export async function settleBatch(user: User, batchId: ID): Promise<{ done: number; skipped: { id: ID; reason: string }[] }> {
  assertCan(user, 'payment.settle');
  const batch = await db.batches.get(batchId);
  if (!batch) throw new ValidationError('That batch no longer exists.');
  if (batch.status === 'draft' || batch.status === 'pending_approval') {
    throw new ValidationError('Approve the list before recording payments against it.');
  }

  const rows = await db.payments.where('batchId').equals(batchId).toArray();
  const payable = rows.filter((p) => p.status === 'approved' || p.status === 'processing');
  const result = await transitionMany(user, payable.map((p) => p.id), 'paid');
  await refreshBatchStatus(batchId);
  return result;
}
