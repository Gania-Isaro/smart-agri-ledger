/**
 * Ledger service. The only way money is allowed to move.
 *
 * Rules enforced here, not in the UI:
 *   - a balance is never stored, only folded from transactions
 *   - amounts are whole, positive RWF; the direction carries the sign
 *   - transaction codes are unique and gap-free
 *   - nothing is ever deleted; a mistake is voided, which appends a reversal
 *   - every write leaves an audit entry naming the user who made it
 */

import { db, nextCounter } from '../db/db';
import { uid, padCode } from '../lib/id';
import { nowStamp, today } from '../lib/date';
import { toPositiveMoney } from '../domain/money';
import { assertCan } from '../domain/rbac';
import {
  balanceOf,
  chronological,
  directionFor,
  reversalOf,
  summarise,
  withRunningBalance,
  type FarmerFinancials,
} from '../domain/ledger';
import type {
  Direction,
  ID,
  LedgerLine,
  LedgerTransaction,
  LedgerTxType,
  User,
} from '../domain/types';
import * as audit from './audit';

import { tx as T } from '../i18n/tx';
export class LedgerError extends Error {}

export interface PostInput {
  farmerId: ID;
  type: LedgerTxType;
  amount: number;
  description: string;
  date?: string;
  reference?: string;
  /** Only meaningful for adjustments; ignored for every other type. */
  direction?: Direction;
  harvestId?: ID;
  activityId?: ID;
  paymentId?: ID;
  batchId?: ID;
}

async function nextCode(): Promise<string> {
  const n = await nextCounter('transaction');
  return padCode(`TXN-${new Date().getFullYear()}-`, n, 6);
}

/**
 * Append a transaction. `existingTx` lets callers run this inside a wider Dexie
 * transaction (recording an activity posts a ledger entry in the same commit,
 * so a crash can never leave a harvest without its credit).
 */
export async function post(user: User, input: PostInput): Promise<LedgerTransaction> {
  assertCan(user, 'ledger.post');
  return write(user, input);
}

/**
 * Post an entry that is a consequence of an already-authorised action rather
 * than a discretionary accounting decision. The credit that must accompany a
 * harvest, the debit that must accompany a settled payment. The caller has
 * already checked its own permission (`harvest.create`, `payment.settle`), and
 * refusing here would leave produce recorded with no money against it, which is
 * a worse outcome than the narrower permission implies. Never call this from a
 * component; only from another service that has run its own `assertCan`.
 */
export async function postSystem(user: User, input: PostInput): Promise<LedgerTransaction> {
  return write(user, input);
}

async function write(user: User, input: PostInput): Promise<LedgerTransaction> {
  const farmer = await db.farmers.get(input.farmerId);
  if (!farmer) throw new LedgerError(T('That worker no longer exists.'));

  const amount = toPositiveMoney(input.amount, 'Amount');
  const description = input.description.trim();
  if (!description) throw new LedgerError(T('A description is required for every transaction.'));
  if (input.type === 'adjustment' && !input.direction) {
    throw new LedgerError(T('An adjustment must state whether it is a debit or a credit.'));
  }

  const tx: LedgerTransaction = {
    id: uid('tx'),
    code: await nextCode(),
    farmerId: input.farmerId,
    type: input.type,
    direction: directionFor(input.type, input.direction),
    amount,
    description,
    date: input.date ?? today(),
    reference: input.reference,
    harvestId: input.harvestId,
    activityId: input.activityId,
    paymentId: input.paymentId,
    batchId: input.batchId,
    voided: false,
    createdBy: user.id,
    createdAt: nowStamp(),
  };

  await db.transactions.put(tx);
  await audit.record(user, 'transaction', tx.id, 'create', `${tx.code}: ${tx.direction} ${amount} RWF, ${description}`, { after: tx });
  return tx;
}

/**
 * Void a transaction. The original row stays exactly as it was, flagged, and a
 * reversing entry is appended next to it so the history shows what was
 * cancelled. Neither row counts toward the balance. Deleting was never an option.
 */
