/**
 * Payments, outstanding balances and payment batches.
 *
 * The rule the whole screen is built around: a payment only touches the ledger
 * at the moment it is actually settled. Everything before that, pending,
 * approved, processing, is a promise, and promises do not move balances.
 */

import { useMemo, useState } from 'react';
import { useLookups, useQuery, useStore } from '../state/store';
import { navigate, useRoute } from '../state/router';
import { DataGrid, type ColumnDef } from '../components/grid/DataGrid';
import { FilterBar, matchesDate, matchesMulti, matchesNumber, type FilterValues } from '../components/Filters';
import { Badge, Button, Callout, EmptyState, Field, Input, Skeleton } from '../components/ui/primitives';
import { Modal } from '../components/ui/Modal';
import { Icon } from '../components/ui/Icon';
import { ProgressPair } from '../components/charts';
import { formatMoney, formatMoneyShort, formatNumber } from '../domain/money';
import { BATCH_STATUS, PAYMENT_METHOD_LABEL, PAYMENT_STATUS } from '../domain/status';
import { formatDate, formatDateShort, formatDateTime, today } from '../lib/date';
import { db } from '../db/db';
import * as paymentService from '../services/paymentService';
import * as farmerService from '../services/farmerService';
import * as activityService from '../services/activityService';
import { ActivityComposer } from '../components/ActivityComposer';
import type { Farmer, Payment, PaymentStatus } from '../domain/types';
import { usePrefs, useT } from '../i18n';

import { tx } from '../i18n/tx';
import { txr } from '../i18n/rich';
export function Payments({ search }: { search: string }) {
  const route = useRoute();
  const sub = route.segments[1] ?? 'outstanding';
  if (sub === 'paid' || sub === 'completed') return <PaidHistory search={search} />;

  if (sub === 'batches') {
    const batchId = route.segments[2];
    return batchId ? <BatchDetail batchId={batchId} /> : <Batches />;
  }
  if (sub === 'pending') return <PaymentList search={search} mode="pending" />;
  return <Owed search={search} />;
}

/* ------------------------------------------------------------ list view */

interface Row extends Payment {
  farmer?: Farmer;
}

