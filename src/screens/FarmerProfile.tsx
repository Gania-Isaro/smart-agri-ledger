/**
 * Farmer profile.
 *
 * Everything about one farmer, in the order a cooperative officer needs it:
 * where they stand, what they have done, what they delivered, what they were
 * paid, and the ledger that reconciles all of it.
 */

import { useMemo, useState } from 'react';
import { useLookups, useQuery, useStore } from '../state/store';
import { navigate } from '../state/router';
import { Icon } from '../components/ui/Icon';
import { Badge, Button, Callout, EmptyState, Skeleton } from '../components/ui/primitives';
import { ActivityComposer } from '../components/ActivityComposer';
import { LedgerTable } from '../components/LedgerTable';
import { formatMoney, formatNumber } from '../domain/money';
import { ACTIVITY_STATUS, FARMER_STATUS, HARVEST_STATUS, PAYMENT_STATUS, PAYMENT_METHOD_LABEL } from '../domain/status';
import { formatDate, formatDateTime, timeAgo, today } from '../lib/date';
import { db } from '../db/db';
import * as farmerService from '../services/farmerService';
import * as ledgerService from '../services/ledgerService';
import * as harvestService from '../services/harvestService';
import * as paymentService from '../services/paymentService';
import * as activityService from '../services/activityService';
import * as audit from '../services/audit';
import { initials } from '../components/Shell';
import type { IconName } from '../components/ui/Icon';
import { usePrefs } from '../i18n';
import { FarmerFormModal, useRemoveFarmer } from './Farmers';
import * as work from '../services/workforceService';
import type { WorkDay } from '../domain/types';
import { Modal } from '../components/ui/Modal';

import { tx as T, txLang } from '../i18n/tx';
import { FIELD_LABELS_RW } from '../i18n/strings';
import { txr } from '../i18n/rich';
const TABS = ['Overview', 'Activities', 'Harvests', 'Work days', 'Payments', 'Ledger', 'Documents'] as const;
type Tab = (typeof TABS)[number];

const TAB_KEY: Record<Tab, string> = {
  Overview: 'prof.tab.overview',
  Activities: 'prof.tab.activities',
  Harvests: 'prof.tab.harvests',
  'Work days': 'prof.tab.work',
  Payments: 'prof.tab.payments',
  Ledger: 'prof.tab.ledger',
  Documents: 'prof.tab.documents',
};

