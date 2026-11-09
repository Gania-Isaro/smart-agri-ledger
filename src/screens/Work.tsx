/**
 * Daily work register.
 *
 *   Record   the manager picks a day, then for each farmer who came takes a
 *            photo and saves the pay for that day
 *   Week     the owner's view: who worked which day, with every photo, and
 *            what the week costs per person and in total
 *   Totals   money needed this week, this month and overall, per person,
 *            per week and per month
 */

import { useMemo, useState, type FormEvent } from 'react';
import { useLookups, useQuery, useStore } from '../state/store';
import { navigate, useRoute } from '../state/router';
import { Button, Callout, EmptyState, Field, Input, MoneyInput, Skeleton, Textarea } from '../components/ui/primitives';
import { Icon } from '../components/ui/Icon';
import { Modal } from '../components/ui/Modal';
import { CameraCapture, type CapturedPhoto } from '../components/CameraCapture';
import { formatMoney, formatMoneyShort, formatNumber } from '../domain/money';
import { addDays, formatDate, formatDateShort, formatDateTime, monthLabel, today } from '../lib/date';
import { exportCSV } from '../lib/csv';
import { db } from '../db/db';
import * as work from '../services/workforceService';
import type { Farmer, WorkDay } from '../domain/types';

import { translated, tx, txn } from '../i18n/tx';
import { txr } from '../i18n/rich';
type Tab = 'record' | 'week' | 'totals';
const TABS: { id: Tab; label: string }[] = translated([
  { id: 'record', label: 'Record a day' },
  { id: 'week', label: 'Week' },
  { id: 'totals', label: 'Totals' },
]);

const WEEKDAY = translated(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

export function Work() {
  const route = useRoute();
  const tab = (TABS.find((t) => t.id === route.segments[1])?.id ?? 'record') as Tab;
  const totals = useQuery(() => work.totals());
  const t = totals.data;
  const todayView = useQuery(() => work.recordedOn(today()));
  const todayCount = todayView.data?.size ?? 0;
  const todayAmount = [...(todayView.data?.values() ?? [])].reduce((s, d) => s + d.amount, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{tx('Daily work')}</h1>
          <p className="page-sub">{tx('Who worked each day, with a photo taken on the spot, and the money owed for it.')}</p>
        </div>
      </div>

      {!t ? (
        <Skeleton height={86} />
      ) : (
        <div className="metrics">
          <Metric label={tx('Today')} value={formatMoneyShort(todayAmount)} foot={txn(todayCount, '{count} person recorded', '{count} people recorded')} />
          <Metric label={tx('Needed this week')} value={formatMoneyShort(t.thisWeek)} foot={tx('RWF, Monday to Sunday')} accent />
          <Metric label={tx('Needed this month')} value={formatMoneyShort(t.thisMonth)} foot={tx('RWF so far this month')} />
          <Metric label={tx('All time')} value={formatMoneyShort(t.allTime)} foot={tx('RWF over {v} work days', { v: formatNumber(t.daysWorked) })} />
        </div>
      )}

      <div className="tabs" role="tablist" style={{ margin: 'var(--s-4) 0' }}>
        {TABS.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            className={`tab ${tab === x.id ? 'tab--on' : ''}`}
            onClick={() => navigate(x.id === 'record' ? '/work' : `/work/${x.id}`)}
          >
            {x.label}
          </button>
        ))}
      </div>

      {tab === 'record' && <RecordTab />}
      {tab === 'week' && <WeekTab />}
      {tab === 'totals' && <TotalsTab totals={t} />}
    </>
  );
}

/* ---------------------------------------------------------------- record */

