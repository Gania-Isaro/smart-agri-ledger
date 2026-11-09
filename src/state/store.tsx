/**
 * Application state.
 *
 * One context holds the signed-in user, the reference data every screen needs
 * (crops, cooperatives, activity catalog), a revision counter that screens watch
 * to refetch after a write, plus toasts and the confirmation dialog. Record data
 * itself is not cached here, screens query IndexedDB, which is local and fast,
 * so there is no second copy of the truth to fall out of sync.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { closeAccountDatabase, db, openAccountDatabase } from '../db/db';
import { prepareAccount } from '../db/seed';
import * as auth from '../db/accounts';
import type { Account } from '../db/accounts';
import { uid } from '../lib/id';
import type {
  ActivityType,
  AppNotification,
  Cooperative,
  Crop,
  User,
} from '../domain/types';
import { can, type Permission } from '../domain/rbac';
import { catalog } from '../services/activityService';
import { cloudEnabled } from '../cloud/client';
import * as cloud from '../cloud/account';
import { onSyncStatus, startSync, stopSync, syncNow, type SyncStatus } from '../cloud/sync';

import { cropLabel, tx } from '../i18n/tx';
/* ---------------------------------------------------------------- toasts */

export type ToastTone = 'success' | 'error' | 'warn' | 'info';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
  action?: { label: string; run: () => void };
  duration: number;
}

/* --------------------------------------------------------------- confirm */

export interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** Ask the user to type this exact word before the action unlocks. */
  typeToConfirm?: string;
  /** Shown as a required free-text reason, returned to the caller. */
  reasonLabel?: string;
}

export interface ConfirmResult {
  ok: boolean;
  reason?: string;
}

/* ----------------------------------------------------------------- store */

interface Store {
  ready: boolean;
  user: User | null;
  /** The signed-in account. Null on the login screen. */
  account: Account | null;
  isDemo: boolean;
  users: User[];
  crops: Crop[];
  cooperatives: Cooperative[];
  activityTypes: ActivityType[];
  notifications: AppNotification[];
  online: boolean;
  /** Bumped after every write; screens depend on it to refetch. */
  revision: number;

  signIn: (email: string, pin: string) => Promise<void>;
  signUp: (input: auth.SignUpInput) => Promise<auth.SignUpResult>;

  /** Online mode: set up when the app is built with Supabase settings. */
  cloudEnabled: boolean;
  /** The online cooperative this phone is signed in to, if any. */
  membership: cloud.Membership | null;
  sync: SyncStatus | null;
  cloudSignIn: (email: string, password: string) => Promise<void>;
  cloudCreate: (input: { name: string; email: string; password: string; cooperativeName: string }) => Promise<cloud.SignUpResult>;
  cloudJoin: (input: { name: string; email: string; password: string; code: string }) => Promise<cloud.SignUpResult>;
  syncNow: () => Promise<void>;
  /** Updates the cached membership, for example after a new invite code. */
  setMembership: (m: cloud.Membership) => void;
  resetPin: (email: string, code: string, newPin: string) => Promise<auth.SignUpResult>;
  signOut: () => void;
  refresh: () => void;
  can: (permission: Permission) => boolean;

