/** Settings: roles and permissions, storage, demo data, and the audit trail. */

import { useState } from 'react';
import { useLookups, useQuery, useStore } from '../state/store';
import { useRoute } from '../state/router';
import { Icon } from '../components/ui/Icon';
import { Badge, Button, Callout, EmptyState, Skeleton } from '../components/ui/primitives';
import { ROLE_LABELS, ROLE_PERMISSIONS } from '../domain/rbac';
import { formatDateTime, timeAgo } from '../lib/date';
import { db } from '../db/db';
import { clearAccountData, resetDatabase } from '../db/seed';
import * as audit from '../services/audit';
import { initials } from '../components/Shell';
import type { ActivityType, Role } from '../domain/types';
import { usePrefs } from '../i18n';
import { LANGUAGES } from '../i18n/strings';
import * as activityService from '../services/activityService';

export function Settings() {
  const route = useRoute();
  return route.segments[1] === 'audit' ? <AuditTrail /> : <SettingsHome />;
}

function SettingsHome() {
  const { user, account, isDemo, users, cooperatives, crops, online, can, refresh, toast, fail, confirm } = useStore();
  const { t, lang, setLang, theme, setTheme } = usePrefs();
  const [busy, setBusy] = useState(false);

  const customTypes = useQuery(async () => (await activityService.catalog()).filter((x) => x.custom));

  const removeType = async (type: ActivityType) => {
    const answer = await confirm({
      title: `Remove “${type.label}”?`,
      message:
        'It disappears from the + menu. Activities already recorded against it keep their name and stay in every report.',
      confirmLabel: 'Remove activity type',
      tone: 'danger',
    });
    if (!answer.ok || !user) return;
    try {
      await activityService.deleteActivityType(user, type.id);
      refresh();
      toast({ tone: 'success', title: `“${type.label}” removed` });
    } catch (e) {
      fail(e);
    }
  };

  const counts = useQuery(async () => {
    const [farmers, activities, harvests, payments, transactions, documents, audits] = await Promise.all([
      db.farmers.count(),
      db.activities.count(),
      db.harvests.count(),
      db.payments.count(),
      db.transactions.count(),
      db.documents.count(),
      db.audit.count(),
    ]);
    return { farmers, activities, harvests, payments, transactions, documents, audits };
  });

  const storage = useQuery(async () => {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
  });

  const reset = async () => {
    const answer = await confirm({
      title: isDemo ? 'Rebuild the demo cooperative?' : 'Delete all your data?',
      message: (
        <>
          <p>
            This deletes every farmer, activity, harvest, payment and ledger transaction in this account
            {isDemo ? ', then regenerates the demo cooperative.' : '. Your account and sign-in stay as they are.'}
          </p>
          <p style={{ marginTop: 'var(--s-2)' }} className="muted">
            There is no undo, and nothing is backed up anywhere else.
          </p>
        </>
      ),
      confirmLabel: isDemo ? 'Rebuild the demo' : 'Delete everything',
      tone: 'danger',
      typeToConfirm: 'RESET',
    });
    if (!answer.ok || !account) return;
    setBusy(true);
    try {
      if (isDemo) {
        // Only the demo gets generated data back. Reseeding a real
        // cooperative with invented farmers would be worse than useless.
        const result = await resetDatabase();
        refresh();
        toast({
          tone: 'success',
          title: 'Demo rebuilt',
          message: `${result.farmers} farmers, ${result.transactions} transactions regenerated.`,
        });
      } else {
        await clearAccountData({
          cooperativeName: account.cooperativeName,
          ownerId: account.id,
          ownerName: account.name,
          ownerEmail: account.email,
        });
        refresh();
        toast({ tone: 'success', title: 'All data deleted', message: 'Your account is empty and ready to start again.' });
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const c = counts.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('screen.settings.title')}</h1>
          <p className="page-sub">Language, appearance, roles, storage and the data on this device.</p>
        </div>
      </div>

      <div className="stack gap-4">
        {/* ---- language & appearance ---- */}
        <section className="card">
          <div className="card__head">
            <div className="row gap-2">
              <Icon name="globe" size={17} />
              <h2 className="section-title">
                {t('settings.language')} · {t('settings.appearance')}
              </h2>
            </div>
          </div>
          <div className="card__body">
            <div className="formgrid">
              <div className="field">
                <span className="field__label">{t('settings.language')}</span>
                <div className="row gap-2 wrap" style={{ marginTop: 2 }}>
                  {LANGUAGES.map((l) => (
                    <button
                      key={l.value}
                      className={`chip ${lang === l.value ? 'chip--on' : ''}`}
                      onClick={() => setLang(l.value)}
                      aria-pressed={lang === l.value}
                      style={{ height: 34, padding: '0 14px' }}
                    >
                      {lang === l.value && <Icon name="check" size={13} />}
                      {l.native}
                    </button>
                  ))}
                </div>
                <span className="field__help" style={{ marginTop: 6 }}>
                  {t('settings.languageHelp')}
                </span>
              </div>

              <div className="field">
                <span className="field__label">{t('settings.theme')}</span>
                <div className="row gap-2 wrap" style={{ marginTop: 2 }}>
                  {(['light', 'dark', 'system'] as const).map((mode) => (
                    <button
                      key={mode}
                      className={`chip ${theme === mode ? 'chip--on' : ''}`}
                      onClick={() => setTheme(mode)}
                      aria-pressed={theme === mode}
                      style={{ height: 34, padding: '0 14px' }}
                    >
                      <Icon name={mode === 'light' ? 'sun' : mode === 'dark' ? 'moon' : 'settings'} size={13} />
                      {t(`settings.theme.${mode}`)}
                    </button>
                  ))}
                </div>
                <span className="field__help" style={{ marginTop: 6 }}>
                  {t('settings.themeHelp')}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ---- activity types the cooperative added ---- */}
        {can('settings.manage') && (
          <section className="card">
            <div className="card__head">
              <div className="row gap-2">
                <Icon name="list" size={17} />
                <h2 className="section-title">Activity types</h2>
              </div>
              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                Add your own from the + menu
              </span>
            </div>
            <div className="card__body">
              {(customTypes.data ?? []).length === 0 ? (
                <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  Your cooperative has not added any activity types yet. Open the <b>+</b> button and choose{' '}
                  <b>{t('action.newActivityType')}</b> to add one that fits how you actually work.
                </p>
              ) : (
                <div className="row gap-2 wrap">
                  {(customTypes.data ?? []).map((type) => (
                    <span className="chip" key={type.id} style={{ height: 32 }}>
                      <Icon name="list" size={13} />
                      {type.label}
                      <span className="muted" style={{ fontWeight: 500 }}>
                        · {t(`cat.${type.category}`)}
                      </span>
                      <button onClick={() => void removeType(type)} aria-label={`Remove ${type.label}`}>
                        <Icon name="x" size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* ---- storage / offline ---- */}
        <section className="card">
          <div className="card__head">
            <div className="row gap-2">
              <Icon name={online ? 'wifi' : 'wifi-off'} size={17} />
              <h2 className="section-title">{t('settings.storage')}</h2>
            </div>
            <span className={`offline-pill ${online ? '' : 'offline-pill--off'}`}>
              <i />
              {online ? t('misc.online') : t('misc.offline')}
            </span>
          </div>
          <div className="card__body">
            <Callout tone="info" icon="shield">
              Every record lives in this device’s database first. The app is fully usable with no signal, recording a
              harvest in a field with no bars behaves exactly as it does in the office.
            </Callout>

            {c && (
              <div className="metrics" style={{ marginTop: 'var(--s-4)' }}>
                <div className="metric">
                  <span className="metric__label">Farmers</span>
                  <span className="metric__value metric__value--sm num">{c.farmers}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">Activities</span>
                  <span className="metric__value metric__value--sm num">{c.activities}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">Harvests</span>
                  <span className="metric__value metric__value--sm num">{c.harvests}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">Payments</span>
                  <span className="metric__value metric__value--sm num">{c.payments}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">Ledger entries</span>
                  <span className="metric__value metric__value--sm num">{c.transactions}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">Audit records</span>
                  <span className="metric__value metric__value--sm num">{c.audits}</span>
                </div>
              </div>
            )}

            {storage.data && storage.data.quota > 0 && (
              <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-3)' }}>
                Using {(storage.data.usage / 1024 / 1024).toFixed(1)} MB of roughly{' '}
                {(storage.data.quota / 1024 / 1024).toFixed(0)} MB available to this app on this device.
              </p>
            )}
          </div>
        </section>

        {/* ---- roles ---- */}
        <section className="card">
          <div className="card__head">
            <div className="row gap-2">
              <Icon name="lock" size={17} />
              <h2 className="section-title">{t('settings.roles')}</h2>
            </div>
          </div>
          <div className="card__body">
            <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginBottom: 'var(--s-4)' }}>
              The owner and the manager share one account, which holds every permission. Both sign in to the same place
              and see the same figures. The roles below are still enforced in the service layer rather than by hiding
              buttons, so if this cooperative ever wants a separate field officer or accountant login, it is a new
              account rather than a rebuild.
            </p>

            <div style={{ overflowX: 'auto' }}>
              <table className="grid" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th><span className="th">Role</span></th>
                    <th><span className="th">What it can do</span></th>
                    <th className="num"><span className="th">Permissions</span></th>
                    <th><span className="th">Signed-in user</span></th>
                  </tr>
                </thead>
                <tbody>
                  {(Object.keys(ROLE_LABELS) as Role[]).map((role) => {
                    const holders = users.filter((u) => u.role === role);
                    return (
                      <tr key={role}>
                        <td>
                          <span className="cell strong">
                            {t(`role.${role}`)}
                            {user?.role === role && (
                              <span className="badge badge--green" style={{ marginLeft: 6 }}>
                                <span className="badge__glyph">●</span>
                                {t('misc.you')}
                              </span>
                            )}
                          </span>
                        </td>
                        <td>
                          <span className="cell muted" style={{ whiteSpace: 'normal', lineHeight: 1.4, padding: '8px 12px', height: 'auto' }}>
                            {t(`role.${role}.desc`)}
                          </span>
                        </td>
                        <td className="num">
                          <span className="cell num">{ROLE_PERMISSIONS[role].length}</span>
                        </td>
                        <td>
                          <span className="cell muted">{holders.map((h) => h.name).join(', ') || '-'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ---- reference data ---- */}
        <section className="card">
          <div className="card__head">
            <div className="row gap-2">
              <Icon name="sprout" size={17} />
              <h2 className="section-title">Crops and cooperatives</h2>
            </div>
          </div>
          <div className="card__body">
            <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
              Crop price list
            </p>
            <div className="row gap-2 wrap" style={{ marginBottom: 'var(--s-4)' }}>
              {crops.map((c) => (
                <span className="chip" key={c.id}>
                  <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: c.colour }} />
                  {c.name} · {c.defaultPricePerUnit.toLocaleString()} RWF/{c.defaultUnit}
                </span>
              ))}
            </div>

            <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
              Cooperatives
            </p>
            <div className="row gap-2 wrap">
              {cooperatives.map((c) => (
                <span className="chip" key={c.id}>
                  <Icon name="users" size={12} />
                  {c.name} · {c.district}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ---- danger zone ---- */}
        <section className="card" style={{ borderColor: '#EFD4D1' }}>
          <div className="card__head">
            <div className="row gap-2">
              <Icon name="alert" size={17} />
              <h2 className="section-title">{t('settings.resetData')}</h2>
            </div>
          </div>
          <div className="card__body">
            <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginBottom: 'var(--s-3)' }}>
              {isDemo
                ? 'Regenerates the demo cooperative from scratch. Useful when a demonstration has left it in a strange state.'
                : 'Deletes every record in your account and leaves you with an empty book. Your sign-in is unaffected. This cannot be undone.'}
            </p>
            <Button variant="quiet-danger" icon="refresh" onClick={reset} loading={busy}>
              {t('settings.resetData')}
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ audit trail */

function AuditTrail() {
  const lookups = useLookups();
  const query = useQuery(() => audit.recentTrail(300));
  const rows = query.data ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Audit trail</h1>
          <p className="page-sub">
            Every create, edit, approval, payment and void, with the user who did it. This is what makes a disputed
            balance answerable.
          </p>
        </div>
      </div>

      {query.loading ? (
        <Skeleton height={280} />
      ) : rows.length === 0 ? (
        <EmptyState icon="shield" title="Nothing recorded yet" message="Actions appear here as soon as they happen." />
      ) : (
        <div className="panel">
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th><span className="th">When</span></th>
                  <th><span className="th">User</span></th>
                  <th><span className="th">Action</span></th>
                  <th><span className="th">Entity</span></th>
                  <th><span className="th">Summary</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <span className="cell num" title={formatDateTime(e.at)}>
                        {timeAgo(e.at)}
                      </span>
                    </td>
                    <td>
                      <span className="cell">
                        <span className="avatar" style={{ width: 22, height: 22, fontSize: 9 }}>
                          {initials(lookups.userName(e.userId))}
                        </span>
                        <span className="truncate">{lookups.userName(e.userId)}</span>
                      </span>
                    </td>
                    <td>
                      <span className="cell">
                        <Badge
                          meta={{
                            label: e.action,
                            glyph: e.action === 'void' ? '↺' : e.action === 'pay' ? '₣' : e.action === 'approve' ? '✓' : '•',
                            tone: e.action === 'void' ? 'red' : e.action === 'pay' ? 'purple' : e.action === 'approve' ? 'green' : 'slate',
                          }}
                        />
                      </span>
                    </td>
                    <td>
                      <span className="cell muted">{e.entity}</span>
                    </td>
                    <td>
                      <span className="cell truncate" title={e.summary}>
                        {e.summary}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
