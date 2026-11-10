/**
 * Ledger arithmetic.
 *
 * The ledger is kept from the FARMER's point of view, as a cooperative would
 * read it out loud: a credit is money the cooperative owes the farmer, a debit
 * is money that has flowed to the farmer (or been withheld from what is owed).
 *
 *   balance = sum(credits) - sum(debits)
 *
 * A positive balance means the cooperative still owes the farmer that much.
 * A negative balance means the farmer is carrying an advance or loan.
 *
 * Nothing in this file touches storage, so the same rules can run on a server
 * unchanged, which is the point: the numbers must not depend on the UI.
 */

import { tx } from '../i18n/tx';
import type { Direction, LedgerLine, LedgerTransaction, LedgerTxType } from './types';

/**
 * How each transaction type posts. This table is the whole accounting policy
 * of the app, deliberately kept in one readable place.
 */
export const POSTING_RULES: Record<
  LedgerTxType,
  { direction: Direction; label: string; help: string }
> = {
  harvest: {
    direction: 'credit',
    label: 'Harvest delivery',
    help: 'Produce received from the worker increases what the cooperative owes.',
  },
  work: {
    direction: 'credit',
    label: "Day's work",
    help: 'A day of paid work, recorded with a photo, added to what the worker is owed.',
  },
  bonus: {
    direction: 'credit',
    label: 'Bonus',
    help: 'Quality or loyalty bonus added to what the worker is owed.',
  },
  reimbursement: {
    direction: 'credit',
    label: 'Reimbursement',
    help: 'Money the worker spent on behalf of the cooperative, paid back.',
  },
  payment: {
    direction: 'debit',
    label: 'Payment',
    help: 'Money paid out to the worker, reducing the outstanding balance.',
  },
  advance: {
    direction: 'debit',
    label: 'Advance',
    help: 'Money paid before harvest, recovered from later deliveries.',
  },
  deduction: {
    direction: 'debit',
    label: 'Deduction',
    help: 'Transport, drying, inputs or losses withheld from what is owed.',
  },
  loan: {
    direction: 'debit',
    label: 'Loan / credit',
    help: 'Inputs or cash extended on credit, recovered from later deliveries.',
  },
  adjustment: {
    direction: 'debit',
    label: 'Adjustment',
    help: 'Correction posted by an accountant. Direction is chosen explicitly.',
  },
};

/** Adjustments are the only type whose direction the user chooses. */
export function directionFor(type: LedgerTxType, explicit?: Direction): Direction {
  if (type === 'adjustment') return explicit ?? 'debit';
  return POSTING_RULES[type].direction;
}

/**
 * Whether an entry counts toward balances and totals. A voided entry and the
 * reversal written for it cancel each other out, so neither one counts. If only
 * the voided entry were skipped, the reversal would take the money off a second
 * time and a voided 100,000 RWF harvest would leave the farmer at -100,000.
 */
export function counts(tx: Pick<LedgerTransaction, 'voided' | 'reversesId'>): boolean {
  return !tx.voided && !tx.reversesId;
}

/** Signed contribution of a single entry to a balance. Voided entries and reversals are inert. */
export function signedAmount(tx: Pick<LedgerTransaction, 'direction' | 'amount' | 'voided' | 'reversesId'>): number {
  if (!counts(tx)) return 0;
  return tx.direction === 'credit' ? tx.amount : -tx.amount;
}

/** Fold a set of transactions into a balance. Order does not matter. */
export function balanceOf(transactions: LedgerTransaction[]): number {
  return transactions.reduce((sum, tx) => sum + signedAmount(tx), 0);
}

/**
 * Chronological ordering used everywhere a ledger is displayed. Same-day
 * entries fall back to creation time so a payment recorded after a harvest on
 * the same date reads in the order it actually happened.
 */
export function chronological(a: LedgerTransaction, b: LedgerTransaction): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** Attach a running balance to each row, oldest first. */
export function withRunningBalance(transactions: LedgerTransaction[]): LedgerLine[] {
  let running = 0;
  return [...transactions].sort(chronological).map((tx) => {
    running += signedAmount(tx);
    return { ...tx, balanceAfter: running };
  });
}

export interface FarmerFinancials {
  /** Everything the farmer has earned: harvests, days of work, bonuses, reimbursements. */
  earned: number;
  /** Money actually paid out (settled payments only). */
  paid: number;
  /** Advances and loans still being carried. */
  advances: number;
  /** Deductions applied. */
  deductions: number;
  /** earned - paid - advances - deductions. What is still owed. */
  balance: number;
  /** Credits not yet settled by any payment, as a positive number. */
  outstanding: number;
  transactionCount: number;
  lastActivityDate: string | null;
}

/** Break a farmer's transactions into the figures the payments screens show. */
export function summarise(transactions: LedgerTransaction[]): FarmerFinancials {
  let earned = 0;
  let paid = 0;
  let advances = 0;
  let deductions = 0;
  let lastActivityDate: string | null = null;

  for (const tx of transactions) {
    if (!lastActivityDate || tx.date > lastActivityDate) lastActivityDate = tx.date;
    if (!counts(tx)) continue;
    switch (tx.type) {
      case 'harvest':
      case 'work':
      case 'bonus':
      case 'reimbursement':
        earned += tx.amount;
        break;
      case 'payment':
        paid += tx.amount;
        break;
      case 'advance':
      case 'loan':
        advances += tx.amount;
        break;
      case 'deduction':
        deductions += tx.amount;
        break;
      case 'adjustment':
        if (tx.direction === 'credit') earned += tx.amount;
        else deductions += tx.amount;
        break;
    }
  }

  const balance = balanceOf(transactions);
  return {
    earned,
    paid,
    advances,
    deductions,
    balance,
    outstanding: Math.max(balance, 0),
    transactionCount: transactions.length,
    lastActivityDate,
  };
}

/**
 * Build the reversing entry that voids `tx`. Voiding never edits or removes the
 * original row: the original is flagged and this mirror image is appended, so
 * the account shows exactly what was cancelled and when. The pair is excluded
 * from every balance and total (see `counts`).
 */
export function reversalOf(
  original: LedgerTransaction,
  opts: { id: string; code: string; userId: string; reason: string; at: string; date: string },
): LedgerTransaction {
  return {
    ...original,
    id: opts.id,
    code: opts.code,
    direction: original.direction === 'credit' ? 'debit' : 'credit',
    description: tx('Reversal of {code}, {reason}', { code: original.code, reason: opts.reason }),
    date: opts.date,
    reversesId: original.id,
    voided: false,
    voidedAt: undefined,
    voidedBy: undefined,
    voidReason: undefined,
    createdBy: opts.userId,
    createdAt: opts.at,
  };
}
