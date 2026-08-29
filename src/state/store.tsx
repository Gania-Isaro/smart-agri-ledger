/**
 * Application state.
 *
 * One context holds the signed-in user, the reference data every screen needs
 * (crops, cooperatives, activity catalog), a revision counter that screens watch
 * to refetch after a write, plus toasts and the confirmation dialog. Record data
 * itself is not cached here — screens query IndexedDB, which is local and fast,
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
import { db, getSetting, setSetting } from '../db/db';
import { ensureSeeded } from '../db/seed';
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
  users: User[];
  crops: Crop[];
  cooperatives: Cooperative[];
  activityTypes: ActivityType[];
  notifications: AppNotification[];
  online: boolean;
  /** Bumped after every write; screens depend on it to refetch. */
  revision: number;

  signIn: (userId: string, pin: string) => Promise<void>;
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

const SESSION_KEY = 'session_user';

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
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
        await ensureSeeded();
      } catch (e) {
        // A failed seed must not leave the user staring at a spinner: carry on
        // and let the app open, empty, with the reason on the console.
        console.error('Could not prepare the demo data', e);
      }
      const [u, c, co, types, notifs, sessionId] = await Promise.all([
        db.users.toArray(),
        db.crops.toArray(),
        db.cooperatives.toArray(),
        catalog(),
        db.notifications.toArray(),
        getSetting<string | null>(SESSION_KEY, null),
      ]);
      if (cancelled) return;
      setUsers(u);
      setCrops(c);
      setCooperatives(co);
      setActivityTypes(types);
      setNotifications(notifs.sort((a, b) => (a.at < b.at ? 1 : -1)));
      if (sessionId) setUser(u.find((x) => x.id === sessionId) ?? null);
      setReady(true);
    })().catch((e) => {
      console.error('Startup failed', e);
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- reference data follows writes ---- */
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const [notifs, types] = await Promise.all([db.notifications.toArray(), catalog()]);
      setNotifications(notifs.sort((a, b) => (a.at < b.at ? 1 : -1)));
      setActivityTypes(types);
    })();
  }, [revision, ready]);

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
    async (userId, pin) => {
      const found = users.find((u) => u.id === userId);
      if (!found) throw new Error('That account does not exist.');
      if (!found.active) throw new Error('That account has been deactivated.');
      if (found.pin !== pin) throw new Error('That PIN is not correct.');
      await setSetting(SESSION_KEY, found.id);
      setUser(found);
      refresh();
    },
    [users, refresh],
  );

  const signOut = useCallback(() => {
    void setSetting(SESSION_KEY, null);
    setUser(null);
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
      users,
      crops,
      cooperatives,
      activityTypes,
      notifications,
      online,
      revision,
      signIn,
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
      ready, user, users, crops, cooperatives, activityTypes, notifications, online, revision,
      signIn, signOut, refresh, toasts, toast, dismissToast, fail, confirm, confirmState,
      closeConfirm, markNotificationsRead,
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
      cropName: (id?: string) => (id ? crops.find((c) => c.id === id)?.name ?? '—' : '—'),
      coopName: (id?: string) => (id ? cooperatives.find((c) => c.id === id)?.name ?? '—' : '—'),
      userName: (id?: string) => (id ? users.find((u) => u.id === id)?.name ?? 'System' : 'System'),
      typeLabel: (id?: string) => (id ? activityTypes.find((t) => t.id === id)?.label ?? id : '—'),
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
