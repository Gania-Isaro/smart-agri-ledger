/**
 * Status vocabulary.
 *
 * Every status carries a label, a short glyph and a tone. Colour is never the
 * only signal, badges render the glyph and the words too, so the table stays
 * readable in greyscale, in sunlight, and for colour-blind users.
 */

import type {
  ActivityStatus,
  BatchStatus,
  FarmerStatus,
  HarvestStatus,
  PaymentStatus,
  QualityGrade,
} from './types';
import { translated } from '../i18n/tx';

export type Tone = 'green' | 'amber' | 'blue' | 'orange' | 'purple' | 'red' | 'slate' | 'teal';

export interface StatusMeta {
  /** The status value itself, used to look up a translated label. */
  key?: string;
  label: string;
  glyph: string;
  tone: Tone;
  help?: string;
}

/**
 * Stamps each entry with its own map key, so a Badge can translate the label
 * without every call site having to pass the raw status string alongside it.
 */
function keyed<T extends Record<string, StatusMeta>>(map: T): T {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, { ...v, key: k }])) as T;
}

export const FARMER_STATUS: Record<FarmerStatus, StatusMeta> = translated(keyed({
  active: { label: 'Active', glyph: '●', tone: 'green', help: 'Registered and farming this season.' },
  in_progress: { label: 'In progress', glyph: '◐', tone: 'amber', help: 'Field work under way.' },
  harvested: { label: 'Harvested', glyph: '◆', tone: 'blue', help: 'Produce delivered, not yet invoiced.' },
  awaiting_payment: { label: 'Awaiting payment', glyph: '◒', tone: 'orange', help: 'Money is owed to this farmer.' },
  paid: { label: 'Paid', glyph: '✓', tone: 'purple', help: 'Account settled in full.' },
  disputed: { label: 'Disputed', glyph: '!', tone: 'red', help: 'A record on this account is contested.' },
  inactive: { label: 'Inactive', glyph: '○', tone: 'slate', help: 'Not participating this season.' },
}));

export const ACTIVITY_STATUS: Record<ActivityStatus, StatusMeta> = translated(keyed({
  planned: { label: 'Planned', glyph: '○', tone: 'slate' },
  in_progress: { label: 'In progress', glyph: '◐', tone: 'amber' },
  completed: { label: 'Completed', glyph: '✓', tone: 'green' },
  verified: { label: 'Verified', glyph: '✓✓', tone: 'teal' },
  cancelled: { label: 'Cancelled', glyph: '✕', tone: 'slate' },
}));

export const HARVEST_STATUS: Record<HarvestStatus, StatusMeta> = translated(keyed({
  recorded: { label: 'Recorded', glyph: '◐', tone: 'amber', help: 'Captured in the field, awaiting verification.' },
  verified: { label: 'Verified', glyph: '✓', tone: 'green', help: 'Weight and grade confirmed at intake.' },
  rejected: { label: 'Rejected', glyph: '✕', tone: 'red', help: 'Produce not accepted. No credit posted.' },
}));

export const PAYMENT_STATUS: Record<PaymentStatus, StatusMeta> = translated(keyed({
  pending: { label: 'Pending', glyph: '○', tone: 'slate', help: 'Created, not yet approved.' },
  approved: { label: 'Approved', glyph: '◆', tone: 'blue', help: 'Cleared to be paid. Not yet handed over.' },
  processing: { label: 'Processing', glyph: '◐', tone: 'amber', help: 'Being paid out right now.' },
  paid: { label: 'Paid', glyph: '✓', tone: 'green', help: 'Handed over, and recorded in the ledger.' },
  cancelled: { label: 'Cancelled', glyph: '✕', tone: 'slate', help: 'Withdrawn before payout.' },
  disputed: { label: 'Disputed', glyph: '!', tone: 'red', help: 'Contested by the farmer.' },
}));

export const BATCH_STATUS: Record<BatchStatus, StatusMeta> = translated(keyed({
  draft: { label: 'Draft', glyph: '○', tone: 'slate', help: 'Being assembled. Nothing has moved.' },
  pending_approval: { label: 'Pending approval', glyph: '◐', tone: 'amber', help: 'Waiting on an approver.' },
  approved: { label: 'Approved', glyph: '◆', tone: 'blue', help: 'Cleared to be paid.' },
  partially_paid: { label: 'Partially paid', glyph: '◒', tone: 'orange', help: 'Some farmers still unpaid.' },
  completed: { label: 'Completed', glyph: '✓', tone: 'green', help: 'Every farmer in the list has been paid and recorded.' },
  cancelled: { label: 'Cancelled', glyph: '✕', tone: 'slate' },
}));

export const GRADE_META: Record<QualityGrade, StatusMeta> = translated({
  A: { label: 'Grade A', glyph: 'A', tone: 'green', help: 'Premium quality.' },
  B: { label: 'Grade B', glyph: 'B', tone: 'teal', help: 'Standard quality.' },
  C: { label: 'Grade C', glyph: 'C', tone: 'amber', help: 'Low quality, reduced price.' },
  REJECT: { label: 'Reject', glyph: '✕', tone: 'red', help: 'Not accepted.' },
});

export const LEDGER_TYPE_LABEL: Record<string, string> = translated({
  harvest: 'Harvest',
  work: "Day's work",
  bonus: 'Bonus',
  payment: 'Payment',
  advance: 'Advance',
  deduction: 'Deduction',
  loan: 'Loan',
  reimbursement: 'Reimbursement',
  adjustment: 'Adjustment',
});

export const PAYMENT_METHOD_LABEL: Record<string, string> = translated({
  mobile_money: 'Mobile money',
  bank_transfer: 'Bank transfer',
  cash: 'Cash',
  cheque: 'Cheque',
});

/**
 * Which payment statuses may follow another. The service layer enforces this so
 * a payment cannot jump from pending straight to paid without approval.
 */
export const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ['approved', 'cancelled', 'disputed'],
  approved: ['processing', 'paid', 'cancelled', 'disputed'],
  processing: ['paid', 'disputed', 'cancelled'],
  paid: ['disputed'],
  cancelled: [],
  disputed: ['approved', 'cancelled', 'paid'],
};

export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  return PAYMENT_TRANSITIONS[from].includes(to);
}