  toasts: Toast[];
  toast: (t: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => void;
  dismissToast: (id: string) => void;
  /** Reports an error from a service call in the user's language. */
  fail: (e: unknown, fallback?: string) => void;

  confirm: (req: ConfirmRequest) => Promise<ConfirmResult>;
  confirmState: (ConfirmRequest & { resolve: (r: ConfirmResult) => void }) | null;
  closeConfirm: (r: ConfirmResult) => void;

  markNotificationsRead: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}

const SESSION_KEY = 'agri.session';
/** Session marker for an online cooperative. */
const CLOUD_SESSION = 'cloud';
/** The online cooperative, remembered so the app opens with no signal. */
const MEMBERSHIP_KEY = 'agri.cloud.membership';

function readMembership(): cloud.Membership | null {
  try {
    return JSON.parse(localStorage.getItem(MEMBERSHIP_KEY) ?? 'null') as cloud.Membership | null;
  } catch {
    return null;
  }
}

function writeMembership(m: cloud.Membership | null): void {
  try {
    if (m) localStorage.setItem(MEMBERSHIP_KEY, JSON.stringify(m));
    else localStorage.removeItem(MEMBERSHIP_KEY);
  } catch {
    /* the person signs in again next time */
  }
}

/** A local account record standing in for an online cooperative. */
function cloudAccount(m: cloud.Membership): Account {
  return {
    id: `cloud_${m.coopId}`,
    name: m.userName,
    email: m.email,
    cooperativeName: m.coopName,
    pinHash: '',
    pinSalt: '',
    recoveryHash: '',
    recoverySalt: '',
    recoveryEmail: m.email,
    isDemo: false,
    createdAt: new Date().toISOString(),
  };
}

/*
 * The session lives in localStorage, not in a database. It has to be readable
 * before any account database is open, and writable during sign-out after the
 * account database has been released, storing it in IndexedDB meant it landed
 * in whichever database happened to be open at the time.
 */
function readSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

function writeSession(id: string | null): void {
  try {
    if (id) localStorage.setItem(SESSION_KEY, id);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private browsing: the user simply signs in again next time */
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [cooperatives, setCooperatives] = useState<Cooperative[]>([]);
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [revision, setRevision] = useState(0);
  const [online, setOnline] = useState(navigator.onLine);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<(ConfirmRequest & { resolve: (r: ConfirmResult) => void }) | null>(null);
  const [membership, setMembershipState] = useState<cloud.Membership | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);

  const timers = useRef(new Map<string, number>());

  /* ---- boot ---- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // The demo account always exists so anyone can look around without
        // signing up. It is created here, not at sign-in, so its email is
        // already known to the login screen.
        await auth.ensureDemoAccount();
      } catch (e) {
        console.error('Could not prepare the demo account', e);
      }

      const sessionId = readSession();
      if (sessionId === CLOUD_SESSION && cloudEnabled) {
        // Open straight from the remembered cooperative so the app works with
        // no signal, then confirm the membership in the background.
        const cached = readMembership();
        if (cached) {
          await activateCloud(cached);
          void cloud.restore().then((fresh) => {
            if (fresh) {
              writeMembership(fresh);
              setMembershipState(fresh);
            }
          });
        }
      } else {
        const restored = sessionId ? await auth.accountsDb.accounts.get(sessionId) : undefined;
        if (restored) {
          await activate(restored);
        }
      }
      if (!cancelled) setReady(true);
    })().catch((e) => {
      console.error('Startup failed', e);
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Point the app at an account: open its database, make sure it has been
   * prepared, then load the reference data the screens need. Everything after
   * this reads through the `db` binding, which now refers to this account.
   */
  const activate = useCallback(async (acc: Account, person?: { id: string; role: User['role']; cloud: boolean }) => {
    openAccountDatabase(acc.id, { cloud: person?.cloud });
    await prepareAccount(acc.id, {
      cooperativeName: acc.cooperativeName,
      ownerId: person?.id ?? acc.id,
      ownerName: acc.name,
      ownerEmail: acc.email,
    });
    if (person) {
      // Each person on an online cooperative has their own user record, with
      // the role the cooperative gave them.
      const existing = await db.users.get(person.id);
      if (!existing || existing.role !== person.role || existing.name !== acc.name) {
        await db.users.put({
          id: person.id,
          name: acc.name,
          email: acc.email,
          pin: '',
          role: person.role,
          cooperativeId: 'coop_own',
          active: true,
          createdAt: existing?.createdAt ?? new Date().toISOString(),
        });
      }
    }

    const [u, c, co, types, notifs] = await Promise.all([
      db.users.toArray(),
      db.crops.toArray(),
      db.cooperatives.toArray(),
      catalog(),
      db.notifications.toArray(),
    ]);

    setUsers(u);
    setCrops(c);
    setCooperatives(co);
    setActivityTypes(types);
    setNotifications(notifs.sort((a, b) => (a.at < b.at ? 1 : -1)));
    setAccount(acc);
    setUser((await db.users.get(person?.id ?? acc.id)) ?? u.find((x) => x.id === acc.id) ?? null);
    setUsers(await db.users.toArray());
    setRevision((r) => r + 1);
  }, []);

  /**
   * Open an online cooperative: download what the other phones recorded,
   * then open it like any other account.
   */
  const activateCloud = useCallback(
    async (m: cloud.Membership) => {
      const acc = cloudAccount(m);
      openAccountDatabase(acc.id, { cloud: true });
      setMembershipState(m);
      await startSync(db, m.coopId, () => {
        // Records arrived from another phone: reload reference data and screens.
        void Promise.all([db.users.toArray(), db.crops.toArray(), db.cooperatives.toArray()]).then(([u, c, co]) => {
          setUsers(u);
          setCrops(c);
          setCooperatives(co);
          setRevision((r) => r + 1);
        });
      });
      const role: User['role'] = m.role === 'owner' ? 'super_admin' : m.role === 'accountant' ? 'accountant' : 'manager';
      await activate(acc, { id: m.userId, role, cloud: true });
    },
    [activate],
  );

  useEffect(() => (membership ? onSyncStatus(setSync) : undefined), [membership]);

  /* ---- reference data follows writes ---- */
  useEffect(() => {
    if (!ready || !account) return;
    (async () => {
      const [notifs, types] = await Promise.all([db.notifications.toArray(), catalog()]);
      setNotifications(notifs.sort((a, b) => (a.at < b.at ? 1 : -1)));
      setActivityTypes(types);
    })();
  }, [revision, ready, account]);

  /* ---- connectivity ---- */
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const refresh = useCallback(() => setRevision((r) => r + 1), []);

  const dismissToast = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback<Store['toast']>(
    (t) => {
      const id = uid();
      const duration = t.duration ?? (t.tone === 'error' ? 7000 : 3800);
      setToasts((list) => [...list.slice(-3), { ...t, id, duration }]);
      timers.current.set(id, window.setTimeout(() => dismissToast(id), duration));
    },
    [dismissToast],
  );

  /**
   * Service errors are already written for humans (permission messages name the
   * role, validation names the field), so they are shown as-is. Anything else
   * gets a generic line plus a console trace for whoever is debugging.
   */
  const fail = useCallback<Store['fail']>(
    (e, fallback) => {
      const err = e as Error;
      const known =
        err?.name === 'ValidationError' ||
        err?.name === 'PermissionError' ||
        err?.name === 'ConfirmationRequired' ||
        err?.constructor?.name === 'LedgerError' ||
        err?.constructor?.name === 'MoneyError' ||
        err instanceof cloud.CloudError;
      if (!known) console.error(e);
      toast({
        tone: 'error',
        title: err?.name === 'PermissionError' ? tx('Not allowed') : tx('Could not save'),
        message: known && err?.message ? err.message : fallback ?? tx('Something went wrong.'),
      });
    },
    [toast],
  );

  const confirm = useCallback<Store['confirm']>(
    (req) => new Promise<ConfirmResult>((resolve) => setConfirmState({ ...req, resolve })),
    [],
  );

  const closeConfirm = useCallback(
    (r: ConfirmResult) => {
      confirmState?.resolve(r);
      setConfirmState(null);
    },
    [confirmState],
  );

  const signIn = useCallback<Store['signIn']>(
    async (email, pin) => {
      const acc = await auth.verifyPin(email, pin);
      writeSession(acc.id);
      await activate(acc);
    },
    [activate],
  );

  /*
   * Creating the account deliberately does NOT sign the user in. The recovery
   * code is shown exactly once, and dropping them straight onto the dashboard
   * would sweep it off screen before they had written it down, leaving an
   * account nobody can ever get back into. Login calls signIn once they have
   * confirmed they saved it.
   */
  const signUp = useCallback<Store['signUp']>(async (input) => auth.createAccount(input), []);

  const resetPinFn = useCallback<Store['resetPin']>(async (email, code, newPin) => {
    return auth.resetPin(email, code, newPin);
  }, []);

  const enterCloud = useCallback(
    async (m: cloud.Membership) => {
      writeMembership(m);
      writeSession(CLOUD_SESSION);
      await activateCloud(m);
    },
    [activateCloud],
  );

  const cloudSignIn = useCallback<Store['cloudSignIn']>(
    async (email, password) => {
      await enterCloud(await cloud.signIn(email, password));
    },
    [enterCloud],
  );

  const cloudCreate = useCallback<Store['cloudCreate']>(
    async (input) => {
      const r = await cloud.createCooperative(input);
      if (r.membership) await enterCloud(r.membership);
      return r;
    },
    [enterCloud],
  );

  const cloudJoin = useCallback<Store['cloudJoin']>(
    async (input) => {
      const r = await cloud.joinCooperative(input);
      if (r.membership) await enterCloud(r.membership);
      return r;
    },
    [enterCloud],
  );

  const setMembership = useCallback((m: cloud.Membership) => {
    writeMembership(m);
    setMembershipState(m);
  }, []);

  const signOut = useCallback(() => {
    if (membership) {
      // Upload anything still waiting before leaving, then end the online session.
      void syncNow().finally(() => {
        stopSync();
        void cloud.signOut();
      });
      writeMembership(null);
      setMembershipState(null);
      setSync(null);
    }
    writeSession(null);
    setUser(null);
    setAccount(null);
    setUsers([]);
    setCrops([]);
    setCooperatives([]);
    setNotifications([]);
    // Release the handle so the next account opens a clean connection.
    closeAccountDatabase();
    window.location.hash = '#/overview';
  }, [membership]);

  const markNotificationsRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.read);
    if (unread.length === 0) return;
    await db.notifications.bulkPut(unread.map((n) => ({ ...n, read: true })));
    setNotifications((list) => list.map((n) => ({ ...n, read: true })));
  }, [notifications]);

  const value = useMemo<Store>(
    () => ({
      ready,
      user,
      account,
      isDemo: account?.isDemo ?? false,
      users,
      crops,
      cooperatives,
      activityTypes,
      notifications,
      online,
      revision,
      signIn,
      signUp,
      cloudEnabled,
      membership,
      sync,
      cloudSignIn,
      cloudCreate,
      cloudJoin,
      syncNow,
      setMembership,
      resetPin: resetPinFn,
      signOut,
      refresh,
      can: (permission) => can(user, permission),
      toasts,
      toast,
      dismissToast,
      fail,
      confirm,
      confirmState,
      closeConfirm,
      markNotificationsRead,
    }),
    [
      ready, user, account, users, crops, cooperatives, activityTypes, notifications, online, revision,
      signIn, signUp, resetPinFn, signOut, refresh, toasts, toast, dismissToast, fail, confirm,
      membership, sync, cloudSignIn, cloudCreate, cloudJoin, setMembership,
      confirmState, closeConfirm, markNotificationsRead,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/* ------------------------------------------------------------ lookup maps */

export function useLookups() {
  const { crops, cooperatives, users, activityTypes } = useStore();
  return useMemo(
    () => ({
      crop: new Map(crops.map((c) => [c.id, c])),
      coop: new Map(cooperatives.map((c) => [c.id, c])),
      user: new Map(users.map((u) => [u.id, u])),
      type: new Map(activityTypes.map((t) => [t.id, t])),
      cropName: (id?: string) => (id ? cropLabel(crops.find((c) => c.id === id)) : '-'),
      coopName: (id?: string) => (id ? cooperatives.find((c) => c.id === id)?.name ?? '-' : '-'),
      userName: (id?: string) => (id ? users.find((u) => u.id === id)?.name ?? 'System' : 'System'),
      typeLabel: (id?: string) => (id ? activityTypes.find((t) => t.id === id)?.label ?? id : '-'),
    }),
    [crops, cooperatives, users, activityTypes],
  );
}

/**
 * Load data from IndexedDB and refetch whenever the store revision changes.
 * Keeps every screen a one-liner away from live data without a cache layer.
 */
export function useQuery<T>(loader: () => Promise<T>, deps: unknown[] = []): { data: T | null; loading: boolean; reload: () => void } {
  const { revision } = useStore();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loaderRef
      .current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.error(e);
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision, tick, ...deps]);

  return { data, loading, reload: () => setTick((t) => t + 1) };
}
