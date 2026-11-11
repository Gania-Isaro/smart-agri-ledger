/**
 * Online accounts: the owner creates the cooperative, the manager joins it with
 * their group's code, and both sign in with their phone number and a password
 * on any phone.
 *
 * Not every manager has an email address, and sending an SMS costs money, so a
 * phone number is turned into a private sign-in name (see loginName). Nothing
 * is ever sent to it. People who signed up with an email before this still
 * sign in with that email.
 *
 * If the Supabase project asks people to confirm their email first, sign-up
 * cannot finish straight away. What the person was doing (creating a
 * cooperative, or joining one with a code) is saved with their account, and
 * finished automatically the first time they sign in.
 */

import { supabase } from './client';
import { tx } from '../i18n/tx';

export type CloudRole = 'owner' | 'manager';

export interface Membership {
  coopId: string;
  coopName: string;
  role: CloudRole;
  /** The group a manager runs; null for the owner, who sees every group. */
  groupId: string | null;
  userId: string;
  userName: string;
  email: string;
}

export class CloudError extends Error {}

/** Where phone sign-in names live. No mail is ever sent there. */
const PHONE_DOMAIN = (import.meta.env.VITE_PHONE_LOGIN_DOMAIN as string | undefined) || 'gania.tech';
const PHONE_NAME = new RegExp(`^p(\\d{9,15})@${PHONE_DOMAIN.replace(/\./g, '\\.')}$`, 'i');

/**
 * A phone number as its digits with the country code: 0788 123 456,
 * 788123456 and +250 788 123 456 are all 250788123456. Numbers from another
 * country are written with their + code.
 */
export function phoneDigits(input: string): string {
  const raw = input.trim();
  let d = raw.replace(/\D/g, '');
  if (raw.startsWith('+') || d.startsWith('00')) d = d.replace(/^00/, '');
  else if (d.length === 10 && d.startsWith('0')) d = `250${d.slice(1)}`;
  else if (d.length === 9 && d.startsWith('7')) d = `250${d}`;
  if (d.length < 9 || d.length > 15) throw new CloudError(tx('Enter a valid phone number, for example 0788 123 456.'));
  return d;
}

/** The name an account signs in under: the email as typed, or the phone number's private name. */
export function loginName(phoneOrEmail: string): string {
  const v = phoneOrEmail.trim();
  if (!v) throw new CloudError(tx('Enter your phone number and password.'));
  if (v.includes('@')) return v.toLowerCase();
  return `p${phoneDigits(v)}@${PHONE_DOMAIN}`;
}

/** What to show people for a sign-in name: the phone number, or the email. */
export function showLogin(name: string | null | undefined): string {
  const m = PHONE_NAME.exec(name ?? '');
  if (!m) return name ?? '';
  const d = m[1]!;
  return d.startsWith('250') && d.length === 12 ? `+250 ${d.slice(3, 6)} ${d.slice(6, 9)} ${d.slice(9)}` : `+${d}`;
}

/** A code only its owner knows, shown once: XXXX-XXXX-XXXX-XXXX, no look-alike letters. */
function makeRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

/** Where a fresh recovery code waits until the person has written it down. */
export const RECOVERY_KEY = 'agri.recovery';
export const RECOVERY_EVENT = 'agri:recovery';

/**
 * Give the signed-in person a new recovery code and hand it to the screen
 * that shows it once. Returns false when the online copy does not support
 * recovery codes yet (phone.sql has not been run).
 */
export async function newRecoveryCode(): Promise<boolean> {
  const code = makeRecoveryCode();
  const { error } = await supabase().rpc('set_recovery_code', { p_code: code });
  if (error) return false;
  try {
    sessionStorage.setItem(RECOVERY_KEY, code);
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(RECOVERY_EVENT));
  return true;
}

/** Set a new password with the owner's recovery code or, for a manager, their group's code. */
export async function resetWithCode(phoneOrEmail: string, code: string, password: string): Promise<void> {
  const login = loginName(phoneOrEmail);
  if (!code.trim()) throw new CloudError(tx('Enter the code.'));
  if (password.length < 6) throw new CloudError(tx('Choose a password of at least 6 characters.'));
  const { data, error } = await supabase().rpc('reset_password_with_code', { p_login: login, p_code: code.trim(), p_password: password });
  if (error) fail(error.message);
  if (data === 'locked') throw new CloudError(tx('Too many wrong codes. Wait 15 minutes and try again.'));
  if (data !== 'ok') throw new CloudError(tx('That phone number and code do not match. Check both and try again.'));
}

