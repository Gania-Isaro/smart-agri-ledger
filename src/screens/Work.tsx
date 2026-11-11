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
import { FarmerFormModal, FarmersTabs } from './Farmers';
import type { Farmer, WorkDay } from '../domain/types';

import { translated, tx, txn } from '../i18n/tx';
type Tab = 'record' | 'week' | 'totals';
const TABS: { id: Tab; label: string }[] = translated([
  { id: 'record', label: 'Record a day' },
  { id: 'week', label: 'Week' },
  { id: 'totals', label: 'Totals' },
]);

const WEEKDAY = translated(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);

export function Work() {
  const route = useRoute();
  const tab = (TABS.find((t) => t.id === route.segments[2])?.id ?? 'record') as Tab;
  const totals = useQuery(() => work.totals());
  const t = totals.data;
  const todayView = useQuery(() => work.recordedOn(today()));
  const todayCount = todayView.data?.size ?? 0;
  const todayAmount = [...(todayView.data?.values() ?? [])].reduce((s, d) => s + d.amount, 0);

  return (
    <>
      <FarmersTabs />
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
          <Metric label={tx('This year')} value={formatMoneyShort(t.thisYear)} foot={tx('RWF so far this year')} />
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
            onClick={() => navigate(x.id === 'record' ? '/farmers/work' : `/farmers/work/${x.id}`)}
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

const LAST_WORK_KEY = 'agri.work.last';

/** The job and place typed for the previous person, to start the next form with. */
function lastWork(): { task: string; site: string } {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_WORK_KEY) ?? '{}') as { task?: string; site?: string };
    return { task: v.task ?? '', site: v.site ?? '' };
  } catch {
    return { task: '', site: '' };
  }
}

