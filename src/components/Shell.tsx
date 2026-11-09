/**
 * App shell: sidebar on desktop, bottom tab bar on phones, plus the topbar and
 * the "+" button that is present on every screen.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, BrandMark, type IconName } from './ui/Icon';
import { Popover } from './ui/primitives';
import { Link, navigate, useRoute } from '../state/router';
import { useStore } from '../state/store';
import { timeAgo } from '../lib/date';
import { usePrefs, useT } from '../i18n';
import { LANGUAGES } from '../i18n/strings';

interface NavEntry {
  /** Translation key; falls back to itself if a language lacks the string. */
  label: string;
  path: string;
  icon: IconName;
  children?: { label: string; path: string; countKey?: CountKey }[];
}

type CountKey = 'awaitingPayment' | 'pendingPayments' | 'unverified';

export const NAV: NavEntry[] = [
  { label: 'nav.overview', path: '/overview', icon: 'home' },
  {
    label: 'nav.farmers',
    path: '/farmers',
    icon: 'users',
    children: [
      { label: 'nav.farmers.all', path: '/farmers' },
      { label: 'nav.farmers.active', path: '/farmers/active' },
      { label: 'nav.farmers.groups', path: '/farmers/groups' },
    ],
  },
  {
    label: 'nav.activities',
    path: '/activities',
    icon: 'list',
    children: [
      { label: 'nav.activities.all', path: '/activities' },
      { label: 'nav.activities.farming', path: '/activities/farming' },
      { label: 'nav.activities.harvest', path: '/activities/harvest' },
      { label: 'nav.activities.other', path: '/activities/other' },
    ],
  },
  {
    label: 'nav.production',
    path: '/production',
    icon: 'basket',
    children: [
      { label: 'nav.production.harvests', path: '/production/harvests', countKey: 'unverified' },
      { label: 'nav.production.crops', path: '/production/crops' },
      { label: 'nav.production.quality', path: '/production/quality' },
    ],
  },
  {
    label: 'nav.payments',
    path: '/payments',
    icon: 'coins',
    children: [
      { label: 'nav.payments.pending', path: '/payments/pending', countKey: 'pendingPayments' },
      { label: 'nav.payments.batches', path: '/payments/batches' },
      { label: 'nav.payments.completed', path: '/payments/completed' },
      { label: 'nav.payments.outstanding', path: '/payments/outstanding', countKey: 'awaitingPayment' },
    ],
  },
  {
    label: 'nav.ledger',
    path: '/ledger',
    icon: 'book',
    children: [
      { label: 'nav.ledger.farmers', path: '/ledger' },
      { label: 'nav.ledger.transactions', path: '/ledger/transactions' },
      { label: 'nav.ledger.adjustments', path: '/ledger/adjustments' },
    ],
  },
  { label: 'nav.work', path: '/work', icon: 'camera' },
  { label: 'nav.reports', path: '/reports', icon: 'chart' },
  { label: 'nav.settings', path: '/settings', icon: 'settings' },
];

const TABS: { label: string; path: string; icon: IconName }[] = [
  { label: 'nav.overview', path: '/overview', icon: 'home' },
  { label: 'nav.farmers', path: '/farmers', icon: 'users' },
  { label: 'nav.activity', path: '/activities', icon: 'list' },
  { label: 'nav.workShort', path: '/work', icon: 'camera' },
  { label: 'nav.payments', path: '/payments/outstanding', icon: 'coins' },
  { label: 'nav.ledger', path: '/ledger', icon: 'book' },
];

function isOn(routePath: string, target: string): boolean {
  if (target === '/farmers') return routePath === '/farmers';
  if (target === '/activities') return routePath === '/activities';
  if (target === '/ledger') return routePath === '/ledger';
  return routePath === target || routePath.startsWith(`${target}/`);
}

function sectionOn(routePath: string, entry: NavEntry): boolean {
  return routePath === entry.path || routePath.startsWith(`${entry.path}/`);
}