/** Turns Supabase's messages into plain ones people can act on. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('missing email') || m.includes('missing password') || m.includes('anonymous sign-ins')) return tx('Enter your phone number and password.');
  if (m.includes('unable to validate email') || m.includes('invalid email') || m.includes('email address') && m.includes('invalid')) return tx('That phone number or email was not accepted. Check it and try again.');
  if (m.includes('invalid login')) return tx('That phone number and password do not match an account.');
  if (m.includes('email not confirmed')) return tx('This account is not confirmed yet. Ask the person who set up the app for help.');
  if (m.includes('already registered') || m.includes('already been registered')) return tx('An account with this phone number already exists. Sign in instead.');
  if (m.includes('could not find the function') || m.includes('pgrst202')) return tx('This is not switched on yet. Ask the person who set up the app to run the phone sign-in script.');
  if (m.includes('password should be') || m.includes('weak password')) return tx('Choose a password of at least 6 characters.');
  if (m.includes('invite code is not valid')) return tx('That invite code is not valid. Check it with the owner.');
  if (m.includes('failed to fetch') || m.includes('network')) return tx('No internet connection. Connect and try again.');
  if (m.includes('rate limit')) return tx('Too many attempts. Wait a minute and try again.');
  return message;
}

function fail(message: string): never {
  throw new CloudError(friendly(message));
}

async function membership(): Promise<Membership | null> {
  const sb = supabase();
  const { data: auth } = await sb.auth.getUser();
  const user = auth.user;
  if (!user) return null;
  const { data, error } = await sb.rpc('my_coop');
  if (error) fail(error.message);
  if (!data) return null;
  const d = data as { coop_id: string; name: string; role: CloudRole; group_id: string | null; user_name: string };
  return {
    coopId: d.coop_id,
    coopName: d.name,
    role: d.role,
    groupId: d.role === 'owner' ? null : d.group_id,
    userId: user.id,
    userName: d.user_name || (user.user_metadata?.name as string) || showLogin(user.email) || '',
    // What the screens show for this person: their phone number, or their email.
    email: showLogin(user.email),
  };
}

/** Finishes a sign-up that was waiting for email confirmation. */
async function finishPendingSetup(): Promise<void> {
  const sb = supabase();
  const { data } = await sb.auth.getUser();
  const meta = (data.user?.user_metadata ?? {}) as { name?: string; coop_name?: string; invite_code?: string };
  if (meta.invite_code) {
    const { error } = await sb.rpc('join_coop', { p_code: meta.invite_code, p_user_name: meta.name ?? '' });
    if (error) fail(error.message);
  } else if (meta.coop_name) {
    const { error } = await sb.rpc('create_coop', { p_name: meta.coop_name, p_user_name: meta.name ?? '' });
    if (error) fail(error.message);
  }
}

export interface SignUpResult {
  /** True when Supabase wants the email confirmed before the first sign-in. */
  needsConfirmation: boolean;
  membership: Membership | null;
}

async function signUp(login: string, password: string, meta: Record<string, string>): Promise<boolean> {
  if (!password) throw new CloudError(tx('Enter your phone number and password.'));
  const sb = supabase();
  const { data, error } = await sb.auth.signUp({ email: login, password, options: { data: meta } });
  if (error) fail(error.message);
  // Supabase returns a user with no identities when the email is already taken.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    fail('already registered');
  }
  return Boolean(data.session);
}

export interface NewPerson {
  name: string;
  phone: string;
  /** Optional, kept only as a way to contact the person. */
  email?: string;
  password: string;
}

function contact(input: NewPerson): Record<string, string> {
  const email = input.email?.trim() ?? '';
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new CloudError(tx('That email address does not look right. Leave it empty if you have none.'));
  return { name: input.name.trim(), phone: `+${phoneDigits(input.phone)}`, ...(email ? { contact_email: email } : {}) };
}

/** A phone account has no mailbox to confirm, so sign-up has to finish at once. */
const NOT_CONFIRMED = () => new CloudError(tx('This account is not confirmed yet. Ask the person who set up the app for help.'));

/** Owner: create the cooperative online. */
export async function createCooperative(input: NewPerson & { cooperativeName: string }): Promise<SignUpResult> {
  if (!input.name.trim()) throw new CloudError(tx('Enter your name.'));
  if (!input.cooperativeName.trim()) throw new CloudError(tx('Give the cooperative a name'));
  const hasSession = await signUp(loginName(input.phone), input.password, { ...contact(input), coop_name: input.cooperativeName.trim() });
  if (!hasSession) throw NOT_CONFIRMED();
  await finishPendingSetup();
  const m = await membership();
  // The owner cannot ask anyone else for a code, so they get one of their own, shown once.
  if (m) await newRecoveryCode();
  return { needsConfirmation: false, membership: m };
}

