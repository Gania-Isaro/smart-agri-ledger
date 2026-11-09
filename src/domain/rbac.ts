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
  // The owner sees and does everything, including people and settings.
  super_admin: ALL,

  // Runs the field: farmers, field work, harvests and who worked each day.
  // Sees the money but cannot move it.
  manager: [
    'farmer.view', 'farmer.create', 'farmer.edit', 'farmer.archive',
    'activity.view', 'activity.create', 'activity.edit', 'activity.verify',
    'harvest.view', 'harvest.create', 'harvest.edit', 'harvest.verify',
    'worker.view', 'worker.manage',
    'payment.view', 'batch.view', 'ledger.view',
    'report.view', 'report.export', 'data.import',
  ],

  // Owns the money: payments, payment lists and the ledger. Sees the farmers
  // and their work but does not record field activity.
  accountant: [
    'farmer.view',
    'activity.view',
    'harvest.view', 'harvest.verify',
    'worker.view',
    'payment.view', 'payment.create', 'payment.approve', 'payment.settle', 'payment.cancel',
    'batch.view', 'batch.create', 'batch.approve',
    'ledger.view', 'ledger.post', 'ledger.void',
    'report.view', 'report.export', 'audit.view',
  ],
};

export const ROLES: Role[] = ['super_admin', 'manager', 'accountant'];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Owner',
  manager: 'Field manager',
  accountant: 'Accountant',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: 'The owner. Sees and does everything, and manages people and settings.',
  manager: 'Runs the field: farmers, field work, harvests and daily work. Sees the money but cannot move it.',
  accountant: 'Runs the money: payments, payment lists and the ledger. Sees the farmers but does not record field work.',
};

/** What each role can and cannot do, in plain words for the Settings page. */
export const ROLE_ACCESS: Record<Role, { can: string[]; cannot: string[] }> = {
  super_admin: {
    can: [
      'Everything the field manager and the accountant can do',
      'Add and remove people, and choose their role',
      'Change settings and delete the cooperative data',
      'See the full audit trail of who did what',
    ],
    cannot: [],
  },
  manager: {
    can: [
      'Register, edit, archive and delete farmers',
      'Record field work, harvests and deliveries',
      'Record daily work with a photo, and set the pay for the day',
      'Verify harvests',
      'See balances, payments, the ledger and reports',
    ],
    cannot: [
      'Create, approve or mark payments as paid',
      'Post or void ledger entries',
      'Change settings or manage people',
    ],
  },
  accountant: {
    can: [
      'Create, approve and record payments, and build payment lists',
      'Post and void ledger entries',
      'Verify harvests',
      'See farmers, daily work and reports, and export them',
      'See the audit trail',
    ],
    cannot: [
      'Register or edit farmers',
      'Record field work, harvests or daily work',
      'Change settings or manage people',
    ],
  },
};

export class PermissionError extends Error {
  readonly permission: Permission;
  constructor(permission: Permission, role: Role | null) {
    super(
      role
        ? tx('{role} is not allowed to {action}.', { role: tx(ROLE_LABELS[role]), action: tx(describe(permission)) })
        : tx('Sign in to {action}.', { action: tx(describe(permission)) }),
    );
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
  if (!user) throw new PermissionError(permission, null);
  if (!can(user, permission)) throw new PermissionError(permission, user.role);
}