function PaymentList({ search, mode }: { search: string; mode: 'pending' | 'completed' }) {
  const { user, can, refresh, toast, fail, confirm } = useStore();
  const lookups = useLookups();
  const { t, tn } = usePrefs();
  const [filters, setFilters] = useState<FilterValues>({});

  const query = useQuery(async () => {
    const [payments, farmers] = await Promise.all([paymentService.list(), db.farmers.toArray()]);
    const byId = new Map(farmers.map((f) => [f.id, f]));
    return payments.map<Row>((p) => ({ ...p, farmer: byId.get(p.farmerId) }));
  });

  const all = query.data ?? [];
  const scoped = useMemo(
    () =>
      mode === 'completed'
        ? all.filter((p) => p.status === 'paid')
        : all.filter((p) => p.status !== 'paid' && p.status !== 'cancelled'),
    [all, mode],
  );

  const rows = useMemo(
    () =>
      scoped.filter(
        (p) =>
          matchesMulti(filters.status, p.status) &&
          matchesMulti(filters.method, p.method) &&
          matchesDate(filters.date, p.date) &&
          matchesNumber(filters.amount, p.amount),
      ),
    [scoped, filters],
  );

  const settle = async (ids: string[], to: PaymentStatus) => {
    if (!user) return;
    const subset = all.filter((p) => ids.includes(p.id));
    const total = subset.reduce((s, p) => s + p.amount, 0);

    const answer = await confirm({
      title:
        to === 'paid'
          ? tn('pay.markPaidTitle', ids.length)
          : tn('pay.approveTitle', ids.length),
      message:
        to === 'paid' ? (
          <>
            <p>
              {t('pay.markPaidBody', {
                amount: formatMoney(total),
                who: tn('pay.manyFarmers', new Set(subset.map((p) => p.farmerId)).size),
              })}
            </p>
            <p className="muted" style={{ marginTop: 'var(--s-2)' }}>
              {t('pay.markPaidNote')}
            </p>
          </>
        ) : (
          <p>{t('pay.approveBody', { amount: formatMoney(total) })}</p>
        ),
      confirmLabel: to === 'paid' ? t('pay.recordPaid') : t('action.approve'),
      tone: to === 'paid' ? 'danger' : 'default',
      // A large sum still deserves a deliberate pause, because recording a
      // payment that never happened is just as wrong as missing one.
      typeToConfirm: to === 'paid' && total > 1_000_000 ? 'PAID' : undefined,
    });
    if (!answer.ok) return;

    try {
      const result = await paymentService.transitionMany(user, ids, to);
      refresh();
      if (result.skipped.length > 0) {
        toast({
          tone: 'warn',
          title: tx('{done} updated, {length} skipped', { done: result.done, length: result.skipped.length }),
          message: result.skipped[0]?.reason,
        });
      } else {
        toast({ tone: 'success', title: to === 'paid' ? `${result.done} payments settled` : `${result.done} payments approved` });
      }
    } catch (e) {
      fail(e);
    }
  };

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        key: 'reference',
        header: tx('Reference'),
        width: 132,
        mobile: 'subtitle',
        sortValue: (r) => r.reference,
        searchValue: (r) => r.reference,
        exportValue: (r) => r.reference,
        render: (r) => <span className="grid__code">{r.reference}</span>,
      },
      {
        key: 'farmer',
        header: tx('Worker'),
        width: 190,
        mobile: 'title',
        sortValue: (r) => r.farmer?.lastName ?? '',
        searchValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''} ${r.farmer?.code ?? ''}`,
        exportValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''}`,
        render: (r) => <span className="truncate grid__link">{r.farmer ? `${r.farmer.firstName} ${r.farmer.lastName}` : '-'}</span>,
      },
      {
        key: 'amount',
        header: tx('Amount'),
        width: 138,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.amount,
        searchValue: (r) => String(r.amount),
        exportValue: (r) => r.amount,
        render: (r) => <span className="num strong">{formatMoney(r.amount)}</span>,
      },
      {
        key: 'status',
        header: tx('Status'),
        width: 132,
        mobile: 'badge',
        sortValue: (r) => r.status,
        searchValue: (r) => PAYMENT_STATUS[r.status].label,
        exportValue: (r) => PAYMENT_STATUS[r.status].label,
        render: (r) => <Badge meta={PAYMENT_STATUS[r.status]} />,
      },
      {
        key: 'method',
        header: tx('Method'),
        width: 128,
        mobile: 'cell',
        sortValue: (r) => r.method,
        searchValue: (r) => PAYMENT_METHOD_LABEL[r.method] ?? r.method,
        exportValue: (r) => PAYMENT_METHOD_LABEL[r.method],
        render: (r) => <span className="truncate">{PAYMENT_METHOD_LABEL[r.method]}</span>,
      },
      {
        key: 'date',
        header: tx('Date'),
        width: 96,
        mobile: 'cell',
        sortValue: (r) => r.date,
        searchValue: (r) => r.date,
        exportValue: (r) => r.date,
        render: (r) => <span className="num">{formatDateShort(r.date)}</span>,
      },
      {
        key: 'reason',
        header: tx('Reason'),
        width: 210,
        sortValue: (r) => r.reason,
        searchValue: (r) => r.reason,
        exportValue: (r) => r.reason,
        render: (r) => <span className="truncate muted">{r.reason}</span>,
      },
      {
        key: 'approved',
        header: tx('Approved by'),
        width: 150,
        optional: true,
        sortValue: (r) => (r.approvedBy ? lookups.userName(r.approvedBy) : ''),
        searchValue: (r) => (r.approvedBy ? lookups.userName(r.approvedBy) : ''),
        exportValue: (r) => (r.approvedBy ? lookups.userName(r.approvedBy) : ''),
        render: (r) => <span className="muted truncate">{r.approvedBy ? lookups.userName(r.approvedBy) : '-'}</span>,
      },
      {
        key: 'paidAt',
        header: tx('Paid at'),
        width: 160,
        optional: true,
        sortValue: (r) => r.paidAt ?? '',
        searchValue: (r) => r.paidAt ?? '',
        exportValue: (r) => (r.paidAt ? formatDateTime(r.paidAt) : ''),
        render: (r) => <span className="muted num">{r.paidAt ? formatDateTime(r.paidAt) : '-'}</span>,
      },
    ],
    [lookups],
  );

  const bulkActions = [];
  if (mode === 'pending' && can('payment.approve')) {
    bulkActions.push({ label: tx('Approve'), icon: 'check' as const, run: (ids: string[]) => void settle(ids, 'approved') });
  }
  if (mode === 'pending' && can('payment.settle')) {
    bulkActions.push({
      label: t('pay.recordPaid'),
      icon: 'coins' as const,
      run: (ids: string[]) => void settle(ids, 'paid'),
    });
  }
  if (can('payment.cancel')) {
    bulkActions.push({
      label: tx('Cancel'),
      icon: 'x' as const,
      tone: 'danger' as const,
      run: async (ids: string[]) => {
        const answer = await confirm({
          title: tx('Cancel {length} payments?', { length: ids.length }),
          message: tx('Cancelled payments stay on record. If a payment was already counted, it is added back to what the worker is owed.'),
          confirmLabel: tx('Cancel payments'),
          tone: 'danger',
          reasonLabel: tx('Reason for cancelling'),
        });
        if (!answer.ok || !user) return;
        try {
          const result = await paymentService.transitionMany(user, ids, 'cancelled', { reason: answer.reason });
          refresh();
          toast({ tone: 'success', title: tx('{done} payments cancelled', { done: result.done }) });
        } catch (e) {
          fail(e);
        }
      },
    });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{mode === 'completed' ? t('pay.completedTitle') : t('pay.pendingTitle')}</h1>
          <p className="page-sub">{mode === 'completed' ? t('pay.completedSub') : t('pay.pendingSub')}</p>
        </div>
      </div>

      <DataGrid
        rows={rows}
        columns={columns}
        rowId={(r) => r.id}
        loading={query.loading}
        search={search}
        storageKey={`payments-${mode}`}
        exportName={`payments-${mode}`}
        onRowClick={(r) => navigate(`/farmers/${r.farmerId}`)}
        onError={fail}
        bulkActions={bulkActions}
        emptyTitle={mode === 'completed' ? tx('No completed payments yet') : tx('Nothing pending')}
        emptyMessage={
          mode === 'completed'
            ? tx('Payments appear here once they are marked as paid.')
            : tx('Every payment has been settled. Workers show up here again when they are owed money.')
        }
        emptyAction={<Button onClick={() => navigate('/payments/outstanding')}>{tx('See who is owed')}</Button>}
        toolbar={
          <FilterBar
            specs={[
              { key: 'status', label: tx('Status'), type: 'multi', options: Object.entries(PAYMENT_STATUS).map(([value, m]) => ({ value, label: m.label })) },
              { key: 'method', label: tx('Method'), type: 'multi', options: Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label })) },
              { key: 'date', label: tx('Date'), type: 'daterange' },
              { key: 'amount', label: tx('Amount'), type: 'numrange' },
            ]}
            values={filters}
            onChange={setFilters}
          />
        }
      />
    </>
  );
}

