/**
 * Role-based access control.
 *
 * Permission checks live here and are enforced inside the service layer, not in
 * the UI. Hiding a button is a courtesy; `assertCan` is the actual rule. If this
 * app grows a server, this file moves there untouched and the services call it
 * on the request path.
 */

import type { Role, User } from './types';
import { tx } from '../i18n/tx';

export type Permission =
  | 'farmer.view'
  | 'farmer.create'
  | 'farmer.edit'
  | 'farmer.archive'
  | 'activity.view'
  | 'activity.create'
  | 'activity.edit'
  | 'activity.verify'
  | 'harvest.view'
  | 'harvest.create'
  | 'harvest.edit'
  | 'harvest.verify'
  | 'payment.view'
  | 'payment.create'
  | 'payment.approve'
  | 'payment.settle'
  | 'payment.cancel'
  | 'batch.view'
  | 'batch.create'
  | 'batch.approve'
  | 'ledger.view'
  | 'ledger.post'
  | 'ledger.void'
  | 'report.view'
  | 'report.export'
  | 'data.import'
  | 'settings.manage'
  | 'user.manage'
  | 'audit.view'
  | 'worker.view'
  | 'worker.manage';

const ALL: Permission[] = [
  'farmer.view', 'farmer.create', 'farmer.edit', 'farmer.archive',
  'activity.view', 'activity.create', 'activity.edit', 'activity.verify',
  'harvest.view', 'harvest.create', 'harvest.edit', 'harvest.verify',
  'payment.view', 'payment.create', 'payment.approve', 'payment.settle', 'payment.cancel',
  'batch.view', 'batch.create', 'batch.approve',
  'ledger.view', 'ledger.post', 'ledger.void',
  'report.view', 'report.export', 'data.import',
  'settings.manage', 'user.manage', 'audit.view',
  'worker.view', 'worker.manage',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: ALL,

  cooperative_admin: [
    'farmer.view', 'farmer.create', 'farmer.edit', 'farmer.archive',
    'activity.view', 'activity.create', 'activity.edit', 'activity.verify',
    'harvest.view', 'harvest.create', 'harvest.edit', 'harvest.verify',
    'payment.view', 'payment.create', 'payment.approve', 'payment.cancel',
    'batch.view', 'batch.create', 'batch.approve',
    'ledger.view', 'ledger.post',
    'report.view', 'report.export', 'data.import',
    'settings.manage', 'audit.view',
    'worker.view', 'worker.manage',
  ],

  // Records what happens in the field. Deliberately cannot move money.
  field_officer: [
    'farmer.view', 'farmer.create', 'farmer.edit',
    'activity.view', 'activity.create', 'activity.edit',
    'harvest.view', 'harvest.create', 'harvest.edit',
    'payment.view', 'batch.view', 'ledger.view',
    'report.view',
    'worker.view', 'worker.manage',
  ],

  // Owns the money. Cannot register farmers or record field work.
  accountant: [
    'farmer.view',
    'activity.view',
    'harvest.view', 'harvest.verify',
    'payment.view', 'payment.create', 'payment.approve', 'payment.settle', 'payment.cancel',
    'batch.view', 'batch.create', 'batch.approve',
    'ledger.view', 'ledger.post', 'ledger.void',
    'report.view', 'report.export', 'audit.view',
    'worker.view',
  ],

  viewer: [
    'farmer.view', 'activity.view', 'harvest.view',
    'payment.view', 'batch.view', 'ledger.view', 'report.view',
    'worker.view',
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super Admin',
  cooperative_admin: 'Cooperative Admin',
  field_officer: 'Field Officer',
  accountant: 'Accountant',
  viewer: 'Viewer',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: 'Unrestricted access, including user management and voiding ledger entries.',
  cooperative_admin: 'Runs the cooperative: farmers, activities, harvests, and payment approval.',
  field_officer: 'Records field activities and harvests. Cannot create or approve payments.',
  accountant: 'Owns payments, batches and the ledger. Cannot record field activity.',
  viewer: 'Read-only access to every screen.',
};

export class PermissionError extends Error {
  readonly permission: Permission;
  constructor(permission: Permission, role: Role) {
    super(tx('{role} is not allowed to {action}.', { role: tx(ROLE_LABELS[role]), action: tx(describe(permission)) }));
    this.name = 'PermissionError';
    this.permission = permission;
  }
}

const VERBS: Partial<Record<Permission, string>> = {
  'payment.approve': 'approve payments',
  'payment.settle': 'mark payments as paid',
  'payment.create': 'create payments',
  'payment.cancel': 'cancel payments',
  'batch.approve': 'approve payment batches',
  'ledger.post': 'post ledger transactions',
  'ledger.void': 'void ledger transactions',
  'farmer.create': 'register farmers',
  'harvest.create': 'record harvests',
  'harvest.verify': 'verify harvests',
  'user.manage': 'manage users',
  'data.import': 'import data',
  'worker.manage': 'record work days',
};

function describe(permission: Permission): string {
  return VERBS[permission] ?? `perform "${permission}"`;
}

export function can(user: User | null, permission: Permission): boolean {
  if (!user || !user.active) return false;
  return ROLE_PERMISSIONS[user.role].includes(permission);
}

export function canAll(user: User | null, ...permissions: Permission[]): boolean {
  return permissions.every((p) => can(user, p));
}

export function canAny(user: User | null, ...permissions: Permission[]): boolean {
  return permissions.some((p) => can(user, p));
}

/** Throwing gate used by every mutating service call. */
export function assertCan(user: User | null, permission: Permission): asserts user is User {
  if (!user) throw new PermissionError(permission, 'viewer');
  if (!can(user, permission)) throw new PermissionError(permission, user.role);
}