export async function voidTransaction(
  user: User,
  transactionId: ID,
  reason: string,
): Promise<{ voided: LedgerTransaction; reversal: LedgerTransaction }> {
  assertCan(user, 'ledger.void');

  const trimmed = reason.trim();
  if (trimmed.length < 5) throw new LedgerError(T('Give a reason of at least 5 characters for the audit trail.'));

  const original = await db.transactions.get(transactionId);
  if (!original) throw new LedgerError(T('That transaction does not exist.'));
  if (original.voided) throw new LedgerError(T('{code} has already been voided.', { code: original.code }));
  if (original.reversesId) throw new LedgerError(T('A reversal entry cannot itself be voided.'));

  const at = nowStamp();
  const voided: LedgerTransaction = { ...original, voided: true, voidedAt: at, voidedBy: user.id, voidReason: trimmed };
  const reversal = reversalOf(original, {
    id: uid('tx'),
    code: await nextCode(),
    userId: user.id,
    reason: trimmed,
    at,
    date: today(),
  });

  await db.transaction('rw', db.transactions, db.audit, async () => {
    await db.transactions.put(voided);
    await db.transactions.put(reversal);
  });

  /* A day of work only exists to justify its credit. Once the credit is voided,
     the day must stop counting in the work totals too, or "money needed" would
     include pay that is no longer owed. */
  if (original.type === 'work') {
    await db.workdays.filter((d) => d.transactionId === original.id).delete();
  }

  await audit.record(user, 'transaction', original.id, 'void', `Voided ${original.code} (${original.amount} RWF), ${trimmed}`, { before: original, after: voided });
  return { voided, reversal };
}

/* ------------------------------------------------------------- read side */

export async function transactionsFor(farmerId: ID): Promise<LedgerTransaction[]> {
  const rows = await db.transactions.where('farmerId').equals(farmerId).toArray();
  return rows.sort(chronological);
}

export async function ledgerFor(farmerId: ID): Promise<LedgerLine[]> {
  return withRunningBalance(await transactionsFor(farmerId));
}

export async function balanceFor(farmerId: ID): Promise<number> {
  return balanceOf(await transactionsFor(farmerId));
}

export async function financialsFor(farmerId: ID): Promise<FarmerFinancials> {
  return summarise(await transactionsFor(farmerId));
}

/** One pass over the ledger, bucketed by farmer. Used by every list screen. */
export async function financialsByFarmer(): Promise<Map<ID, FarmerFinancials>> {
  const all = await db.transactions.toArray();
  const grouped = new Map<ID, LedgerTransaction[]>();
  for (const tx of all) {
    const list = grouped.get(tx.farmerId);
    if (list) list.push(tx);
    else grouped.set(tx.farmerId, [tx]);
  }
  const out = new Map<ID, FarmerFinancials>();
  for (const [farmerId, txs] of grouped) out.set(farmerId, summarise(txs));
  return out;
}

export async function allTransactions(): Promise<LedgerTransaction[]> {
  return (await db.transactions.toArray()).sort((a, b) => -chronological(a, b));
}

export interface CooperativePosition {
  totalEarned: number;
  totalPaid: number;
  totalAdvances: number;
  totalDeductions: number;
  outstanding: number;
  /** Farmers carrying an advance the cooperative has yet to recover. */
  inAdvance: number;
  farmersOwed: number;
}

/** The cooperative-wide financial position shown on the dashboard. */
export async function position(): Promise<CooperativePosition> {
  const byFarmer = await financialsByFarmer();
  let totalEarned = 0;
  let totalPaid = 0;
  let totalAdvances = 0;
  let totalDeductions = 0;
  let outstanding = 0;
  let inAdvance = 0;
  let farmersOwed = 0;

  for (const f of byFarmer.values()) {
    totalEarned += f.earned;
    totalPaid += f.paid;
    totalAdvances += f.advances;
    totalDeductions += f.deductions;
    if (f.balance > 0) {
      outstanding += f.balance;
      farmersOwed += 1;
    } else if (f.balance < 0) {
      inAdvance += Math.abs(f.balance);
    }
  }

  return { totalEarned, totalPaid, totalAdvances, totalDeductions, outstanding, inAdvance, farmersOwed };
}
