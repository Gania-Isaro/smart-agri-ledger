/**
 * Accounts and sign-in.
 *
 * Two separate databases, deliberately:
 *
 *   smart_agri_accounts        the list of accounts, shared, so the login
 *                              screen can find an account before it knows
 *                              which cooperative it belongs to
 *   smart_agri_data_<id>       one per account, holding that cooperative's
 *                              farmers, harvests, payments and ledger
 *
 * Splitting them is what makes a new sign-up genuinely empty. Tagging every
 * record with an owner id instead would mean a single missed `where` clause
 * leaks one cooperative's farmers, and their balances, into another's
 * screens. A separate database per account cannot leak by omission.
 */

import Dexie, { type Table } from 'dexie';
import { uid } from '../lib/id';
import { nowStamp } from '../lib/date';

export interface Account {
  id: string;
  name: string;
  email: string;
  cooperativeName: string;
  /** PBKDF2 hash of the PIN. The PIN itself is never stored. */
  pinHash: string;
  pinSalt: string;
  /** Hash of the recovery code, checked when someone forgets their PIN. */
  recoveryHash: string;
  recoverySalt: string;
  /** Where a reset code would be sent once this is connected to a mail server. */
  recoveryEmail: string;
  /** The demo cooperative ships with data and a published PIN. */
  isDemo: boolean;
  createdAt: string;
  lastSignInAt?: string;
}

class AccountsDB extends Dexie {
  accounts!: Table<Account, string>;

  constructor() {
    super('smart_agri_accounts');
    this.version(1).stores({ accounts: 'id, &email' });
  }
}

export const accountsDb = new AccountsDB();

/** The data database belonging to one account. */
export function dataDbName(accountId: string): string {
  return `smart_agri_data_${accountId}`;
}

/* ------------------------------------------------------------- hashing */

/**
 * PBKDF2-SHA256 via the Web Crypto API, which every target browser has and
 * which needs no dependency. A four-digit PIN is low entropy whatever we do,
 * so the work factor is doing real work here: it makes trying all 10,000
 * combinations against a stolen device slow rather than instant.
 *
 * This is not a substitute for a server-side password store. It is the best
 * available guarantee for an app whose database sits on the device.
 */
const ITERATIONS = 150_000;

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function newSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

export async function hashSecret(secret: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    256,
  );
  return toHex(bits);
}

/** Constant-time-ish comparison, so a wrong PIN cannot be narrowed by timing. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------------------------------- recovery codes */

/**
 * A readable recovery code: no O/0 or I/1, grouped for copying by hand off a
 * phone screen onto paper, which is where it will actually live.
 */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

export function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

/* ------------------------------------------------------------ mutations */

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export interface SignUpInput {
  name: string;
  email: string;
  cooperativeName: string;
  pin: string;
}

export interface SignUpResult {
  account: Account;
  /** Shown once, immediately after sign-up. Never recoverable afterwards. */
  recoveryCode: string;
}

export async function createAccount(input: SignUpInput): Promise<SignUpResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const cooperativeName = input.cooperativeName.trim();
  const pin = input.pin.trim();

  if (name.length < 2) throw new AuthError('Enter your full name.');
  if (!isValidEmail(email)) throw new AuthError('Enter a valid email address.');
  if (cooperativeName.length < 2) throw new AuthError('Enter the name of your cooperative.');
  if (!/^\d{4,8}$/.test(pin)) throw new AuthError('The PIN must be 4 to 8 digits.');
  if (/^(\d)\1+$/.test(pin)) throw new AuthError('That PIN is too easy to guess. Use varied digits.');
  if (['1234', '12345', '123456'].includes(pin)) throw new AuthError('That PIN is too common. Choose another.');

  const existing = await accountsDb.accounts.where('email').equals(email).first();
  if (existing) throw new AuthError('An account already uses that email. Sign in instead.');

  const recoveryCode = generateRecoveryCode();
  const pinSalt = newSalt();
  const recoverySalt = newSalt();

  const account: Account = {
    id: uid('acc'),
    name,
    email,
    cooperativeName,
    pinSalt,
    pinHash: await hashSecret(pin, pinSalt),
    recoverySalt,
    recoveryHash: await hashSecret(normaliseCode(recoveryCode), recoverySalt),
    recoveryEmail: email,
    isDemo: false,
    createdAt: nowStamp(),
  };

  await accountsDb.accounts.put(account);
  return { account, recoveryCode };
}

