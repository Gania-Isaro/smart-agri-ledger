/**
 * Core domain types for Smart Agri-Ledger.
 *
 * Money is always an integer number of RWF. RWF has no minor unit in practice,
 * so we never store fractional currency and never use floats for balances.
 */

export type ID = string;
export type ISODate = string; // 'YYYY-MM-DD'
export type ISODateTime = string; // full ISO timestamp

/* ------------------------------------------------------------------ users */

export type Role =
  | 'super_admin'
  | 'cooperative_admin'
  | 'field_officer'
  | 'accountant'
  | 'viewer';

export interface User {
  id: ID;
  name: string;
  email: string;
  /** Demo-only credential. A real deployment authenticates against a server. */
  pin: string;
  role: Role;
  cooperativeId: ID | null;
  active: boolean;
  createdAt: ISODateTime;
}

/* ---------------------------------------------------------------- farmers */

export type FarmerStatus =
  | 'active'
  | 'in_progress'
  | 'harvested'
  | 'awaiting_payment'
  | 'paid'
  | 'disputed'
  | 'inactive';

export interface Farmer {
  id: ID;
  /**
   * Human-facing code, e.g. FR-001. Unique, and generated automatically unless
   * the cooperative types its own when registering the farmer.
   */
  code: string;
  firstName: string;
  lastName: string;
  phone: string;
  gender: 'F' | 'M' | 'other' | 'undisclosed';
  /**
   * National ID, membership number, or whatever number this cooperative
   * already writes next to the farmer in its own books. Free text on purpose:
   * a register that refuses the number people actually use gets ignored.
   */
  idNumber?: string;

  village: string;
  cell: string;
  sector: string;
  district: string;
  cooperativeId: ID;

  farmSizeHa: number;
  plots: number;
  crops: ID[];
  primaryCropId: ID;
  season: string;
  status: FarmerStatus;
  registeredAt: ISODate;
  notes?: string;
  archived: boolean;
}

export interface Cooperative {
  id: ID;
  name: string;
  code: string;
  district: string;
  contact: string;
}

export interface Crop {
  id: ID;
  name: string;
  /** Default unit harvests of this crop are measured in. */
  defaultUnit: Unit;
  /** Default price per unit in whole RWF, used to prefill harvest forms. */
  defaultPricePerUnit: number;
  colour: string;
}

export type Unit = 'KG' | 'TONNE' | 'BAG' | 'CRATE' | 'LITRE' | 'BUNCH' | 'PIECE';

export type QualityGrade = 'A' | 'B' | 'C' | 'REJECT';

/* ------------------------------------------------------------- activities */

export type ActivityCategory =
  | 'farming'
  | 'harvest'
  | 'operations'
  | 'logistics'
  | 'financial'
  | 'other';

export type ActivityStatus =
  | 'planned'
  | 'in_progress'
  | 'completed'
  | 'verified'
  | 'cancelled';

/** A field in a dynamically generated activity form. */
export interface FieldSpec {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'crop' | 'currency' | 'file';
  required?: boolean;
  options?: { value: string; label: string }[];
  unit?: string;
  min?: number;
  max?: number;
  help?: string;
  /** Derived fields are computed, never typed into. */
  computed?: 'grossValue';
  /** Half-width on wide screens. */
  half?: boolean;
}

export interface ActivityType {
  id: ID;
  label: string;
  category: ActivityCategory;
  icon: string;
  /** Extra fields shown on top of the shared base fields. */
  fields: FieldSpec[];
  /** Recording this activity also creates a harvest record. */
  createsHarvest?: boolean;
  /** Recording this activity posts to the ledger with this transaction type. */
  postsLedger?: LedgerTxType;
  custom?: boolean;
  description?: string;
}