function RecordTab() {
  const { user, can, toast, fail, refresh, confirm, cooperatives } = useStore();
  const [date, setDate] = useState(today());
  const [search, setSearch] = useState('');
  // The owner sees every group, so can narrow the list to one.
  const [group, setGroup] = useState('');
  const groupName = useMemo(() => new Map(cooperatives.map((c) => [c.id, c.name])), [cooperatives]);
  const manyGroups = cooperatives.length > 1;
  const [recording, setRecording] = useState<Farmer | null>(null);
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<{ day: WorkDay; farmer: Farmer } | null>(null);

  const data = useQuery(async () => {
    const [farmers, recorded, tasks] = await Promise.all([db.farmers.toArray(), work.recordedOn(date), work.workTasks()]);
    return { farmers: farmers.filter((f) => !f.archived), recorded, tasks };
  }, [date]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (data.data?.farmers ?? []).filter(
      (f) => (!group || f.cooperativeId === group) && (!q || `${f.firstName} ${f.lastName} ${f.code} ${f.phone}`.toLowerCase().includes(q)),
    );
    // People already recorded go to the top, so the manager sees the day at a glance.
    return list.sort((a, b) => {
      const ra = data.data?.recorded.has(a.id) ? 0 : 1;
      const rb = data.data?.recorded.has(b.id) ? 0 : 1;
      return ra - rb || work.fullName(a).localeCompare(work.fullName(b));
    });
  }, [data.data, search, group]);

  const recorded = data.data?.recorded;
  // The count and total follow the chosen group.
  const inGroup = new Set((data.data?.farmers ?? []).filter((f) => !group || f.cooperativeId === group).map((f) => f.id));
  const recordedHere = [...(recorded?.values() ?? [])].filter((d) => inGroup.has(d.farmerId));
  const dayTotal = recordedHere.reduce((s, d) => s + d.amount, 0);
  const allowed = can('worker.manage');

  const remove = async (day: WorkDay, farmer: Farmer) => {
    const r = await confirm({
      title: tx('Remove {v} on {date}?', { v: work.fullName(farmer), date: formatDate(day.date) }),
      message: tx('The {amount} is taken back off their account. The reason is kept in the audit trail.', { amount: formatMoney(day.amount) }),
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
            {manyGroups && (
              <Field label={tx('Group')}>
                <select className="input" value={group} onChange={(e) => setGroup(e.target.value)}>
                  <option value="">{tx('All groups')}</option>
                  {cooperatives.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </Field>
            )}
            <Field label={tx('Find a worker')}>
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('Name, ID or phone')} />
            </Field>
            {can('farmer.create') && (
              <Button icon="plus" onClick={() => setAdding(true)}>
                {tx('Add person')}
              </Button>
            )}
            <span className="spacer" />
            <div className="stack">
              <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                {tx('{count} worked on {date}', { count: recordedHere.length, date: formatDate(date) })}
              </span>
              <b className="num" style={{ fontSize: 'var(--fs-lg)' }}>{formatMoney(dayTotal)}</b>
            </div>
          </div>
          {data.data && allowed && <TaskSetting tasks={data.data.tasks} />}
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
            title={search ? tx('No worker matches that search') : tx('No workers yet')}
            message={search ? tx('Try part of the name or the worker ID.') : tx('Register workers first, then record the days they work.')}
            action={!search ? <Button variant="primary" onClick={() => navigate('/farmers')}>{tx('Go to workers')}</Button> : undefined}
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
                      {[f.code, manyGroups ? groupName.get(f.cooperativeId) : '', f.phone].filter(Boolean).join(' · ')}
                    </span>
                    {day && (day.task || day.site) && (
                      <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
                        {[day.task, day.site].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </div>
                  {day ? (
                    <>
                      <span className="badge badge--green"><Icon name="check" size={12} /> {formatMoney(day.amount)}</span>
                      <span className={`badge ${day.paidTxId ? 'badge--purple' : 'badge--orange'}`}>{day.paidTxId ? tx('Paid') : tx('Owed')}</span>
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

      {adding && (
        // A new person registered here is a farmer like any other, then their day is recorded straight away.
        <FarmerFormModal onClose={() => setAdding(false)} onCreated={(f) => setRecording(f)} />
      )}
      {recording && data.data && (
        <RecordModal
          farmer={recording}
          date={date}
          tasks={data.data.tasks}
          onClose={() => setRecording(null)}
        />
      )}
      {viewing && <PhotoModal {...viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

/** The activities and what each pays for a day. Everyone sees them; the owner changes them. */
function TaskSetting({ tasks }: { tasks: work.WorkTask[] }) {
  const { can } = useStore();
  const [editing, setEditing] = useState(false);
  return (
    <>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-3)' }}>
        {tx('Usual pay for a day:')}{' '}
        {tasks.map((t, i) => (
          <span key={t.id}>
            {i > 0 && ' · '}
            {t.name} <b className="num">{formatMoney(t.rate)}</b>
          </span>
        ))}
        {'. '}
        {can('settings.manage') && (
          <button className="linkbtn" onClick={() => setEditing(true)}>{tx('Change')}</button>
        )}
      </p>
      {editing && <TasksModal tasks={tasks} onClose={() => setEditing(false)} />}
    </>
  );
}

function TasksModal({ tasks, onClose }: { tasks: work.WorkTask[]; onClose: () => void }) {
  const { user, toast, fail, refresh } = useStore();
  const [rows, setRows] = useState(tasks.map((t) => ({ id: t.id as string | undefined, name: t.name, rate: String(t.rate) })));
  const [busy, setBusy] = useState(false);
  const change = (i: number, patch: Partial<{ name: string; rate: string }>) => setRows((list) => list.map((row, k) => (k === i ? { ...row, ...patch } : row)));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await work.saveWorkTasks(user!, rows);
      refresh();
      toast({ tone: 'success', title: tx('Activities and pay saved') });
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
      title={tx('Activities and pay')}
      subtitle={tx('Each activity has its own usual pay for a full day. Managers choose the activity when they record a day, and can still type another amount.')}
      footer={
        <>
          <Button icon="plus" onClick={() => setRows((list) => [...list, { id: undefined, name: '', rate: '' }])}>{tx('Add activity')}</Button>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>{tx('Cancel')}</Button>
          <Button variant="primary" type="submit" form="work-tasks-form" loading={busy} icon="check">{tx('Save')}</Button>
        </>
      }
    >
      <form id="work-tasks-form" onSubmit={save} className="stack gap-3">
        {rows.map((row, i) => (
          <div key={row.id ?? `new-${i}`} className="row gap-2" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <Field label={tx('Activity')}>
                <Input value={row.name} onChange={(e) => change(i, { name: e.target.value })} maxLength={40} aria-label={tx('Activity')} />
              </Field>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Field label={tx('Pay for a day')}>
                <MoneyInput value={row.rate} onChange={(e) => change(i, { rate: e.target.value })} aria-label={tx('Pay for a day')} />
              </Field>
            </div>
            <Button
              type="button"
              variant="quiet-danger"
              icon="trash"
              disabled={rows.length <= 1}
              onClick={() => setRows((list) => list.filter((_, k) => k !== i))}
              aria-label={tx('Remove {name}', { name: row.name || tx('Activity') })}
            />
          </div>
        ))}
      </form>
    </Modal>
  );
}

function RecordModal({ farmer, date, tasks, onClose }: { farmer: Farmer; date: string; tasks: work.WorkTask[]; onClose: () => void }) {
  const { user, toast, fail, refresh } = useStore();
  const [photo, setPhoto] = useState<CapturedPhoto | null>(null);
  const last = lastWork();
  // Start on the activity recorded for the previous person: a team mostly does one job a day.
  const [task, setTask] = useState((tasks.find((t) => t.name === last.task) ?? tasks[0]!).name);
  const rate = tasks.find((t) => t.name === task)?.rate ?? tasks[0]!.rate;
  const [amount, setAmount] = useState(String(rate));
  const chooseTask = (name: string) => {
    setTask(name);
    // The pay follows the activity, full day by default.
    setAmount(String(tasks.find((t) => t.name === name)?.rate ?? rate));
  };
  const [notes, setNotes] = useState('');
  const [paidNow, setPaidNow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [site, setSite] = useState(last.site);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!photo) {
      setError(tx('Take a photo of the person before saving.'));
      return;
    }
    setBusy(true);
    try {
      await work.recordDay(user!, { farmerId: farmer.id, date, amount, photo: photo.dataUrl, photoTakenAt: photo.takenAt, task, site, notes, paidNow });
      // A team mostly does the same job in the same place, so the next person starts with these.
      try {
        localStorage.setItem(LAST_WORK_KEY, JSON.stringify({ task: task.trim(), site: site.trim() }));
      } catch {
        /* the next form simply starts empty */
      }
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
          <Button variant="primary" type="submit" form="record-day" loading={busy} icon="check">
            {tx('Save day')}
          </Button>
        </>
      }
    >
      <form id="record-day" onSubmit={submit} className="formgrid">
        <Field label={tx('Photo')} required full error={error ?? undefined}>
          <CameraCapture label={work.fullName(farmer)} value={photo} onChange={(p) => { setPhoto(p); setError(null); }} />
          {!photo && (
            <span className="muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 'var(--s-2)', display: 'block' }}>
              {tx('The day cannot be saved without a photo: it is the proof the person was there. No camera on this computer? Record the day from a phone.')}
            </span>
          )}
        </Field>
        <Field label={tx('What they did')} required full>
          <div className="row gap-2 wrap">
            {tasks.map((t) => (
              <Button key={t.id} type="button" size="sm" variant={task === t.name ? 'primary' : 'secondary'} onClick={() => chooseTask(t.name)}>
                {t.name}
              </Button>
            ))}
          </div>
        </Field>
        <Field label={tx('Pay for this day')} required>
          <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
          <div className="row gap-2 wrap" style={{ marginTop: 'var(--s-2)' }}>
            <Button type="button" size="sm" variant={Number(amount) === rate ? 'primary' : 'secondary'} onClick={() => setAmount(String(rate))}>
              {tx('Full day ({amount})', { amount: formatMoney(rate) })}
            </Button>
            <Button type="button" size="sm" variant={Number(amount) === Math.round(rate / 2) ? 'primary' : 'secondary'} onClick={() => setAmount(String(Math.round(rate / 2)))}>
              {tx('Half day ({amount})', { amount: formatMoney(Math.round(rate / 2)) })}
            </Button>
          </div>
        </Field>
        <Field label={tx('Was the pay given?')} required full>
          <div className="row gap-2 wrap">
            <Button type="button" variant={paidNow ? 'primary' : 'secondary'} icon="check" onClick={() => setPaidNow(true)}>
              {tx('Paid now')}
            </Button>
            <Button type="button" variant={!paidNow ? 'primary' : 'secondary'} icon="clock" onClick={() => setPaidNow(false)}>
              {tx('Owed, pay later')}
            </Button>
          </div>
        </Field>
        <Field label={tx('Where they worked')} help={tx('The site, field or plot.')}>
          <Input value={site} onChange={(e) => setSite(e.target.value)} maxLength={60} />
        </Field>
        <Field label={tx('Note')} help={tx('Optional.')} full>
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
        {day.task && <div><dt>{tx('What they did')}</dt><dd>{day.task}</dd></div>}
        {day.site && <div><dt>{tx('Where they worked')}</dt><dd>{day.site}</dd></div>}
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
      { key: 'code', header: tx('Worker ID'), value: (r) => r.farmer.code },
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
      { key: 'code', header: tx('Worker ID'), value: (r) => r.farmer.code },
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
        <PeriodTable title={tx('By week')} rows={totals.byWeek.slice(0, 12)} label={(k) => tx('Week of {date}', { date: formatDateShort(k) })} onOpen={(k) => navigate(`/farmers/work/week?d=${k}`)} />
        <PeriodTable title={tx('By month')} rows={totals.byMonth} label={(k) => monthLabel(k)} />
        <PeriodTable title={tx('By year')} rows={totals.byYear} label={(k) => k} />
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