export async function findByEmail(email: string): Promise<Account | undefined> {
  return accountsDb.accounts.where('email').equals(email.trim().toLowerCase()).first();
}

export async function verifyPin(email: string, pin: string): Promise<Account> {
  const account = await findByEmail(email);
  // Deliberately identical message either way: saying "no such account" tells
  // whoever is holding the phone which addresses are real.
  const rejection = new AuthError('That email and PIN do not match an account.');
  if (!account) throw rejection;

  const hash = await hashSecret(pin.trim(), account.pinSalt);
  if (!sameHash(hash, account.pinHash)) throw rejection;

  const signedIn = { ...account, lastSignInAt: nowStamp() };
  await accountsDb.accounts.put(signedIn);
  return signedIn;
}

/** Step one of a reset: confirm the recovery code belongs to that email. */
export async function verifyRecoveryCode(email: string, code: string): Promise<Account> {
  const account = await findByEmail(email);
  const rejection = new AuthError('That email and recovery code do not match.');
  if (!account) throw rejection;

  const hash = await hashSecret(normaliseCode(code), account.recoverySalt);
  if (!sameHash(hash, account.recoveryHash)) throw rejection;
  return account;
}

/** Step two: set the new PIN, and issue a fresh recovery code. */
export async function resetPin(email: string, code: string, newPin: string): Promise<SignUpResult> {
  const account = await verifyRecoveryCode(email, code);
  const pin = newPin.trim();
  if (!/^\d{4,8}$/.test(pin)) throw new AuthError('The PIN must be 4 to 8 digits.');
  if (/^(\d)\1+$/.test(pin)) throw new AuthError('That PIN is too easy to guess. Use varied digits.');

  // The old code is spent the moment it is used, so a screenshot of it in
  // someone's inbox cannot be replayed later.
  const recoveryCode = generateRecoveryCode();
  const pinSalt = newSalt();
  const recoverySalt = newSalt();

  const updated: Account = {
    ...account,
    pinSalt,
    pinHash: await hashSecret(pin, pinSalt),
    recoverySalt,
    recoveryHash: await hashSecret(normaliseCode(recoveryCode), recoverySalt),
  };

  await accountsDb.accounts.put(updated);
  return { account: updated, recoveryCode };
}

export async function listAccounts(): Promise<Account[]> {
  return accountsDb.accounts.toArray();
}

/* ------------------------------------------------------- the demo login */

export const DEMO_EMAIL = 'owner@agriledger.rw';
export const DEMO_PIN = '1234';
export const DEMO_ACCOUNT_ID = 'acc_demo';

/**
 * The demo account exists so somebody can see a working cooperative in ten
 * seconds without signing up. Its PIN is published in the README on purpose,
 * which is exactly why it is the only account allowed to use '1234', the
 * sign-up form rejects that PIN for everyone else.
 */
export async function ensureDemoAccount(): Promise<Account> {
  const existing = await accountsDb.accounts.get(DEMO_ACCOUNT_ID);
  if (existing) return existing;

  const pinSalt = newSalt();
  const recoverySalt = newSalt();
  const account: Account = {
    id: DEMO_ACCOUNT_ID,
    name: 'Isaro Gania',
    email: DEMO_EMAIL,
    cooperativeName: 'Koperative Abahinzi ba Rwamagana',
    pinSalt,
    pinHash: await hashSecret(DEMO_PIN, pinSalt),
    recoverySalt,
    recoveryHash: await hashSecret('DEMO-DEMO-DEMO', recoverySalt),
    recoveryEmail: DEMO_EMAIL,
    isDemo: true,
    createdAt: '2026-01-05T08:00:00.000Z',
  };
  await accountsDb.accounts.put(account);
  return account;
}