export interface Activity {
  id: ID;
  farmerId: ID;
  typeId: ID;
  category: ActivityCategory;
  status: ActivityStatus;
  date: ISODate;
  cropId?: ID;
  notes?: string;
  /** Values for the type-specific fields. */
  data: Record<string, string | number | undefined>;
  harvestId?: ID;
  transactionId?: ID;
  documentIds: ID[];
  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* --------------------------------------------------------------- harvests */

export type HarvestStatus = 'recorded' | 'verified' | 'rejected';

export interface Harvest {
  id: ID;
  farmerId: ID;
  cropId: ID;
  activityId?: ID;
  date: ISODate;
  quantity: number;
  unit: Unit;
  grade: QualityGrade;
  /** Whole RWF per unit. */
  pricePerUnit: number;
  /** Whole RWF deducted at intake (transport, drying, packaging losses). */
  deductions: number;
  status: HarvestStatus;
  batchId?: ID;
  notes?: string;
  createdBy: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* --------------------------------------------------------------- payments */

export type PaymentStatus =
  | 'pending'
  | 'approved'
  | 'processing'
  | 'paid'
  | 'cancelled'
  | 'disputed';

export type PaymentMethod = 'mobile_money' | 'bank_transfer' | 'cash' | 'cheque';

export interface Payment {
  id: ID;
  farmerId: ID;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  date: ISODate;
  reference: string;
  reason: string;
  batchId?: ID;
  harvestIds: ID[];
  transactionId?: ID;
  notes?: string;
  createdBy: ID;
  createdAt: ISODateTime;
  approvedBy?: ID;
  approvedAt?: ISODateTime;
  paidAt?: ISODateTime;
  cancelledReason?: string;
}

export type BatchStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'partially_paid'
  | 'completed'
  | 'cancelled';

export interface PaymentBatch {
  id: ID;
  code: string;
  name: string;
  period: string;
  status: BatchStatus;
  createdBy: ID;
  createdAt: ISODateTime;
  approvedBy?: ID;
  approvedAt?: ISODateTime;
  completedAt?: ISODateTime;
  notes?: string;
}

/* ----------------------------------------------------------------- ledger */

export type LedgerTxType =
  | 'harvest'
  | 'bonus'
  | 'payment'
  | 'advance'
  | 'deduction'
  | 'loan'
  | 'reimbursement'
  | 'adjustment';

export type Direction = 'debit' | 'credit';

/**
 * The financial source of truth. Balances are always folded from these rows --
 * no balance is ever stored on a farmer. Entries are append-only: a mistake is
 * corrected by voiding (which writes a reversing entry), never by deletion.
 */
export interface LedgerTransaction {
  id: ID;
  /** Human-facing reference, e.g. TXN-2026-000184. Unique. */
  code: string;
  farmerId: ID;
  type: LedgerTxType;
  direction: Direction;
  /** Positive integer RWF. Direction carries the sign. */
  amount: number;
  description: string;
  date: ISODate;
  reference?: string;
  harvestId?: ID;
  activityId?: ID;
  paymentId?: ID;
  batchId?: ID;
  voided: boolean;
  voidedBy?: ID;
  voidedAt?: ISODateTime;
  voidReason?: string;
  /** Set on a reversing entry, pointing at the entry it cancels. */
  reversesId?: ID;
  createdBy: ID;
  createdAt: ISODateTime;
}

/** A ledger row with its running balance, as displayed. */
export interface LedgerLine extends LedgerTransaction {
  balanceAfter: number;
}

/* ------------------------------------------------------------ audit/other */

export type AuditAction =
  | 'create'
  | 'update'
  | 'void'
  | 'approve'
  | 'cancel'
  | 'pay'
  | 'import'
  | 'login'
  | 'delete';

export interface AuditEvent {
  id: ID;
  entity: string;
  entityId: ID;
  action: AuditAction;
  summary: string;
  before?: unknown;
  after?: unknown;
  userId: ID;
  at: ISODateTime;
}

export interface DocumentRecord {
  id: ID;
  farmerId: ID;
  activityId?: ID;
  name: string;
  mime: string;
  size: number;
  /** Stored inline as a data URL so the app keeps working offline. */
  dataUrl: string;
  uploadedBy: ID;
  uploadedAt: ISODateTime;
}

export type NotificationKind = 'financial' | 'operational' | 'system';

export interface AppNotification {
  id: ID;
  kind: NotificationKind;
  title: string;
  body: string;
  at: ISODateTime;
  read: boolean;
  link?: string;
}

export interface SavedView {
  id: ID;
  name: string;
  screen: string;
  state: unknown;
  createdAt: ISODateTime;
}