/** Group manager: join with the code of the group the owner gave them. */
export async function joinCooperative(input: NewPerson & { code: string }): Promise<SignUpResult> {
  if (!input.name.trim()) throw new CloudError(tx('Enter your name.'));
  if (!input.code.trim()) throw new CloudError(tx('Enter the invite code from the owner.'));
  const login = loginName(input.phone);
  const sb = supabase();
  let hasSession: boolean;
  try {
    hasSession = await signUp(login, input.password, { ...contact(input), invite_code: input.code.trim() });
  } catch (e) {
    // Someone who was in a group before (and was removed, or is changing
    // group) already has an account: their password and the new code are enough.
    if (!(e instanceof CloudError) || e.message !== tx('An account with this phone number already exists. Sign in instead.')) throw e;
    const again = await sb.auth.signInWithPassword({ email: login, password: input.password });
    if (again.error) throw new CloudError(tx('This phone number already has an account. Type the password you chose before, or use Forgotten your password.'));
    const joined = await sb.rpc('join_coop', { p_code: input.code.trim(), p_user_name: input.name.trim() });
    if (joined.error) {
      await sb.auth.signOut();
      fail(joined.error.message);
    }
    return { needsConfirmation: false, membership: await membership() };
  }
  if (!hasSession) throw NOT_CONFIRMED();
  await finishPendingSetup();
  return { needsConfirmation: false, membership: await membership() };
}

export async function signIn(phoneOrEmail: string, password: string): Promise<Membership> {
  if (!phoneOrEmail.trim() || !password) throw new CloudError(tx('Enter your phone number and password.'));
  const sb = supabase();
  const { error } = await sb.auth.signInWithPassword({ email: loginName(phoneOrEmail), password });
  if (error) fail(error.message);
  let m = await membership();
  if (!m) {
    await finishPendingSetup();
    m = await membership();
  }
  if (!m) {
    await sb.auth.signOut();
    throw new CloudError(tx('This account is not part of a cooperative yet. Ask the owner for an invite code.'));
  }
  return m;
}

/**
 * Checks the signed-in person against the online copy.
 *   member   still in the cooperative (with their current role and group)
 *   removed  the owner removed them from the cooperative
 *   expired  their saved sign-in is no longer valid; they must sign in again
 *   unknown  could not be checked now (no signal); nothing should change
 */
export type Standing = { state: 'member'; membership: Membership } | { state: 'removed' } | { state: 'expired' } | { state: 'unknown' };

export async function standing(): Promise<Standing> {
  if (!navigator.onLine) return { state: 'unknown' };
  const sb = supabase();
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) return { state: 'unknown' };
    if (!data.session) return { state: 'expired' };
    const { data: row, error: rpcError } = await sb.rpc('my_coop');
    if (rpcError) return { state: 'unknown' };
    if (!row) return { state: 'removed' };
    const m = await membership();
    return m ? { state: 'member', membership: m } : { state: 'removed' };
  } catch {
    return { state: 'unknown' };
  }
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
}

export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin + window.location.pathname });
  if (error) fail(error.message);
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: CloudRole;
  groupId: string | null;
}

/** Everyone in the cooperative. Only the owner gets the full list. */
export async function members(coopId: string): Promise<Member[]> {
  const { data, error } = await supabase().from('members').select('user_id,name,email,role,group_id').eq('coop_id', coopId).order('created_at');
  if (error) fail(error.message);
  return (data ?? []).map((m) => ({
    userId: m.user_id as string,
    name: m.name as string,
    email: showLogin(m.email as string),
    role: m.role as CloudRole,
    groupId: (m.group_id as string | null) ?? null,
  }));
}

/** Owner: take a manager out of the cooperative. They can no longer see or change anything. */
export async function removeMember(coopId: string, userId: string): Promise<void> {
  const { data, error } = await supabase().from('members').delete().eq('coop_id', coopId).eq('user_id', userId).select('user_id');
  if (error) fail(error.message);
  if (!data?.length) throw new CloudError(tx('That person could not be removed. Check your connection and try again.'));
}

/** The manager code for one group (created the first time). Owner only. */
export async function groupCode(coopId: string, groupId: string): Promise<string> {
  const { data, error } = await supabase().rpc('group_code', { p_coop: coopId, p_group: groupId });
  if (error) fail(error.message);
  return data as string;
}

/** Replace a group's manager code, for example after a manager leaves. Owner only. */
export async function newGroupCode(coopId: string, groupId: string): Promise<string> {
  const { data, error } = await supabase().rpc('new_group_code', { p_coop: coopId, p_group: groupId });
  if (error) fail(error.message);
  return data as string;
}
