/** Settings: roles and permissions, storage, demo data, and the audit trail. */

import { useState } from 'react';
import { useLookups, useQuery, useStore } from '../state/store';
import { useRoute } from '../state/router';
import { Icon } from '../components/ui/Icon';
import { Badge, Button, Callout, EmptyState, Skeleton } from '../components/ui/primitives';
import { ROLE_ACCESS, ROLES } from '../domain/rbac';
import { formatDateTime, timeAgo } from '../lib/date';
import { db } from '../db/db';
import { clearAccountData, resetDatabase } from '../db/seed';
import * as audit from '../services/audit';
import { initials } from '../components/Shell';
import type { ActivityType } from '../domain/types';
import { usePrefs } from '../i18n';
import { LANGUAGES } from '../i18n/strings';
import * as activityService from '../services/activityService';

import { tx } from '../i18n/tx';
import { txr } from '../i18n/rich';
/* Plain words for the codes stored in the audit trail. */
const AUDIT_ACTION: Record<string, string> = {
  create: 'Created',
  update: 'Changed',
  void: 'Voided',
  approve: 'Approved',
  cancel: 'Cancelled',
  pay: 'Paid',
  import: 'Imported',
  login: 'Signed in',
  delete: 'Deleted',
};
const AUDIT_ENTITY: Record<string, string> = {
  farmer: 'Worker',
  activity: 'Activity',
  harvest: 'Harvest',
  payment: 'Payment',
  batch: 'Payment batch',
  transaction: 'Ledger entry',
  workday: 'Work day',
  group: 'Group',
  setting: 'Setting',
  activityType: 'Activity type',
  user: 'User',
  account: 'Account',
};

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
      title: tx('Remove “{label}”?', { label: type.label }),
      message: tx('It disappears from the + menu. Activities already recorded against it keep their name and stay in every report.'),
      confirmLabel: tx('Remove activity type'),
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
      title: isDemo ? tx('Rebuild the demo cooperative?') : tx('Delete all your data?'),
      message: (
        <>
          <p>
            {isDemo
              ? tx('This deletes every worker, activity, harvest, payment and money record in this account, then makes the demo cooperative again.')
              : tx('This deletes every worker, activity, harvest, payment and money record in this account. Your account and sign-in stay as they are.')}
          </p>
          <p style={{ marginTop: 'var(--s-2)' }} className="muted">
            {tx('There is no undo, and nothing is backed up anywhere else.')}
          </p>
        </>
      ),
      confirmLabel: isDemo ? tx('Rebuild the demo') : tx('Delete everything'),
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
          title: tx('Demo rebuilt'),
          message: tx('{farmers} workers, {transactions} transactions regenerated.', { farmers: result.farmers, transactions: result.transactions }),
        });
      } else {
        await clearAccountData({
          cooperativeName: account.cooperativeName,
          ownerId: account.id,
          ownerName: account.name,
          ownerEmail: account.email,
        });
        refresh();
        toast({ tone: 'success', title: tx('All data deleted'), message: tx('Your account is empty and ready to start again.') });
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
          <p className="page-sub">{tx('Language, appearance, roles, storage and the data on this device.')}</p>
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
                <h2 className="section-title">{tx('Activity types')}</h2>
              </div>
              <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                {tx('Add your own from the + menu')}
              </span>
            </div>
            <div className="card__body">
              {(customTypes.data ?? []).length === 0 ? (
                <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  {txr('Your cooperative has not added any activity types yet. Open the {plus} button and choose {action} to add one that fits how you actually work.', {
                    plus: <b>+</b>,
                    action: <b>{t('action.newActivityType')}</b>,
                  })}
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
                      <button onClick={() => void removeType(type)} aria-label={tx('Remove {label}', { label: type.label })}>
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
              {tx('Every record lives in this device’s database first. The app is fully usable with no signal, recording a harvest in a field with no bars behaves exactly as it does in the office.')}
            </Callout>

            {c && (
              <div className="metrics" style={{ marginTop: 'var(--s-4)' }}>
                <div className="metric">
                  <span className="metric__label">{tx('Workers')}</span>
                  <span className="metric__value metric__value--sm num">{c.farmers}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">{tx('Activities')}</span>
                  <span className="metric__value metric__value--sm num">{c.activities}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">{tx('Harvests')}</span>
                  <span className="metric__value metric__value--sm num">{c.harvests}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">{tx('Payments')}</span>
                  <span className="metric__value metric__value--sm num">{c.payments}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">{tx('Ledger entries')}</span>
                  <span className="metric__value metric__value--sm num">{c.transactions}</span>
                </div>
                <div className="metric">
                  <span className="metric__label">{tx('Audit records')}</span>
                  <span className="metric__value metric__value--sm num">{c.audits}</span>
                </div>
              </div>
            )}

            {storage.data && storage.data.quota > 0 && (
              <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-3)' }}>
                {tx('Using {used} MB of roughly {quota} MB available to this app on this device.', {
                  used: (storage.data.usage / 1024 / 1024).toFixed(1),
                  quota: (storage.data.quota / 1024 / 1024).toFixed(0),
                })}
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
              {tx('Three roles. Each person sees every screen, but only does the work of their role. The app checks this on every save, not just by hiding buttons.')}
            </p>
            <div className="rolegrid">
              {ROLES.map((role) => {
                const holders = users.filter((u) => u.role === role);
                const access = ROLE_ACCESS[role];
                return (
                  <div className="rolecard" key={role}>
                    <div className="row gap-2 wrap">
                      <span className="strong">{t(`role.${role}`)}</span>
                      {user?.role === role && (
                        <span className="badge badge--green">
                          <span className="badge__glyph">●</span>
                          {t('misc.you')}
                        </span>
                      )}
                    </div>
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 'var(--s-1) 0 var(--s-3)' }}>{t(`role.${role}.desc`)}</p>
                    <p className="eyebrow">{tx('Can')}</p>
                    <ul className="rolelist rolelist--can">
                      {access.can.map((x) => (
                        <li key={x}><Icon name="check" size={13} /> {tx(x)}</li>
                      ))}
                    </ul>
                    {access.cannot.length > 0 && (
                      <>
                        <p className="eyebrow" style={{ marginTop: 'var(--s-3)' }}>{tx('Cannot')}</p>
                        <ul className="rolelist rolelist--cannot">
                          {access.cannot.map((x) => (
                            <li key={x}><Icon name="x" size={13} /> {tx(x)}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {holders.length > 0 && (
                      <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-3)' }}>
                        {tx('People: {names}', { names: holders.map((h) => h.name).join(', ') })}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---- reference data ---- */}
        <section className="card">
          <div className="card__head">
            <div className="row gap-2">
              <Icon name="sprout" size={17} />
              <h2 className="section-title">{tx('Crops and cooperatives')}</h2>
            </div>
          </div>
          <div className="card__body">
            <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
              {tx('Crop price list')}
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
              {tx('Cooperatives')}
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
                ? tx('Regenerates the demo cooperative from scratch. Useful when a demonstration has left it in a strange state.')
                : tx('Deletes every record in your account and leaves you with an empty book. Your sign-in is unaffected. This cannot be undone.')}
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
          <h1 className="page-title">{tx('Audit trail')}</h1>
          <p className="page-sub">
            {tx('Every create, edit, approval, payment and void, with the user who did it. This is what makes a disputed balance answerable.')}
          </p>
        </div>
      </div>

      {query.loading ? (
        <Skeleton height={280} />
      ) : rows.length === 0 ? (
        <EmptyState icon="shield" title={tx('Nothing recorded yet')} message={tx('Actions appear here as soon as they happen.')} />
      ) : (
        <div className="panel">
          <div style={{ overflowX: 'auto' }}>
            <table className="grid" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th><span className="th">{tx('When')}</span></th>
                  <th><span className="th">{tx('User')}</span></th>
                  <th><span className="th">{tx('Action')}</span></th>
                  <th><span className="th">{tx('Entity')}</span></th>
                  <th><span className="th">{tx('Summary')}</span></th>
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
                            label: tx(AUDIT_ACTION[e.action] ?? e.action),
                            glyph: e.action === 'void' ? '↺' : e.action === 'pay' ? '₣' : e.action === 'approve' ? '✓' : '•',
                            tone: e.action === 'void' ? 'red' : e.action === 'pay' ? 'purple' : e.action === 'approve' ? 'green' : 'slate',
                          }}
                        />
                      </span>
                    </td>
                    <td>
                      <span className="cell muted">{tx(AUDIT_ENTITY[e.entity] ?? e.entity)}</span>
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