function RecordTab() {
  const { user, can, toast, fail, refresh, confirm } = useStore();
  const [date, setDate] = useState(today());
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState<Farmer | null>(null);
  const [viewing, setViewing] = useState<{ day: WorkDay; farmer: Farmer } | null>(null);

  const data = useQuery(async () => {
    const [farmers, recorded, rate] = await Promise.all([db.farmers.toArray(), work.recordedOn(date), work.dailyRate()]);
    return { farmers: farmers.filter((f) => !f.archived), recorded, rate };
  }, [date]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (data.data?.farmers ?? []).filter(
      (f) => !q || `${f.firstName} ${f.lastName} ${f.code} ${f.phone}`.toLowerCase().includes(q),
    );
    // People already recorded go to the top, so the manager sees the day at a glance.
    return list.sort((a, b) => {
      const ra = data.data?.recorded.has(a.id) ? 0 : 1;
      const rb = data.data?.recorded.has(b.id) ? 0 : 1;
      return ra - rb || work.fullName(a).localeCompare(work.fullName(b));
    });
  }, [data.data, search]);

  const recorded = data.data?.recorded;
  const dayTotal = [...(recorded?.values() ?? [])].reduce((s, d) => s + d.amount, 0);
  const allowed = can('worker.manage');

  const remove = async (day: WorkDay, farmer: Farmer) => {
    const r = await confirm({
      title: tx('Remove {v} on {date}?', { v: work.fullName(farmer), date: formatDate(day.date) }),
      message: tx('The {amount} credit is voided on their ledger. The reason is kept in the audit trail.', { amount: formatMoney(day.amount) }),
      confirmLabel: tx('Remove day'),
      tone: 'danger',
      reasonLabel: tx('Why is this day being removed?'),
    });
    if (!r.ok) return;
    try {
      await work.removeDay(user!, day.id, r.reason ?? '');
      refresh();
      toast({ tone: 'success', title: tx('Day removed') });
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      <section className="card">
        <div className="card__body">
          <div className="row gap-3 wrap" style={{ alignItems: 'flex-end' }}>
            <Field label={tx('Day')}>
              <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value || today())} />
            </Field>
            <Field label={tx('Find a farmer')}>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('Name, ID or phone')} />
            </Field>
            <span className="spacer" />
            <div className="stack">
              <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                {tx('{count} worked on {date}', { count: recorded?.size ?? 0, date: formatDate(date) })}
              </span>
              <b className="num" style={{ fontSize: 'var(--fs-lg)' }}>{formatMoney(dayTotal)}</b>
            </div>
          </div>
          {data.data && allowed && <RateSetting rate={data.data.rate} />}
        </div>
      </section>

      {!allowed && (
        <Callout tone="info">
          {tx('Your role can see the register but not record days.')}
        </Callout>
      )}

      <section className="card" style={{ marginTop: 'var(--s-4)' }}>
        {data.loading && !data.data ? (
          <div className="card__body"><Skeleton height={200} /></div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="users"
            title={search ? tx('No farmer matches that search') : tx('No farmers yet')}
            message={search ? tx('Try part of the name or the farmer ID.') : tx('Register farmers first, then record the days they work.')}
            action={!search ? <Button variant="primary" onClick={() => navigate('/farmers')}>{tx('Go to farmers')}</Button> : undefined}
          />
        ) : (
          <ul className="worklist">
            {rows.map((f) => {
              const day = recorded?.get(f.id);
              return (
                <li key={f.id} className={`worklist__row ${day ? 'worklist__row--done' : ''}`}>
                  {day ? (
                    <button className="workthumb" onClick={() => setViewing({ day, farmer: f })} aria-label={tx('See photo of {v}', { v: work.fullName(f) })}>
                      <img src={day.photo} alt="" />
                    </button>
                  ) : (
                    <span className="workthumb workthumb--empty"><Icon name="user" size={18} /></span>
                  )}
                  <div className="stack" style={{ minWidth: 0, flex: 1 }}>
                    <span className="strong">{work.fullName(f)}</span>
                    <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                      {f.code}{f.phone ? ` · ${f.phone}` : ''}
                    </span>
                  </div>
                  {day ? (
                    <>
                      <span className="badge badge--green"><Icon name="check" size={12} /> {formatMoney(day.amount)}</span>
                      {allowed && (
                        <Button size="sm" variant="quiet-danger" icon="trash" onClick={() => remove(day, f)} aria-label={tx('Remove {v} on this day', { v: work.fullName(f) })} />
                      )}
                    </>
                  ) : (
                    allowed && (
                      <Button size="sm" variant="primary" icon="camera" onClick={() => setRecording(f)}>
                        {tx('Record')}
                      </Button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {recording && data.data && (
        <RecordModal
          farmer={recording}
          date={date}
          rate={data.data.rate}
          onClose={() => setRecording(null)}
        />
      )}
      {viewing && <PhotoModal {...viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function RateSetting({ rate }: { rate: number }) {
  const { user, toast, fail, refresh } = useStore();
  const [value, setValue] = useState(String(rate));
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-3)' }}>
        {txr('Usual pay for a day: {amount}.', { amount: <b className="num">{formatMoney(rate)}</b> })}{' '}
        <button className="linkbtn" onClick={() => { setValue(String(rate)); setEditing(true); }}>{tx('Change')}</button>
      </p>
    );
  }
  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await work.setDailyRate(user!, value);
      setEditing(false);
      refresh();
      toast({ tone: 'success', title: tx('Usual daily pay updated') });
    } catch (err) {
      fail(err);
    }
  };
  return (
    <form onSubmit={save} className="row gap-2 wrap" style={{ marginTop: 'var(--s-3)', alignItems: 'flex-end' }}>
      <Field label={tx('Usual pay for a day')} suffix="RWF">
        <MoneyInput value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
      </Field>
      <Button type="submit" variant="primary" size="sm">{tx('Save')}</Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>{tx('Cancel')}</Button>
    </form>
  );
}

function RecordModal({ farmer, date, rate, onClose }: { farmer: Farmer; date: string; rate: number; onClose: () => void }) {
  const { user, toast, fail, refresh } = useStore();
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const [amount, setAmount] = useState(String(rate));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!photo) {
      setError(tx('Take a photo of the person before saving.'));
      return;
    }
    setBusy(true);
    try {
      await work.recordDay(user!, { farmerId: farmer.id, date, amount, photo: photo.dataUrl, photoTakenAt: photo.takenAt, notes });
      refresh();
      toast({ tone: 'success', title: tx('{name} recorded', { name: work.fullName(farmer) }), message: `${formatDate(date)}, ${formatMoney(Number(amount))}` });
      onClose();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={tx('{v} worked on {date}', { v: work.fullName(farmer), date: formatDate(date) })}
      subtitle={tx('Take the photo now, with the person in front of you. The date and time are written on it.')}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>{tx('Cancel')}</Button>
          <Button variant="primary" type="submit" form="record-day" loading={busy} icon="check" disabled={!photo}>
            {tx('Save day')}
          </Button>
        </>
      }
    >
      <form id="record-day" onSubmit={submit} className="formgrid">
        <Field label={tx('Photo')} required full error={error ?? undefined}>
          <CameraCapture label={work.fullName(farmer)} value={photo} onChange={(p) => { setPhoto(p); setError(null); }} />
        </Field>
        <Field label={tx('Pay for this day (change it for a half day)')} required suffix="RWF">
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label={tx('Note')} help={tx('Optional, e.g. the job they did.')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
      </form>
    </Modal>
  );
}

function PhotoModal({ day, farmer, onClose }: { day: WorkDay; farmer: Farmer; onClose: () => void }) {
  const lookups = useLookups();
  return (
    <Modal open onClose={onClose} title={work.fullName(farmer)} subtitle={`${farmer.code} · ${formatDate(day.date)}`} dismissOnBackdrop>
      <img src={day.photo} alt={tx('Photo of {v} on {date}', { v: work.fullName(farmer), date: formatDate(day.date) })} style={{ width: '100%', borderRadius: 'var(--r-md)' }} />
      <dl className="deflist" style={{ marginTop: 'var(--s-3)' }}>
        <div><dt>{tx('Pay')}</dt><dd className="num">{formatMoney(day.amount)}</dd></div>
        <div><dt>{tx('Photo taken')}</dt><dd>{formatDateTime(day.photoTakenAt)}</dd></div>
        <div><dt>{tx('Recorded by')}</dt><dd>{lookups.userName(day.recordedBy)}</dd></div>
        {day.notes && <div><dt>{tx('Note')}</dt><dd>{day.notes}</dd></div>}
      </dl>
    </Modal>
  );
}

/* ------------------------------------------------------------------ week */

function WeekTab() {
  const route = useRoute();
  const [anchor, setAnchor] = useState(route.query.get('d') || today());
  const [viewing, setViewing] = useState<{ day: WorkDay; farmer: Farmer } | null>(null);
  const week = useQuery(() => work.weekView(anchor), [anchor]);
  const w = week.data;
  const isCurrent = w ? w.start === work.weekStart(today()) : true;

  const doExport = () => {
    if (!w) return;
    exportCSV(`work-week-${w.start}.csv`, w.rows, [
      { key: 'code', header: tx('Farmer ID'), value: (r) => r.farmer.code },
      { key: 'name', header: tx('Name'), value: (r) => work.fullName(r.farmer) },
      ...w.dates.map((d, i) => ({ key: d, header: `${WEEKDAY[i]} ${d}`, value: (r: work.WeekRow) => r.days[d]?.amount ?? '' })),
      { key: 'days', header: tx('Days worked'), value: (r) => r.daysWorked },
      { key: 'total', header: tx('Total RWF'), value: (r) => r.total },
    ]);
  };

  return (
    <section className="card">
      <div className="card__head">
        <div className="row gap-2 wrap">
          <Button size="sm" variant="ghost" icon="chevron-left" onClick={() => setAnchor(addDays(w?.start ?? anchor, -7))} aria-label={tx('Previous week')} />
          <h2 className="section-title">
            {w ? tx('{from} to {to}', { from: formatDateShort(w.start), to: formatDate(w.end) }) : tx('Week')}
          </h2>
          <Button size="sm" variant="ghost" icon="chevron-right" disabled={isCurrent} onClick={() => setAnchor(addDays(w?.start ?? anchor, 7))} aria-label={tx('Next week')} />
          {!isCurrent && <Button size="sm" variant="ghost" onClick={() => setAnchor(today())}>{tx('This week')}</Button>}
        </div>
        <span className="spacer" />
        <Button size="sm" icon="download" onClick={doExport} disabled={!w?.rows.length}>{tx('Export')}</Button>
      </div>

      {!w ? (
        <div className="card__body"><Skeleton height={220} /></div>
      ) : w.rows.length === 0 ? (
        <EmptyState icon="calendar" title={tx('Nobody recorded this week')} message={tx('Days recorded under Record a day show up here with their photos.')} />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="grid weekgrid">
            <thead>
              <tr>
                <th><span className="th">{tx('Person')}</span></th>
                {w.dates.map((d, i) => (
                  <th key={d} className={d === today() ? 'weekgrid__today' : ''}>
                    <span className="th">{WEEKDAY[i]} {d.slice(8)}</span>
                  </th>
                ))}
                <th><span className="th">{tx('Days')}</span></th>
                <th><span className="th">{tx('Total')}</span></th>
              </tr>
            </thead>
            <tbody>
              {w.rows.map((r) => (
                <tr key={r.farmer.id}>
                  <td>
                    <button className="linkbtn strong" onClick={() => navigate(`/farmers/${r.farmer.id}`)}>{work.fullName(r.farmer)}</button>
                    <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{r.farmer.code}</div>
                  </td>
                  {w.dates.map((d) => {
                    const day = r.days[d];
                    return (
                      <td key={d} className={d === today() ? 'weekgrid__today' : ''}>
                        {day ? (
                          <button className="workthumb workthumb--sm" onClick={() => setViewing({ day, farmer: r.farmer })} title={tx('{amount}, photo at {date}', { amount: formatMoney(day.amount), date: formatDateTime(day.photoTakenAt) })}>
                            <img src={day.photo} alt={tx('{name} on {date}', { name: work.fullName(r.farmer), date: d })} />
                          </button>
                        ) : (
                          <span className="muted">-</span>
                        )}
                      </td>
                    );
                  })}
                  <td className="num">{r.daysWorked}</td>
                  <td className="num strong">{formatMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><span className="strong">{tx('Total')}</span></td>
                {w.dates.map((d) => (
                  <td key={d} className="num">
                    {w.totalByDate[d] ? (
                      <>
                        <div className="strong">{formatMoneyShort(w.totalByDate[d]!)}</div>
                        <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{w.peopleByDate[d]} ppl</div>
                      </>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                ))}
                <td className="num strong">{w.daysWorked}</td>
                <td className="num strong">{formatMoney(w.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {viewing && <PhotoModal {...viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}

/* ---------------------------------------------------------------- totals */

function TotalsTab({ totals }: { totals: work.WorkTotals | null }) {
  if (!totals) return <Skeleton height={240} />;
  if (totals.daysWorked === 0) {
    return <EmptyState icon="calendar" title={tx('No work days yet')} message={tx('Record who worked under Record a day, and the totals build up here.')} />;
  }

  const exportPeople = () =>
    exportCSV(`work-totals-${today()}.csv`, totals.byPerson, [
      { key: 'code', header: tx('Farmer ID'), value: (r) => r.farmer.code },
      { key: 'name', header: tx('Name'), value: (r) => work.fullName(r.farmer) },
      { key: 'week', header: tx('This week RWF'), value: (r) => r.thisWeek },
      { key: 'month', header: tx('This month RWF'), value: (r) => r.thisMonth },
      { key: 'days', header: tx('Days worked'), value: (r) => r.daysWorked },
      { key: 'total', header: tx('All time RWF'), value: (r) => r.total },
      { key: 'last', header: tx('Last day'), value: (r) => r.lastDate ?? '' },
    ]);

  return (
    <div className="stack gap-4">
      <section className="card">
        <div className="card__head">
          <h2 className="section-title">{tx('Each person')}</h2>
          <span className="spacer" />
          <Button size="sm" icon="download" onClick={exportPeople}>{tx('Export')}</Button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="grid" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th><span className="th">{tx('Person')}</span></th>
                <th><span className="th">{tx('This week')}</span></th>
                <th><span className="th">{tx('This month')}</span></th>
                <th><span className="th">{tx('Days')}</span></th>
                <th><span className="th">{tx('All time')}</span></th>
                <th><span className="th">{tx('Last day')}</span></th>
              </tr>
            </thead>
            <tbody>
              {totals.byPerson.map((p) => (
                <tr key={p.farmer.id}>
                  <td>
                    <button className="linkbtn strong" onClick={() => navigate(`/farmers/${p.farmer.id}`)}>{work.fullName(p.farmer)}</button>
                    <div className="muted" style={{ fontSize: 'var(--fs-xs)' }}>{p.farmer.code}</div>
                  </td>
                  <td className="num">{formatMoney(p.thisWeek)}</td>
                  <td className="num">{formatMoney(p.thisMonth)}</td>
                  <td className="num">{p.daysWorked}</td>
                  <td className="num strong">{formatMoney(p.total)}</td>
                  <td>{p.lastDate ? formatDateShort(p.lastDate) : '-'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td><span className="strong">{tx('Total')}</span></td>
                <td className="num strong">{formatMoney(totals.thisWeek)}</td>
                <td className="num strong">{formatMoney(totals.thisMonth)}</td>
                <td className="num strong">{totals.daysWorked}</td>
                <td className="num strong">{formatMoney(totals.allTime)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <div className="chartgrid">
        <PeriodTable title={tx('By week')} rows={totals.byWeek.slice(0, 12)} label={(k) => tx('Week of {date}', { date: formatDateShort(k) })} onOpen={(k) => navigate(`/work/week?d=${k}`)} />
        <PeriodTable title={tx('By month')} rows={totals.byMonth} label={(k) => monthLabel(k)} />
      </div>
    </div>
  );
}

function PeriodTable({
  title,
  rows,
  label,
  onOpen,
}: {
  title: string;
  rows: work.PeriodTotal[];
  label: (key: string) => string;
  onOpen?: (key: string) => void;
}) {
  return (
    <section className="card">
      <div className="card__head"><h2 className="section-title">{title}</h2></div>
      <table className="grid" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th><span className="th">{tx('Period')}</span></th>
            <th><span className="th">{tx('People')}</span></th>
            <th><span className="th">{tx('Days')}</span></th>
            <th><span className="th">{tx('Money needed')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{onOpen ? <button className="linkbtn" onClick={() => onOpen(r.key)}>{label(r.key)}</button> : label(r.key)}</td>
              <td className="num">{r.people}</td>
              <td className="num">{r.daysWorked}</td>
              <td className="num strong">{formatMoney(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Metric({ label, value, foot, accent }: { label: string; value: string; foot?: string; accent?: boolean }) {
  return (
    <div className={`metric ${accent ? 'metric--accent' : ''}`}>
      <span className="metric__label">{label}</span>
      <span className="metric__value num">{value}</span>
      {foot && <span className="metric__foot">{foot}</span>}
    </div>
  );
}
