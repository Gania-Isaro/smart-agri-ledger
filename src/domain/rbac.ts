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
  // The owner sees every group and does everything, including people and settings.
  super_admin: ALL,

  // A group manager runs one group day to day: workers, field work, produce,
  // daily work and payments. Cannot manage people or the cooperative settings.
  manager: ALL.filter((p) => p !== 'user.manage' && p !== 'settings.manage'),
};

export const ROLES: Role[] = ['super_admin', 'manager'];

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Owner',
  manager: 'Group manager',
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: 'The owner. Sees every group and every total, and manages people and settings.',
  manager: 'Runs one group: records its workers, field work, produce, daily work and payments.',
};

/** What each role can and cannot do, in plain words for the Settings page. */
export const ROLE_ACCESS: Record<Role, { can: string[]; cannot: string[] }> = {
  super_admin: {
    can: [
      'See every group, every worker and every photo',
      'See the money per day, week, month and year, for each group and in total',
      'Download the totals to Excel at any time',
      'Create groups and give each one its own manager code',
      'Everything a group manager can do',
      'Change settings and delete the cooperative data',
    ],
    cannot: [],
  },
  manager: {
    can: [
      'Add, edit, archive and delete workers in their group',
      'Record who worked each day, with a photo and the pay',
      'Mark pay as given or still owed, and pay what is owed',
      'Record field activities and produce brought in',
      'See their group’s totals and reports',
    ],
    cannot: [
      'See or change other groups',
      'Manage people or change the cooperative settings',
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
  'farmer.create': 'register workers',
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
