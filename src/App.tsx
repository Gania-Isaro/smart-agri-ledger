/**
 * Application root: route to a screen, and hold the shell around it.
 *
 * Search lives here rather than in each screen so that the one box in the
 * topbar filters whatever is on screen — farmers, activities, harvests,
 * payments or transactions — instead of every screen growing its own.
 */

import { useEffect, useState } from 'react';
import { useRoute } from './state/router';
import { useStore } from './state/store';
import { Sidebar, TabBar, TopBar, NotificationPanel } from './components/Shell';
import { Toaster, ConfirmDialog } from './components/ui/Feedback';
import { ActivityComposer } from './components/ActivityComposer';
import { Icon } from './components/ui/Icon';
import { Login } from './screens/Login';
import { Dashboard } from './screens/Dashboard';
import { Farmers } from './screens/Farmers';
import { FarmerProfile } from './screens/FarmerProfile';
import { Activities } from './screens/Activities';
import { Production } from './screens/Production';
import { Payments } from './screens/Payments';
import { Ledger } from './screens/Ledger';
import { Reports } from './screens/Reports';
import { Settings } from './screens/Settings';
import { EmptyState, Button, Spinner } from './components/ui/primitives';
import { navigate } from './state/router';
import { db } from './db/db';
import { useQuery } from './state/store';
import { useT } from './i18n';

const TITLES: Record<string, string> = {
  overview: 'Overview',
  farmers: 'Farmers',
  activities: 'Activities',
  production: 'Production',
  payments: 'Payments',
  ledger: 'Ledger',
  reports: 'Reports',
  settings: 'Settings',
};

export function App() {
  const { ready, user, isDemo, can } = useStore();
  const t = useT();
  const route = useRoute();
  const [search, setSearch] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);

  /* Clear the search box when moving between screens — a filter left behind
     from another page is how people conclude their data has vanished. */
  useEffect(() => {
    setSearch('');
  }, [route.segments[0], route.segments[1]]);

  /* Default route. */
  useEffect(() => {
    if (ready && user && route.segments.length === 0) navigate('/overview', { replace: true });
  }, [ready, user, route.segments.length]);

  const counts = useQuery(async () => {
    const [payments, harvests, transactions, farmers] = await Promise.all([
      db.payments.toArray(),
      db.harvests.toArray(),
      db.transactions.toArray(),
      db.farmers.toArray(),
    ]);
    const balance = new Map<string, number>();
    for (const t of transactions) {
      if (t.voided) continue;
      balance.set(t.farmerId, (balance.get(t.farmerId) ?? 0) + (t.direction === 'credit' ? t.amount : -t.amount));
    }
    return {
      awaitingPayment: farmers.filter((f) => !f.archived && (balance.get(f.id) ?? 0) > 0).length,
      pendingPayments: payments.filter((p) => p.status === 'pending').length,
      unverified: harvests.filter((h) => h.status === 'recorded').length,
    };
  });

  if (!ready) {
    return (
      <div className="login">
        <div className="stack gap-3" style={{ alignItems: 'center', color: 'var(--primary)' }}>
          <Spinner size={26} />
          <p className="muted">{t('app.loading')}</p>
        </div>
      </div>
    );
  }

  if (!user) return <Login />;

  const section = route.segments[0] ?? 'overview';
  const title = TITLES[section] ?? 'Smart Agri-Ledger';

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <Sidebar counts={counts.data ?? { awaitingPayment: 0, pendingPayments: 0, unverified: 0 }} />

      <div className="app__main">
        <TopBar title={title} search={search} onSearch={setSearch} onOpenNotifications={() => setNotifOpen(true)} />

        <main className="app__content" id="main">
          {/* Nobody should mistake generated figures for their own records. */}
          {isDemo && (
            <div className="callout callout--warn no-print" style={{ marginBottom: 'var(--s-4)' }}>
              <Icon name="eye" size={17} />
              <div>{t('auth.demoBanner')}</div>
            </div>
          )}
          <Screen section={section} route={route} search={search} />
        </main>
      </div>

      <TabBar />

      {can('activity.create') || can('payment.create') || can('ledger.post') ? (
        <button className="fab" onClick={() => setComposerOpen(true)} aria-label={t('action.recordActivity')}>
          <Icon name="plus" size={21} strokeWidth={2.2} />
          <span>{t('action.recordActivity')}</span>
        </button>
      ) : null}

      <ActivityComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
      {notifOpen && <NotificationPanel onClose={() => setNotifOpen(false)} />}
      <Toaster />
      <ConfirmDialog />
    </div>
  );
}

function Screen({
  section,
  route,
  search,
}: {
  section: string;
  route: ReturnType<typeof useRoute>;
  search: string;
}) {
  switch (section) {
    case 'overview':
      return <Dashboard />;

    case 'farmers': {
      const second = route.segments[1];
      // /farmers/active and /farmers/groups are list views; anything else is an id.
      if (second && second !== 'active' && second !== 'groups') return <FarmerProfile farmerId={second} />;
      return <Farmers search={search} />;
    }

    case 'activities':
      return <Activities search={search} />;

    case 'production':
      return <Production search={search} />;

    case 'payments':
      return <Payments search={search} />;

    case 'ledger':
      return <Ledger search={search} />;

    case 'reports':
      return <Reports />;

    case 'settings':
      return <Settings />;

    default:
      return (
        <EmptyState
          icon="map"
          title="That page does not exist"
          message="The link may be out of date."
          action={<Button variant="primary" onClick={() => navigate('/overview')}>Back to overview</Button>}
        />
      );
  }
}
