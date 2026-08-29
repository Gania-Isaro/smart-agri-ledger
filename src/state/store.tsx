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
      const restored = sessionId ? await auth.accountsDb.accounts.get(sessionId) : undefined;

      if (restored) {
        await activate(restored);
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
  const activate = useCallback(async (acc: Account) => {
    openAccountDatabase(acc.id);
    await prepareAccount(acc.id, {
      cooperativeName: acc.cooperativeName,
      ownerId: acc.id,
      ownerName: acc.name,
      ownerEmail: acc.email,
    });

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
    setUser(u.find((x) => x.id === acc.id) ?? null);
    setRevision((r) => r + 1);
  }, []);

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
    (e, fallback = 'Something went wrong.') => {
      const err = e as Error;
      const known =
        err?.name === 'ValidationError' ||
        err?.name === 'PermissionError' ||
        err?.name === 'ConfirmationRequired' ||
        err?.constructor?.name === 'LedgerError' ||
        err?.constructor?.name === 'MoneyError';
      if (!known) console.error(e);
      toast({
        tone: 'error',
        title: err?.name === 'PermissionError' ? 'Not allowed' : 'Could not save',
        message: known && err?.message ? err.message : fallback,
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

  const signOut = useCallback(() => {
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
  }, []);

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
      cropName: (id?: string) => (id ? crops.find((c) => c.id === id)?.name ?? '-' : '-'),
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