export function FarmerProfile({ farmerId }: { farmerId: string }) {
  const [editOpen, setEditOpen] = useState(false);
  const removeFarmer = useRemoveFarmer();
  const { can, refresh, toast, fail, confirm, user } = useStore();
  const lookups = useLookups();
  const { t: tr } = usePrefs();
  const [tab, setTab] = useState<Tab>('Overview');
  const [composer, setComposer] = useState(false);

  const query = useQuery(async () => {
    const farmer = await farmerService.get(farmerId);
    if (!farmer) return null;
    const [financials, ledger, activities, harvests, payments, documents, trail, workDays] = await Promise.all([
      ledgerService.financialsFor(farmerId),
      ledgerService.ledgerFor(farmerId),
      activityService.listActivities({ farmerId }),
      harvestService.list({ farmerId }),
      paymentService.list({ farmerId }),
      db.documents.where('farmerId').equals(farmerId).toArray(),
      audit.trailFor('farmer', farmerId),
      work.daysFor(farmerId),
    ]);
    return { farmer, financials, ledger, activities, harvests, payments, documents, trail, workDays };
  }, [farmerId]);

  const d = query.data;

  const totalQuantity = useMemo(
    () => (d?.harvests ?? []).filter((h) => h.status !== 'rejected').reduce((s, h) => s + h.quantity, 0),
    [d?.harvests],
  );

  if (query.loading) {
    return (
      <div className="stack gap-4">
        <Skeleton height={80} />
        <Skeleton height={300} />
      </div>
    );
  }

  if (!d) {
    return (
      <EmptyState
        icon="user"
        title={T('Worker not found')}
        message={T('This worker may have been removed from the register.')}
        action={<Button onClick={() => navigate('/farmers')}>{T('Back to workers')}</Button>}
      />
    );
  }

  const { farmer, financials } = d;
  const name = `${farmer.firstName} ${farmer.lastName}`;

  const deleteFarmer = async () => {
    if ((await removeFarmer(farmer)) === 'deleted') navigate('/farmers');
  };

  const restore = async () => {
    try {
      await farmerService.archive(user!, farmer.id, false);
      refresh();
      toast({ tone: 'success', title: T('{name} restored', { name }) });
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      {editOpen && <FarmerFormModal farmer={farmer} onClose={() => setEditOpen(false)} />}
      {farmer.archived && (
        <Callout tone="warn">
          {T('{name} is archived. They are hidden from lists and cannot get new records until restored.', { name })}
        </Callout>
      )}
      <button className="btn btn--ghost btn--sm no-print" onClick={() => navigate('/farmers')} style={{ marginBottom: 'var(--s-3)' }}>
        <Icon name="arrow-left" size={14} /> {tr('prof.allFarmers')}
      </button>

      <div className="page-head">
        <div className="profilehead">
          <span className="avatar avatar--lg">{initials(`${farmer.firstName} ${farmer.lastName}`)}</span>
          <div>
            <h1 className="page-title">
              {farmer.firstName} {farmer.lastName}
            </h1>
            <p className="page-sub">
              <span className="grid__code">{farmer.code}</span> · {[farmer.village, farmer.district].filter(Boolean).join(', ')} ·{' '}
              {T('{crop} worker', { crop: lookups.cropName(farmer.primaryCropId) })}
            </p>
            <div className="row gap-2 wrap" style={{ marginTop: 'var(--s-2)' }}>
              <Badge meta={FARMER_STATUS[farmer.status]} />
              <span className="chip">
                <Icon name="phone" size={12} />
                {farmer.phone || T('No phone')}
              </span>
              <span className="chip">
                <Icon name="users" size={12} />
                {lookups.coopName(farmer.cooperativeId)}
              </span>
            </div>
          </div>
        </div>

        <div className="row gap-2 wrap no-print">
          {can('farmer.edit') && !farmer.archived && (
            <Button icon="edit" onClick={() => setEditOpen(true)}>
              {T('Edit')}
            </Button>
          )}
          {can('farmer.archive') &&
            (farmer.archived ? (
              <Button icon="undo" onClick={restore}>
                {T('Restore')}
              </Button>
            ) : (
              <Button variant="quiet-danger" icon="trash" onClick={deleteFarmer}>
                {T('Delete')}
              </Button>
            ))}
          <Button icon="printer" onClick={() => window.print()}>
            {tr('action.print')}
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setComposer(true)}>
            {tr('action.recordActivity')}
          </Button>
        </div>
      </div>

      {/* The balance bar is the answer to "what do we owe this person", so it
          sits above the tabs and never moves. */}
      <div className="balancebar" style={{ marginBottom: 'var(--s-4)' }}>
        <div className="balancebar__fig">
          <span>{tr('prof.balanceOwed')}</span>
          <b className={financials.balance > 0 ? 'pos' : financials.balance < 0 ? 'neg' : ''}>
            {formatMoney(financials.balance)}
          </b>
        </div>
        <span className="balancebar__sep" />
        <div className="balancebar__fig">
          <span>{tr('prof.totalEarned')}</span>
          <b>{formatMoney(financials.earned)}</b>
        </div>
        <span className="balancebar__sep" />
        <div className="balancebar__fig">
          <span>{tr('prof.alreadyPaid')}</span>
          <b>{formatMoney(financials.paid)}</b>
        </div>
        <span className="balancebar__sep" />
        <div className="balancebar__fig">
          <span>{tr('prof.advances')}</span>
          <b>{formatMoney(financials.advances)}</b>
        </div>
        <span className="balancebar__sep" />
        <div className="balancebar__fig">
          <span>{tr('prof.deductions')}</span>
          <b>{formatMoney(financials.deductions)}</b>
        </div>
      </div>

      <div className="tabs no-print" role="tablist">
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? 'tab--on' : ''}`} onClick={() => setTab(t)} role="tab" aria-selected={tab === t}>
            {tr(TAB_KEY[t])}
            {t === 'Activities' && d.activities.length > 0 && <span className="muted"> ({d.activities.length})</span>}
            {t === 'Harvests' && d.harvests.length > 0 && <span className="muted"> ({d.harvests.length})</span>}
            {t === 'Payments' && d.payments.length > 0 && <span className="muted"> ({d.payments.length})</span>}
          </button>
        ))}
      </div>

      <div style={{ marginTop: 'var(--s-4)' }}>
        {tab === 'Overview' && (
          <div className="stack gap-4">
            <section className="card">
              <div className="card__head">
                <h2 className="section-title">{tr('prof.farmDetails')}</h2>
              </div>
              <div className="card__body">
                <dl className="deflist">
                  <div>
                    <dt>{tr('field.idNumber')}</dt>
                    <dd>{farmer.idNumber || '-'}</dd>
                  </div>
                  <div>
                    <dt>{T('Farm size')}</dt>
                    <dd>{T('{count} ha', { count: farmer.farmSizeHa })}</dd>
                  </div>
                  <div>
                    <dt>{T('Plots')}</dt>
                    <dd>{farmer.plots}</dd>
                  </div>
                  <div>
                    <dt>{T('Primary crop')}</dt>
                    <dd>{lookups.cropName(farmer.primaryCropId)}</dd>
                  </div>
                  <div>
                    <dt>{T('All crops')}</dt>
                    <dd>{farmer.crops.map((c) => lookups.cropName(c)).join(', ')}</dd>
                  </div>
                  <div>
                    <dt>{T('Season')}</dt>
                    <dd>{farmer.season}</dd>
                  </div>
                  <div>
                    <dt>{T('Registered')}</dt>
                    <dd>{formatDate(farmer.registeredAt)}</dd>
                  </div>
                  <div>
                    <dt>{T('Location')}</dt>
                    <dd>
                      {[farmer.village, farmer.cell, farmer.sector, farmer.district].filter(Boolean).join(', ')}
                    </dd>
                  </div>
                  <div>
                    <dt>{T('Deliveries')}</dt>
                    <dd>
                      {formatNumber(d.harvests.length)} · {formatNumber(totalQuantity)} {d.harvests[0]?.unit ?? 'KG'}
                    </dd>
                  </div>
                </dl>
                {farmer.notes && (
                  <>
                    <div className="divider" />
                    <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                      {farmer.notes}
                    </p>
                  </>
                )}
              </div>
            </section>

            <section className="card">
              <div className="card__head">
                <h2 className="section-title">{tr('prof.recentHistory')}</h2>
                <Button size="sm" variant="ghost" onClick={() => setTab('Activities')} iconRight="chevron-right">
                  {T('All activity')}
                </Button>
              </div>
              <div className="card__body">
                <Timeline activities={d.activities.slice(0, 6)} lookups={lookups} />
              </div>
            </section>

            {d.trail.length > 0 && (
              <section className="card">
                <div className="card__head">
                  <h2 className="section-title">{T('Record changes')}</h2>
                  <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
                    {T('Who changed what on this worker')}
                  </span>
                </div>
                <div className="card__body">
                  <ul className="stack gap-3">
                    {d.trail.slice(0, 8).map((e) => (
                      <li key={e.id} className="row gap-3">
                        <span className="avatar" style={{ width: 24, height: 24, fontSize: 9 }}>
                          {initials(lookups.userName(e.userId))}
                        </span>
                        <span className="grow" style={{ fontSize: 'var(--fs-sm)' }}>
                          {e.summary}
                          <span className="muted" style={{ display: 'block', fontSize: 'var(--fs-xs)' }}>
                            {lookups.userName(e.userId)} · {formatDateTime(e.at)}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}
          </div>
        )}

        {tab === 'Activities' && (
          <section className="card">
            <div className="card__body">
              {d.activities.length === 0 ? (
                <EmptyState
                  icon="list"
                  title={T('No activity recorded yet')}
                  message={T('Use the + button to record what this worker has been doing.')}
                  action={<Button variant="primary" icon="plus" onClick={() => setComposer(true)}>{T('Record activity')}</Button>}
                />
              ) : (
                <Timeline activities={d.activities} lookups={lookups} />
              )}
            </div>
          </section>
        )}

        {tab === 'Harvests' && (
          <section className="panel">
            {d.harvests.length === 0 ? (
              <EmptyState icon="basket" title={T('No deliveries yet')} message={T('This worker has not delivered any produce this season.')} />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="grid" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      {['Date', 'Crop', 'Quantity', 'Price', 'Gross', 'Deductions', 'Net', 'Status'].map((h) => (
                        <th key={h} className={['Quantity', 'Price', 'Gross', 'Deductions', 'Net'].includes(h) ? 'num' : ''}>
                          <span className="th">{h}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {d.harvests.map((h) => (
                      <tr key={h.id}>
                        <td><span className="cell num">{formatDate(h.date)}</span></td>
                        <td><span className="cell">{lookups.cropName(h.cropId)}</span></td>
                        <td className="num"><span className="cell num">{formatNumber(h.quantity)} {h.unit}</span></td>
                        <td className="num"><span className="cell num">{formatMoney(h.pricePerUnit)}</span></td>
                        <td className="num"><span className="cell num">{formatMoney(h.gross)}</span></td>
                        <td className="num"><span className="cell num neg">{h.deductions ? `− ${formatMoney(h.deductions)}` : '-'}</span></td>
                        <td className="num"><span className="cell num strong">{formatMoney(h.net)}</span></td>
                        <td><span className="cell"><Badge meta={HARVEST_STATUS[h.status]} /></span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === 'Payments' && (
          <div className="stack gap-4">
            {financials.balance > 0 && can('payment.create') && (
              <Callout tone="info" icon="coins">
                {txr('{amount} is still owed to this worker. Use {action} to pay it.', {
                  amount: <b>{formatMoney(financials.balance)}</b>,
                  action: <b>{T('Record activity → Worker payment')}</b>,
                })}
              </Callout>
            )}
            <section className="panel">
              {d.payments.length === 0 ? (
                <EmptyState icon="coins" title={T('No payments yet')} message={T('Nothing has been paid to this worker.')} />
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="grid" style={{ width: '100%' }}>
                    <thead>
                      <tr>
                        {[T('Date'), T('Reference'), T('Amount'), T('Method'), T('Reason'), T('Status'), T('Approved by')].map((h) => (
                          <th key={h} className={h === 'Amount' ? 'num' : ''}>
                            <span className="th">{h}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {d.payments.map((p) => (
                        <tr key={p.id}>
                          <td><span className="cell num">{formatDate(p.date)}</span></td>
                          <td><span className="cell grid__code">{p.reference}</span></td>
                          <td className="num"><span className="cell num strong">{formatMoney(p.amount)}</span></td>
                          <td><span className="cell">{PAYMENT_METHOD_LABEL[p.method]}</span></td>
                          <td><span className="cell truncate">{p.reason}</span></td>
                          <td><span className="cell"><Badge meta={PAYMENT_STATUS[p.status]} /></span></td>
                          <td><span className="cell muted">{p.approvedBy ? lookups.userName(p.approvedBy) : '-'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'Ledger' && (
          <LedgerTable
            lines={d.ledger}
            showFarmer={false}
            onVoid={
              can('ledger.void')
                ? async (tx) => {
                    const answer = await confirm({
                      title: T('Void {code}?', { code: tx.code }),
                      message: (
                        <>
                          <p>
                            {txr('This does not delete the entry. It stays on the account marked as voided, with a matching reversal of {amount} next to it. Neither counts toward the balance, so it goes back to what it was before this entry.', {
                              amount: <b>{formatMoney(tx.amount)}</b>,
                            })}
                          </p>
                        </>
                      ),
                      confirmLabel: T('Void and reverse'),
                      tone: 'danger',
                      reasonLabel: T('Reason for voiding'),
                    });
                    if (!answer.ok || !user) return;
                    try {
                      await ledgerService.voidTransaction(user, tx.id, answer.reason ?? '');
                      refresh();
                      toast({ tone: 'success', title: T('{code} voided', { code: tx.code }), message: T('It was cancelled on the worker’s account and no longer counts.') });
                    } catch (e) {
                      fail(e);
                    }
                  }
                : undefined
            }
          />
        )}

        {tab === 'Work days' && <WorkDaysTab days={d.workDays} />}

        {tab === 'Documents' && (
          <section className="card">
            <div className="card__body">
              {d.documents.length === 0 ? (
                <EmptyState
                  icon="file"
                  title={T('No documents yet')}
                  message={T('Photos and documents attached to activities show up here, and stay available offline.')}
                />
              ) : (
                <div className="reportlist">
                  {d.documents.map((doc) => (
                    <a key={doc.id} href={doc.dataUrl} target="_blank" rel="noreferrer" className="reporttile" style={{ textDecoration: 'none', color: 'inherit' }}>
                      {doc.mime.startsWith('image/') ? (
                        <img src={doc.dataUrl} alt="" style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 'var(--r-md)' }} />
                      ) : (
                        <span className="empty__art">
                          <Icon name="file" size={20} />
                        </span>
                      )}
                      <span className="reporttile__name truncate">{doc.name}</span>
                      <span className="reporttile__desc">
                        {(doc.size / 1024).toFixed(0)} KB · {timeAgo(doc.uploadedAt)}
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      <ActivityComposer open={composer} farmerId={farmerId} onClose={() => setComposer(false)} />
    </>
  );
}

/* -------------------------------------------------------------- timeline */

function Timeline({
  activities,
  lookups,
}: {
  activities: import('../domain/types').Activity[];
  lookups: ReturnType<typeof useLookups>;
}) {
  const { t, tActivity } = usePrefs();
  return (
    <div className="timeline">
      {activities.map((a, i) => {
        const type = lookups.type.get(a.typeId);
        const money = a.category === 'financial';
        const entries = Object.entries(a.data).filter(
          ([k, v]) => v !== undefined && v !== '' && !['notes', 'cropId', 'direction'].includes(k),
        );
        return (
          <div className="tl" key={a.id}>
            <div className="tl__rail">
              <span className={`tl__dot ${money ? 'tl__dot--money' : ''}`}>
                <Icon name={(type?.icon as IconName) ?? 'dots'} size={14} />
              </span>
              {i < activities.length - 1 && <span className="tl__line" />}
            </div>
            <div className="tl__body">
              <div className="tl__title">
                {tActivity(a.typeId, type?.label ?? a.typeId)}
                <Badge meta={ACTIVITY_STATUS[a.status]} compact />
                <span className="chip" style={{ height: 20, fontSize: 10 }}>
                  {t(`cat.${a.category}`)}
                </span>
              </div>
              <div className="tl__meta">
                {T('{date} · recorded by {user}', { date: formatDate(a.date), user: lookups.userName(a.createdBy) })}
                {a.cropId ? ` · ${lookups.cropName(a.cropId)}` : ''}
              </div>
              {entries.length > 0 && (
                <div className="tl__data">
                  {entries.slice(0, 5).map(([k, v]) => (
                    <span key={k}>
                      {fieldLabel(k)}: <b>{formatValue(k, v)}</b>
                    </span>
                  ))}
                </div>
              )}
              {a.notes && (
                <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 4 }}>
                  {a.notes}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Label for an activity form field, in the language in use. */
function fieldLabel(key: string): string {
  return txLang() === 'rw' ? FIELD_LABELS_RW[key] ?? T(humanise(key)) : humanise(key);
}

function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(' Ha', ' (ha)')
    .trim();
}

function formatValue(key: string, value: string | number | undefined): string {
  if (value === undefined) return '-';
  if (['amount', 'pricePerUnit', 'grossValue', 'value', 'cost', 'deductions'].includes(key)) {
    return formatMoney(Number(value));
  }
  return String(value);
}

/* -------------------------------------------------------------- work days */

/** Every day this person worked, with the photo taken that day and the pay. */
function WorkDaysTab({ days }: { days: WorkDay[] }) {
  const [open, setOpen] = useState<WorkDay | null>(null);
  const thisWeek = work.weekStart(today());
  const thisMonth = today().slice(0, 7);
  const sum = (list: WorkDay[]) => list.reduce((s, d) => s + d.amount, 0);
  const weekTotal = sum(days.filter((d) => work.weekStart(d.date) === thisWeek));
  const monthTotal = sum(days.filter((d) => d.date.startsWith(thisMonth)));

  if (days.length === 0) {
    return (
      <section className="card">
        <EmptyState icon="camera" title={T('No work days yet')} message={T('Days recorded under Daily work show up here with their photos.')} />
      </section>
    );
  }

  return (
    <div className="stack gap-4">
      <div className="metrics">
        <div className="metric"><span className="metric__label">{T('This week')}</span><span className="metric__value num">{formatMoney(weekTotal)}</span></div>
        <div className="metric"><span className="metric__label">{T('This month')}</span><span className="metric__value num">{formatMoney(monthTotal)}</span></div>
        <div className="metric metric--accent">
          <span className="metric__label">{T('All time')}</span>
          <span className="metric__value num">{formatMoney(sum(days))}</span>
          <span className="metric__foot">{T('{count} work days', { count: days.length })}</span>
        </div>
      </div>
      <section className="card">
        <ul className="worklist">
          {days.map((d) => (
            <li key={d.id} className="worklist__row">
              <button className="workthumb" onClick={() => setOpen(d)} aria-label={T('See photo of {v}', { v: formatDate(d.date) })}>
                <img src={d.photo} alt="" />
              </button>
              <div className="stack" style={{ flex: 1, minWidth: 0 }}>
                <span className="strong">{formatDate(d.date)}</span>
                <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                  {T('Photo taken')}: {formatDateTime(d.photoTakenAt)}{d.notes ? ` · ${d.notes}` : ''}
                </span>
              </div>
              <span className="num strong">{formatMoney(d.amount)}</span>
            </li>
          ))}
        </ul>
      </section>
      {open && (
        <Modal open onClose={() => setOpen(null)} title={formatDate(open.date)} subtitle={formatMoney(open.amount)} dismissOnBackdrop>
          <img src={open.photo} alt="" style={{ width: '100%', borderRadius: 'var(--r-md)' }} />
        </Modal>
      )}
    </div>
  );
}
