/**
 * Online accounts: the owner creates the cooperative, the manager joins it with
 * the owner's invite code, and both sign in with email and password on any
 * phone.
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

/** Turns Supabase's messages into plain ones people can act on. */
function friendly(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login')) return tx('That email and password do not match an account.');
  if (m.includes('email not confirmed')) return tx('Confirm your email first: open the link Supabase sent you, then sign in.');
  if (m.includes('already registered') || m.includes('already been registered')) return tx('An account with this email already exists. Sign in instead.');
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
    userName: d.user_name || (user.user_metadata?.name as string) || user.email || '',
    email: user.email ?? '',
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

async function signUp(email: string, password: string, meta: Record<string, string>): Promise<boolean> {
  const sb = supabase();
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { data: meta } });
  if (error) fail(error.message);
  // Supabase returns a user with no identities when the email is already taken.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    fail('already registered');
  }
  return Boolean(data.session);
}

/** Owner: create the cooperative online. */
export async function createCooperative(input: { name: string; email: string; password: string; cooperativeName: string }): Promise<SignUpResult> {
  if (!input.name.trim()) throw new CloudError(tx('Enter your name.'));
  if (!input.cooperativeName.trim()) throw new CloudError(tx('Give the cooperative a name'));
  const hasSession = await signUp(input.email, input.password, { name: input.name.trim(), coop_name: input.cooperativeName.trim() });
  if (!hasSession) return { needsConfirmation: true, membership: null };
  await finishPendingSetup();
  return { needsConfirmation: false, membership: await membership() };
}

/** Group manager: join with the code of the group the owner gave them. */
export async function joinCooperative(input: { name: string; email: string; password: string; code: string }): Promise<SignUpResult> {
  if (!input.name.trim()) throw new CloudError(tx('Enter your name.'));
  if (!input.code.trim()) throw new CloudError(tx('Enter the invite code from the owner.'));
  const hasSession = await signUp(input.email, input.password, { name: input.name.trim(), invite_code: input.code.trim() });
  if (!hasSession) return { needsConfirmation: true, membership: null };
  await finishPendingSetup();
  return { needsConfirmation: false, membership: await membership() };
}

export async function signIn(email: string, password: string): Promise<Membership> {
  const sb = supabase();
  const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
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

/** The signed-in person's cooperative, if a session is saved on this phone. */
export async function restore(): Promise<Membership | null> {
  const sb = supabase();
  const { data } = await sb.auth.getSession();
  if (!data.session) return null;
  try {
    return await membership();
  } catch {
    return null;
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
    email: m.email as string,
    role: m.role as CloudRole,
    groupId: (m.group_id as string | null) ?? null,
  }));
}

export async function removeMember(coopId: string, userId: string): Promise<void> {
  const { error } = await supabase().from('members').delete().eq('coop_id', coopId).eq('user_id', userId);
  if (error) fail(error.message);
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