/* ---------------------------------------------------------- outstanding */

function Owed({ search }: { search: string }) {
  const { user, can, refresh, toast, fail, confirm } = useStore();
  const lookups = useLookups();
  const { t, tn } = usePrefs();
  const [composer, setComposer] = useState<{ open: boolean; farmerId?: string }>({ open: false });
  const [paying, setPaying] = useState<farmerService.FarmerRow | null>(null);

  const query = useQuery(() => farmerService.listWithFinancials());
  const all = (query.data ?? []).filter((f) => f.financials.balance !== 0);
  const owed = all.filter((f) => f.financials.balance > 0);
  // Workers paid more than they earned owe the difference back. They are a
  // separate list, so "Money owed" only ever shows people you still have to pay.
  const inAdvance = all.filter((f) => f.financials.balance < 0);
  const [view, setView] = useState<'owed' | 'advance'>('owed');
  const totalOwed = owed.reduce((s, f) => s + f.financials.balance, 0);

  const columns = useMemo<ColumnDef<farmerService.FarmerRow>[]>(
    () => [
      {
        key: 'farmer',
        header: t('field.farmer'),
        width: 200,
        mobile: 'title',
        sortValue: (r) => r.lastName,
        searchValue: (r) => `${r.firstName} ${r.lastName} ${r.code}`,
        exportValue: (r) => `${r.firstName} ${r.lastName}`,
        render: (r) => (
          <span className="truncate grid__link">
            {r.firstName} {r.lastName}
          </span>
        ),
      },
      {
        key: 'code',
        header: t('field.farmerId'),
        width: 94,
        mobile: 'subtitle',
        sortValue: (r) => r.code,
        searchValue: (r) => r.code,
        exportValue: (r) => r.code,
        render: (r) => <span className="grid__code">{r.code}</span>,
      },
      {
        key: 'phone',
        header: t('field.phone'),
        width: 142,
        optional: true,
        sortValue: (r) => r.phone,
        searchValue: (r) => r.phone,
        exportValue: (r) => r.phone,
        render: (r) => <span className="num truncate">{r.phone}</span>,
      },
      {
        key: 'earned',
        header: t('field.amountEarned'),
        width: 132,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.financials.earned,
        searchValue: (r) => String(r.financials.earned),
        exportValue: (r) => r.financials.earned,
        render: (r) => <span className="num">{formatMoney(r.financials.earned)}</span>,
      },
      {
        key: 'paid',
        header: t('prof.alreadyPaid'),
        width: 132,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.financials.paid,
        searchValue: (r) => String(r.financials.paid),
        exportValue: (r) => r.financials.paid,
        render: (r) => <span className="num">{formatMoney(r.financials.paid)}</span>,
      },
      {
        key: 'advances',
        header: t('field.advances'),
        width: 122,
        align: 'right',
        optional: true,
        sortValue: (r) => r.financials.advances,
        searchValue: (r) => String(r.financials.advances),
        exportValue: (r) => r.financials.advances,
        render: (r) => <span className="num">{formatMoney(r.financials.advances)}</span>,
      },
      {
        key: 'deductions',
        header: t('field.deductions'),
        width: 122,
        align: 'right',
        optional: true,
        sortValue: (r) => r.financials.deductions,
        searchValue: (r) => String(r.financials.deductions),
        exportValue: (r) => r.financials.deductions,
        render: (r) => <span className="num">{formatMoney(r.financials.deductions)}</span>,
      },
      {
        key: 'balance',
        header: view === 'owed' ? t('field.balance') : tx('Advance to recover'),
        width: 148,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => Math.abs(r.financials.balance),
        searchValue: (r) => String(Math.abs(r.financials.balance)),
        exportValue: (r) => Math.abs(r.financials.balance),
        render: (r) => (
          <span className={`num strong ${r.financials.balance > 0 ? 'pos' : ''}`}>{formatMoney(Math.abs(r.financials.balance))}</span>
        ),
      },
      {
        key: 'district',
        header: t('field.district'),
        width: 120,
        sortValue: (r) => r.district,
        searchValue: (r) => r.district,
        exportValue: (r) => r.district,
        render: (r) => <span className="truncate">{r.district}</span>,
      },
      {
        key: 'coop',
        header: t('field.cooperative'),
        width: 200,
        optional: true,
        sortValue: (r) => lookups.coopName(r.cooperativeId),
        searchValue: (r) => lookups.coopName(r.cooperativeId),
        exportValue: (r) => lookups.coopName(r.cooperativeId),
        render: (r) => <span className="truncate">{lookups.coopName(r.cooperativeId)}</span>,
      },
      ...(can('payment.create')
        ? [
            {
              key: 'pay',
              header: tx('Pay'),
              width: 110,
              mobile: 'cell' as const,
              render: (r: farmerService.FarmerRow) =>
                r.financials.balance > 0 ? (
                  <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="primary" icon="coins" onClick={() => setPaying(r)}>
                      {tx('Pay')}
                    </Button>
                  </span>
                ) : null,
            },
          ]
        : []),
    ],
    [lookups, t, can, view],
  );

  const bulkActions = false
    ? [
        {
          label: tx('Create payment batch'),
          icon: 'layers' as const,
          run: async (ids: string[]) => {
            const subset = owed.filter((f) => ids.includes(f.id));
            if (subset.length === 0) {
              toast({ tone: 'warn', title: tx('Nobody selected is owed money') });
              return;
            }
            const total = subset.reduce((s, f) => s + f.financials.balance, 0);
            const answer = await confirm({
              title: tx('Create a payment batch'),
              message: (
                <p>
                  {txr('{farmers}, {amount} in total. Amounts come straight from each ledger balance. Nothing is paid until the batch is approved and settled.', {
                    farmers: <b>{tx('{count} workers', { count: subset.length })}</b>,
                    amount: <b>{formatMoney(total)}</b>,
                  })}
                </p>
              ),
              confirmLabel: tx('Create batch'),
            });
            if (!answer.ok || !user) return;
            try {
              const { batch } = await paymentService.createBatch(user, {
                name: tx('Harvest payment batch, {date}', { date: today() }),
                farmerIds: subset.map((f) => f.id),
              });
              refresh();
              toast({
                tone: 'success',
                title: tx('Batch created'),
                message: tx('{code} · {length} workers', { code: batch.code, length: subset.length }),
                action: { label: tx('Open batch'), run: () => navigate(`/payments/batches/${batch.id}`) },
              });
            } catch (e) {
              fail(e);
            }
          },
        },
      ]
    : [];

  return (
    <>
      <PaymentTabs />
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('pay.outstandingTitle')}</h1>
          <p className="page-sub">{t('pay.outstandingSub')}</p>
        </div>
        <div className="row gap-2">
          <Button variant="primary" icon="coins" onClick={() => setComposer({ open: true })}>
            {t('pay.payAFarmer')}
          </Button>
        </div>
      </div>

      {/* Say plainly what this screen is for, so nobody waits for the app to
          send anything. */}
      <Callout tone="info" icon="info">
        {t('pay.notAPaymentApp')}
      </Callout>

      <div className="metrics" style={{ marginTop: 'var(--s-4)', marginBottom: 'var(--s-4)' }}>
        <div className="metric metric--warn">
          <span className="metric__label">{t('pay.totalOutstanding')}</span>
          <span className="metric__value num">{formatMoneyShort(totalOwed)}</span>
          <span className="metric__foot">{tn('pay.acrossFarmers', owed.length)}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{t('pay.largestBalance')}</span>
          <span className="metric__value num">{formatMoneyShort(Math.max(...owed.map((f) => f.financials.balance), 0))}</span>
          <span className="metric__foot">{t('pay.largestBalanceFoot')}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{t('pay.inAdvanceCount')}</span>
          <span className="metric__value num">{formatNumber(inAdvance.length)}</span>
          <span className="metric__foot">{t('pay.inAdvanceFoot')}</span>
        </div>
      </div>

      <div className="tabs tabs--wrap" role="tablist" style={{ marginBottom: 'var(--s-3)' }}>
        <button role="tab" aria-selected={view === 'owed'} className={`tab ${view === 'owed' ? 'tab--on' : ''}`} onClick={() => setView('owed')}>
          {tx('Still to pay ({count})', { count: owed.length })}
        </button>
        <button role="tab" aria-selected={view === 'advance'} className={`tab ${view === 'advance' ? 'tab--on' : ''}`} onClick={() => setView('advance')}>
          {tx('Paid in advance ({count})', { count: inAdvance.length })}
        </button>
      </div>
      {view === 'advance' && (
        <p className="muted" style={{ fontSize: 'var(--fs-sm)', marginBottom: 'var(--s-3)' }}>
          {tx('These workers were given more than they have earned so far. The amount comes off their next pay by itself.')}
        </p>
      )}

      <DataGrid
        key={view}
        rows={view === 'owed' ? owed : inAdvance}
        columns={columns}
        rowId={(r) => r.id}
        loading={query.loading}
        search={search}
        storageKey="outstanding"
        exportName={view === 'owed' ? 'money-owed' : 'paid-in-advance'}
        onRowClick={(r) => navigate(`/farmers/${r.id}`)}
        onError={fail}
        bulkActions={bulkActions}
        emptyTitle={t('pay.allSettledTitle')}
        emptyMessage={t('pay.allSettledSub')}
      />

      <ActivityComposer
        open={composer.open}
        typeId="farmer_payment"
        farmerId={composer.farmerId}
        onClose={() => setComposer({ open: false })}
      />
      {paying && <PayModal worker={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

/* ------------------------------------------------------------ pay a worker */

/** Pay what a worker is owed in one step: amount (full balance by default) and how. */
function PayModal({ worker, onClose }: { worker: farmerService.FarmerRow; onClose: () => void }) {
  const { user, refresh, toast, fail, confirm } = useStore();
  const [amount, setAmount] = useState(String(worker.financials.balance));
  const [method, setMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const name = `${worker.firstName} ${worker.lastName}`;
  const owedNow = Math.max(worker.financials.balance, 0);
  const extra = Math.max(Math.round(Number(amount) || 0) - owedNow, 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (extra > 0) {
      const answer = await confirm({
        title: tx('Pay more than is owed?'),
        message: tx('{name} is owed {owed}. Paying {amount} is {extra} more. The extra becomes an advance that comes off their next pay.', {
          name,
          owed: formatMoney(owedNow),
          amount: formatMoney(Number(amount)),
          extra: formatMoney(extra),
        }),
        confirmLabel: tx('Pay {amount}', { amount: formatMoney(Number(amount)) }),
      });
      if (!answer.ok) return;
    }
    setBusy(true);
    try {
      await activityService.createActivity(user, {
        typeId: 'farmer_payment',
        farmerId: worker.id,
        data: { amount: Number(amount), method, reason: tx('Payment of what is owed') },
        confirmOverdraft: true,
      });
      refresh();
      toast({ tone: 'success', title: tx('{name} paid', { name }), message: formatMoney(Number(amount)) });
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
      title={tx('Pay {name}', { name })}
      subtitle={tx('Owed now: {amount}', { amount: formatMoney(worker.financials.balance) })}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>{tx('Cancel')}</Button>
          <Button variant="primary" type="submit" form="pay-worker" loading={busy} icon="check">{tx('Record the payment')}</Button>
        </>
      }
    >
      <form id="pay-worker" onSubmit={submit} className="formgrid">
        <Field
          label={tx('Amount paid')}
          required
          help={extra > 0 ? tx('This is {extra} more than is owed. The extra becomes an advance.', { extra: formatMoney(extra) }) : undefined}
        >
          <Input type="number" min="1" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className="input input--money num" />
        </Field>
        <Field label={tx('Payment method')} required>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.keys(PAYMENT_METHOD_LABEL).map((m) => (
              <option key={m} value={m}>{PAYMENT_METHOD_LABEL[m]}</option>
            ))}
          </select>
        </Field>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- paid list */

interface PaidRow {
  id: string;
  date: string;
  farmer?: Farmer;
  amount: number;
  note: string;
  by: string;
}

/** Every payment made, whichever way it was recorded, newest first. */
function PaidHistory({ search }: { search: string }) {
  const { fail } = useStore();
  const lookups = useLookups();
  const query = useQuery(async () => {
    const [txs, farmers] = await Promise.all([db.transactions.toArray(), db.farmers.toArray()]);
    const byId = new Map(farmers.map((f) => [f.id, f]));
    return txs
      .filter((t) => t.type === 'payment' && !t.voided && !t.reversesId)
      .sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1))
      .map<PaidRow>((t) => ({ id: t.id, date: t.date, farmer: byId.get(t.farmerId), amount: t.amount, note: t.description, by: t.createdBy }));
  });
  const rows = query.data ?? [];
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const columns: ColumnDef<PaidRow>[] = [
    { key: 'date', header: tx('Date'), width: 120, mobile: 'subtitle', sortValue: (r) => r.date, exportValue: (r) => r.date, render: (r) => <span className="num">{formatDate(r.date)}</span> },
    {
      key: 'worker', header: tx('Worker'), width: 200, mobile: 'title',
      sortValue: (r) => r.farmer?.lastName ?? '', searchValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''} ${r.farmer?.code ?? ''}`,
      exportValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''}`.trim(),
      render: (r) => <span className="truncate grid__link">{r.farmer ? `${r.farmer.firstName} ${r.farmer.lastName}` : '-'}</span>,
    },
    { key: 'amount', header: tx('Amount'), width: 130, align: 'right', mobile: 'cell', sortValue: (r) => r.amount, exportValue: (r) => r.amount, render: (r) => <span className="num strong">{formatMoney(r.amount)}</span> },
    { key: 'note', header: tx('Description'), width: 320, searchValue: (r) => r.note, exportValue: (r) => r.note, render: (r) => <span className="truncate">{r.note}</span> },
    { key: 'by', header: tx('By'), width: 150, optional: true, exportValue: (r) => lookups.userName(r.by), render: (r) => <span className="truncate">{lookups.userName(r.by)}</span> },
  ];
  return (
    <>
      <PaymentTabs />
      <div className="page-head">
        <div>
          <h1 className="page-title">{tx('Paid')}</h1>
          <p className="page-sub">{tx('Every payment made to a worker, newest first.')}</p>
        </div>
      </div>
      <div className="metrics" style={{ marginBottom: 'var(--s-4)' }}>
        <div className="metric metric--accent">
          <span className="metric__label">{tx('Total paid')}</span>
          <span className="metric__value num">{formatMoneyShort(total)}</span>
          <span className="metric__foot">{tx('RWF in {count} payments', { count: rows.length })}</span>
        </div>
      </div>
      <DataGrid
        rows={rows}
        columns={columns}
        rowId={(r) => r.id}
        loading={query.loading}
        search={search}
        storageKey="paid-history"
        exportName="payments-made"
        onRowClick={(r) => r.farmer && navigate(`/farmers/${r.farmer.id}`)}
        onError={fail}
        emptyTitle={tx('No payments yet')}
        emptyMessage={tx('Payments show up here once a worker has been paid.')}
      />
    </>
  );
}

/** Owed and Paid side by side. */
function PaymentTabs() {
  const route = useRoute();
  const tabs = [
    { path: '/payments/outstanding', label: tx('Owed'), on: route.path === '/payments' || route.path.startsWith('/payments/outstanding') },
    { path: '/payments/paid', label: tx('Paid'), on: route.path.startsWith('/payments/paid') || route.path.startsWith('/payments/completed') },
  ];
  return (
    <div className="tabs tabs--wrap no-print" role="tablist" style={{ marginBottom: 'var(--s-4)' }}>
      {tabs.map((x) => (
        <button key={x.path} role="tab" aria-selected={x.on} className={`tab ${x.on ? 'tab--on' : ''}`} onClick={() => navigate(x.path)}>
          {x.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- batches */

function Batches() {
  const { can, user, refresh, toast, fail } = useStore();
  const t = useT();
  const query = useQuery(() => paymentService.listBatches());
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState(tx('Harvest payment batch, {date}', { date: today() }));
  const [busy, setBusy] = useState(false);

  const batches = query.data ?? [];

  const create = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { batch, payments } = await paymentService.createBatch(user, { name });
      refresh();
      setNewOpen(false);
      toast({ tone: 'success', title: tx('{code} created', { code: batch.code }), message: tx('{length} workers included', { length: payments.length }) });
      navigate(`/payments/batches/${batch.id}`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('pay.batchesTitle')}</h1>
          <p className="page-sub">{t('pay.batchesSub')}</p>
        </div>
        {can('batch.create') && (
          <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>
            {t('pay.newBatch')}
          </Button>
        )}
      </div>

      <Callout tone="info" icon="info">
        {t('pay.exportHint')}
      </Callout>

      <div style={{ height: 'var(--s-4)' }} />

      {query.loading ? (
        <Skeleton height={160} />
      ) : batches.length === 0 ? (
        <EmptyState
          icon="layers"
          title={tx('No payment batches yet')}
          message={tx('A batch collects everyone who is owed money into a single approval and payout.')}
          action={can('batch.create') ? <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>{tx('Create the first batch')}</Button> : undefined}
        />
      ) : (
        <div className="stack gap-3">
          {batches.map((b) => (
            <button key={b.id} className="card" style={{ textAlign: 'left', width: '100%' }} onClick={() => navigate(`/payments/batches/${b.id}`)}>
              <div className="card__head">
                <div>
                  <div className="row gap-2">
                    <span className="grid__code">{b.code}</span>
                    <Badge meta={BATCH_STATUS[b.status]} />
                  </div>
                  <div className="strong" style={{ fontSize: 'var(--fs-lg)', marginTop: 3 }}>
                    {b.name}
                  </div>
                </div>
                <Icon name="chevron-right" size={18} />
              </div>
              <div className="card__body">
                <div className="rowcard__grid" style={{ borderTop: 'none', paddingTop: 0 }}>
                  <div className="rowcard__cell">
                    <span>{tx('Workers')}</span>
                    <b>{formatNumber(b.farmers)}</b>
                  </div>
                  <div className="rowcard__cell">
                    <span>{tx('Total produce')}</span>
                    <b>{formatNumber(Math.round(b.produceQuantity))} KG</b>
                  </div>
                  <div className="rowcard__cell">
                    <span>{tx('Total amount')}</span>
                    <b>{formatMoney(b.total)}</b>
                  </div>
                  <div className="rowcard__cell">
                    <span>{tx('Paid')}</span>
                    <b className="pos">{formatMoney(b.paidAmount)}</b>
                  </div>
                  <div className="rowcard__cell">
                    <span>{tx('Remaining')}</span>
                    <b className={b.remaining > 0 ? 'neg' : ''}>{formatMoney(b.remaining)}</b>
                  </div>
                </div>
                <div style={{ marginTop: 'var(--s-3)' }}>
                  <ProgressPair paid={b.paidAmount} total={b.total} paidLabel={tx('Paid')} remainingLabel={tx('Remaining')} />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title={tx('New payment batch')}
        subtitle={tx('Every worker currently owed money is included automatically.')}
        size="narrow"
        footer={
          <>
            <span className="spacer" />
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              {tx('Cancel')}
            </Button>
            <Button variant="primary" onClick={create} loading={busy} icon="check">
              {tx('Create batch')}
            </Button>
          </>
        }
      >
        <div className="stack gap-4">
          <Field label={tx('Batch name')} required help={tx('Shown on payment records and exports.')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Callout tone="info">
            {tx('Each amount is what the worker is owed when the list is made. Making the list does not pay anyone. It prepares payments to check first.')}
          </Callout>
        </div>
      </Modal>
    </>
  );
}

/* ---------------------------------------------------------- batch detail */

function BatchDetail({ batchId }: { batchId: string }) {
  const { user, can, refresh, toast, fail, confirm } = useStore();
  const { t, tn } = usePrefs();

  const query = useQuery(async () => {
    const [batch, payments, farmers] = await Promise.all([
      paymentService.getBatch(batchId),
      paymentService.list({ batchId }),
      db.farmers.toArray(),
    ]);
    const byId = new Map(farmers.map((f) => [f.id, f]));
    return { batch, payments: payments.map((p) => ({ ...p, farmer: byId.get(p.farmerId) })) };
  }, [batchId]);

  if (query.loading) return <Skeleton height={320} />;
  const batch = query.data?.batch;
  if (!batch) {
    return (
      <EmptyState
        icon="layers"
        title={tx('Batch not found')}
        action={<Button onClick={() => navigate('/payments/batches')}>{tx('Back to batches')}</Button>}
      />
    );
  }

  const payments = query.data?.payments ?? [];
  const unpaid = payments.filter((p) => p.status !== 'paid' && p.status !== 'cancelled');

  const approve = async () => {
    if (!user) return;
    const answer = await confirm({
      title: tx('Approve {code}?', { code: batch.code }),
      message: (
        <p>
          {txr('Approving clears {amount} across {count} workers for payout. Every pending payment in the batch becomes approved. Nothing posts to the ledger yet.', {
            amount: <b>{formatMoney(batch.total)}</b>,
            count: batch.farmers,
          })}
        </p>
      ),
      confirmLabel: tx('Approve batch'),
    });
    if (!answer.ok) return;
    try {
      await paymentService.setBatchStatus(user, batchId, 'approved');
      refresh();
      toast({ tone: 'success', title: tx('{code} approved', { code: batch.code }) });
    } catch (e) {
      fail(e);
    }
  };

  const payout = async () => {
    if (!user) return;
    const answer = await confirm({
      title: t('pay.batchRecordTitle', { code: batch.code }),
      message: (
        <>
          <p>
            {tn('pay.batchRecordBody', unpaid.length, { amount: formatMoney(batch.remaining) })}
          </p>
          <p className="muted" style={{ marginTop: 'var(--s-2)' }}>
            {t('pay.markPaidNote')}
          </p>
        </>
      ),
      confirmLabel: t('pay.recordPaid'),
      tone: 'danger',
      typeToConfirm: batch.remaining > 1_000_000 ? 'PAID' : undefined,
    });
    if (!answer.ok) return;
    try {
      const result = await paymentService.settleBatch(user, batchId);
      refresh();
      toast({
        tone: result.skipped.length ? 'warn' : 'success',
        title: tx('{done} payments settled', { done: result.done }),
        message: result.skipped.length ? tx('{count} could not be paid: {reason}', { count: result.skipped.length, reason: result.skipped[0]?.reason }) : undefined,
      });
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      <button className="btn btn--ghost btn--sm no-print" onClick={() => navigate('/payments/batches')} style={{ marginBottom: 'var(--s-3)' }}>
        <Icon name="arrow-left" size={14} /> {tx('All batches')}
      </button>

      <div className="page-head">
        <div>
          <div className="row gap-2">
            <span className="grid__code">{batch.code}</span>
            <Badge meta={BATCH_STATUS[batch.status]} />
          </div>
          <h1 className="page-title" style={{ marginTop: 3 }}>
            {batch.name}
          </h1>
          <p className="page-sub">
            {tx('Created {date}', { date: formatDate(batch.createdAt.slice(0, 10)) })}
            {batch.approvedAt ? ` · approved ${formatDate(batch.approvedAt.slice(0, 10))}` : ''}
            {batch.notes ? ` · ${batch.notes}` : ''}
          </p>
        </div>
        <div className="row gap-2 no-print">
          <Button icon="printer" onClick={() => window.print()}>
            {tx('Print')}
          </Button>
          {can('batch.approve') && (batch.status === 'draft' || batch.status === 'pending_approval') && (
            <Button variant="primary" icon="check" onClick={approve}>
              {tx('Approve batch')}
            </Button>
          )}
          {can('payment.settle') && (batch.status === 'approved' || batch.status === 'partially_paid') && unpaid.length > 0 && (
            <Button variant="primary" icon="coins" onClick={payout}>
              {tn('pay.recordPaidN', unpaid.length)}
            </Button>
          )}
        </div>
      </div>

      <div className="metrics" style={{ marginBottom: 'var(--s-4)' }}>
        <div className="metric">
          <span className="metric__label">{tx('Workers')}</span>
          <span className="metric__value num">{formatNumber(batch.farmers)}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{tx('Total produce')}</span>
          <span className="metric__value num">{formatNumber(Math.round(batch.produceQuantity))}</span>
          <span className="metric__foot">{tx('KG in this period')}</span>
        </div>
        <div className="metric metric--accent">
          <span className="metric__label">{tx('Total amount')}</span>
          <span className="metric__value num">{formatMoneyShort(batch.total)}</span>
          <span className="metric__foot">{tx('RWF')}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{tx('Paid')}</span>
          <span className="metric__value num">{formatMoneyShort(batch.paidAmount)}</span>
          <span className="metric__foot">{tx('RWF settled')}</span>
        </div>
        <div className="metric metric--warn">
          <span className="metric__label">{tx('Remaining')}</span>
          <span className="metric__value num">{formatMoneyShort(batch.remaining)}</span>
          <span className="metric__foot">{tx('RWF still to pay')}</span>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 'var(--s-4)' }}>
        <div className="card__body">
          <ProgressPair paid={batch.paidAmount} total={batch.total} />
        </div>
      </section>

      <div className="panel">
        <div className="gridtools">
          <span className="eyebrow">{tx('Workers in this batch')}</span>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            {tx('Review every amount before approving')}
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="grid" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th><span className="th">{tx('Worker')}</span></th>
                <th><span className="th">{tx('Worker ID')}</span></th>
                <th><span className="th">{tx('Reference')}</span></th>
                <th className="num"><span className="th">{tx('Amount')}</span></th>
                <th><span className="th">{tx('Method')}</span></th>
                <th><span className="th">{tx('Status')}</span></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className="cell">
                      <a href={`#/farmers/${p.farmerId}`} className="grid__link truncate">
                        {p.farmer ? `${p.farmer.firstName} ${p.farmer.lastName}` : '-'}
                      </a>
                    </span>
                  </td>
                  <td><span className="cell grid__code">{p.farmer?.code}</span></td>
                  <td><span className="cell grid__code">{p.reference}</span></td>
                  <td className="num"><span className="cell num strong">{formatMoney(p.amount)}</span></td>
                  <td><span className="cell">{PAYMENT_METHOD_LABEL[p.method]}</span></td>
                  <td><span className="cell"><Badge meta={PAYMENT_STATUS[p.status]} /></span></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}><span className="cell strong">{tx('Batch total')}</span></td>
                <td className="num"><span className="cell num strong">{formatMoney(batch.total)}</span></td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