export function Sidebar({ counts }: { counts: Record<CountKey, number> }) {
  const route = useRoute();
  const t = useT();
  const { user, cooperatives, signOut } = useStore();
  const userBtn = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);

  const coop = cooperatives.find((c) => c.id === user?.cooperativeId);

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__mark">
          <BrandMark />
        </span>
        <span style={{ minWidth: 0 }}>
          <span className="sidebar__name">{t('app.name')}</span>
          <span className="sidebar__coop truncate" style={{ display: 'block' }}>
            {coop ? coop.name : t('app.allCoops')}
          </span>
        </span>
      </div>

      <nav className="sidebar__nav" aria-label="Main">
        {NAV.map((entry) => {
          const open = sectionOn(route.path, entry);
          return (
            <div className="sidebar__group" key={entry.path}>
              <Link to={entry.path} className={`navitem ${isOn(route.path, entry.path) && !entry.children ? 'navitem--on' : ''} ${open && entry.children ? 'navitem--on' : ''}`}>
                <Icon name={entry.icon} size={17} />
                {t(entry.label)}
              </Link>
              {open && entry.children && (
                <div style={{ marginTop: 2 }}>
                  {entry.children.map((child) => {
                    const count = child.countKey ? counts[child.countKey] : 0;
                    return (
                      <Link
                        key={child.path}
                        to={child.path}
                        className={`navitem navitem--sub ${route.path === child.path ? 'navitem--on' : ''}`}
                      >
                        {t(child.label)}
                        {count > 0 && (
                          <span className={`navitem__count ${child.countKey === 'awaitingPayment' ? 'navitem__count--alert' : ''}`}>
                            {count}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="sidebar__foot">
        <button className="userchip" ref={userBtn} onClick={() => setMenu((v) => !v)} aria-expanded={menu}>
          <span className="avatar">{initials(user?.name ?? '')}</span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="userchip__name truncate" style={{ display: 'block' }}>
              {user?.name}
            </span>
            <span className="userchip__role">{user ? t(`role.${user.role}`) : ''}</span>
          </span>
          <Icon name="chevron-down" size={14} />
        </button>
        {menu && (
          <Popover anchorRef={userBtn} onClose={() => setMenu(false)} width={210}>
            <div className="menu">
              <div className="menu__label">{user?.email}</div>
              <button className="menu__item" onClick={() => { setMenu(false); navigate('/settings'); }}>
                <Icon name="settings" size={15} /> {t('nav.settings')}
              </button>
              <button className="menu__item" onClick={() => { setMenu(false); navigate('/settings/audit'); }}>
                <Icon name="shield" size={15} /> Audit trail
              </button>
              <div className="menu__sep" />
              <button className="menu__item menu__item--danger" onClick={signOut}>
                <Icon name="logout" size={15} /> {t('action.signOut')}
              </button>
            </div>
          </Popover>
        )}
      </div>
    </aside>
  );
}

export function TabBar() {
  const route = useRoute();
  const t = useT();
  return (
    <nav className="tabbar" aria-label="Sections">
      <div className="tabbar__inner">
        {TABS.map((tab) => {
          const on =
            isOn(route.path, tab.path) ||
            (tab.path === '/payments/outstanding' && route.path.startsWith('/payments'));
          return (
            <Link key={tab.path} to={tab.path} className={`tabitem ${on ? 'tabitem--on' : ''}`}>
              <Icon name={tab.icon} size={20} />
              {t(tab.label)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function TopBar({
  title,
  onSearch,
  search,
  onOpenNotifications,
}: {
  title: string;
  search: string;
  onSearch: (v: string) => void;
  onOpenNotifications: () => void;
}) {
  const { notifications, online, user, signOut } = useStore();
  const { t, lang, setLang, theme, setTheme, isDark } = usePrefs();
  const unread = notifications.filter((n) => !n.read).length;
  const inputRef = useRef<HTMLInputElement>(null);
  const avatarBtn = useRef<HTMLButtonElement>(null);
  const prefsBtn = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);

  /* Ctrl/Cmd-K focuses search, the shortcut every operator already knows. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <header className="topbar">
      <span className="topbar__title" style={{ display: 'none' }}>
        {title}
      </span>

      <span className="sidebar__mark" style={{ width: 28, height: 28 }} aria-hidden="true">
        <BrandMark size={17} />
      </span>

      <div className="searchbox">
        <span className="searchbox__icon">
          <Icon name="search" size={15} />
        </span>
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={`${t('action.search')}…`}
          aria-label={t('action.search')}
          type="search"
        />
        {!search && (
          <span className="searchbox__kbd">
            <kbd>Ctrl</kbd> <kbd>K</kbd>
          </span>
        )}
      </div>

      <span className="spacer" />

      <span
        className={`offline-pill ${online ? '' : 'offline-pill--off'}`}
        title={
          online
            ? 'Connected. Records are saved on this device first, so nothing is lost if you lose signal.'
            : 'No connection. Everything still works, records are saved on this device.'
        }
      >
        <i />
        {online ? t('misc.online') : t('misc.offline')}
      </span>

      {/* Language and theme are one click from every screen: a shared tablet
          changes hands, and nobody should have to dig into Settings for it. */}
      <button
        className="iconbtn"
        ref={prefsBtn}
        onClick={() => setPrefsOpen((v) => !v)}
        aria-label={`${t('settings.language')} / ${t('settings.theme')}`}
        title={`${t('settings.language')} / ${t('settings.theme')}`}
        aria-expanded={prefsOpen}
      >
        <Icon name={isDark ? 'moon' : 'sun'} size={18} />
      </button>
      {prefsOpen && (
        <Popover anchorRef={prefsBtn} onClose={() => setPrefsOpen(false)} align="right" width={232}>
          <div className="menu">
            <div className="menu__label">{t('settings.language')}</div>
            {LANGUAGES.map((l) => (
              <button
                key={l.value}
                className="menu__item"
                onClick={() => setLang(l.value)}
                aria-pressed={lang === l.value}
              >
                <Icon name={lang === l.value ? 'check' : 'map'} size={15} />
                {l.native}
              </button>
            ))}
            <div className="menu__sep" />
            <div className="menu__label">{t('settings.theme')}</div>
            {(['light', 'dark', 'system'] as const).map((mode) => (
              <button
                key={mode}
                className="menu__item"
                onClick={() => setTheme(mode)}
                aria-pressed={theme === mode}
              >
                <Icon
                  name={theme === mode ? 'check' : mode === 'light' ? 'sun' : mode === 'dark' ? 'moon' : 'settings'}
                  size={15}
                />
                {t(`settings.theme.${mode}`)}
              </button>
            ))}
          </div>
        </Popover>
      )}

      <button className="iconbtn" onClick={onOpenNotifications} aria-label={`${t('misc.notifications')} (${unread})`}>
        <Icon name="bell" size={18} />
        {unread > 0 && <span className="iconbtn__dot">{unread > 9 ? '9+' : unread}</span>}
      </button>

      <button className="iconbtn" ref={avatarBtn} onClick={() => setMenu((v) => !v)} aria-label="Account">
        <span className="avatar" style={{ width: 26, height: 26, fontSize: 10 }}>
          {initials(user?.name ?? '')}
        </span>
      </button>
      {menu && (
        <Popover anchorRef={avatarBtn} onClose={() => setMenu(false)} align="right" width={220}>
          <div className="menu">
            <div className="menu__label">
              {user?.name} · {user ? t(`role.${user.role}`) : ''}
            </div>
            <button className="menu__item" onClick={() => { setMenu(false); navigate('/settings'); }}>
              <Icon name="settings" size={15} /> {t('nav.settings')}
            </button>
            <div className="menu__sep" />
            <button className="menu__item menu__item--danger" onClick={signOut}>
              <Icon name="logout" size={15} /> {t('action.signOut')}
            </button>
          </div>
        </Popover>
      )}
    </header>
  );
}

/* --------------------------------------------------------- notifications */

export function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { notifications, markNotificationsRead } = useStore();
  const t = useT();
  const grouped = useMemo(
    () => ({
      financial: notifications.filter((n) => n.kind === 'financial'),
      rest: notifications.filter((n) => n.kind !== 'financial'),
    }),
    [notifications],
  );

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal--narrow" role="dialog" aria-label="Notifications" style={{ alignSelf: 'flex-start', marginTop: 'var(--s-8)' }}>
        <div className="modal__head">
          <div className="grow">
            <h2 className="modal__title">{t('misc.notifications')}</h2>
            <p className="modal__sub">Money matters are listed first and marked in purple.</p>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {notifications.length === 0 && (
            <p className="muted" style={{ padding: 'var(--s-6)', textAlign: 'center' }}>
              Nothing needs your attention.
            </p>
          )}
          {[...grouped.financial, ...grouped.rest].map((n) => (
            <button
              key={n.id}
              className={`notif ${n.read ? '' : 'notif--unread'}`}
              onClick={() => {
                if (n.link) navigate(n.link.replace('#', ''));
                onClose();
              }}
            >
              <span className={`notif__icon notif__icon--${n.kind}`}>
                <Icon name={n.kind === 'financial' ? 'coins' : n.kind === 'operational' ? 'clipboard' : 'info'} size={16} />
              </span>
              <span className="grow">
                <span className="notif__title" style={{ display: 'block' }}>
                  {n.title}
                </span>
                <span className="notif__body" style={{ display: 'block' }}>
                  {n.body}
                </span>
                <span className="notif__time" style={{ display: 'block' }}>
                  {timeAgo(n.at)}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="modal__foot">
          <button className="btn btn--ghost" onClick={() => void markNotificationsRead()}>
            {t('action.markAllRead')}
          </button>
          <button className="btn btn--secondary" onClick={onClose}>
            {t('action.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
