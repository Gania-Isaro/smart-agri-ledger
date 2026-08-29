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
import { ActivityComposer } from '../components/ActivityComposer';
import type { Farmer, Payment, PaymentStatus } from '../domain/types';
import { usePrefs, useT } from '../i18n';

export function Payments({ search }: { search: string }) {
  const route = useRoute();
  const sub = route.segments[1] ?? 'pending';

  if (sub === 'batches') {
    const batchId = route.segments[2];
    return batchId ? <BatchDetail batchId={batchId} /> : <Batches />;
  }
  if (sub === 'outstanding') return <Outstanding search={search} />;
  return <PaymentList search={search} mode={sub === 'completed' ? 'completed' : 'pending'} />;
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
          title: `${result.done} updated, ${result.skipped.length} skipped`,
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
        header: 'Reference',
        width: 132,
        mobile: 'subtitle',
        sortValue: (r) => r.reference,
        searchValue: (r) => r.reference,
        exportValue: (r) => r.reference,
        render: (r) => <span className="grid__code">{r.reference}</span>,
      },
      {
        key: 'farmer',
        header: 'Farmer',
        width: 190,
        mobile: 'title',
        sortValue: (r) => r.farmer?.lastName ?? '',
        searchValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''} ${r.farmer?.code ?? ''}`,
        exportValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''}`,
        render: (r) => <span className="truncate grid__link">{r.farmer ? `${r.farmer.firstName} ${r.farmer.lastName}` : '-'}</span>,
      },
      {
        key: 'amount',
        header: 'Amount',
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
        header: 'Status',
        width: 132,
        mobile: 'badge',
        sortValue: (r) => r.status,
        searchValue: (r) => PAYMENT_STATUS[r.status].label,
        exportValue: (r) => PAYMENT_STATUS[r.status].label,
        render: (r) => <Badge meta={PAYMENT_STATUS[r.status]} />,
      },
      {
        key: 'method',
        header: 'Method',
        width: 128,
        mobile: 'cell',
        sortValue: (r) => r.method,
        searchValue: (r) => PAYMENT_METHOD_LABEL[r.method] ?? r.method,
        exportValue: (r) => PAYMENT_METHOD_LABEL[r.method],
        render: (r) => <span className="truncate">{PAYMENT_METHOD_LABEL[r.method]}</span>,
      },
      {
        key: 'date',
        header: 'Date',
        width: 96,
        mobile: 'cell',
        sortValue: (r) => r.date,
        searchValue: (r) => r.date,
        exportValue: (r) => r.date,
        render: (r) => <span className="num">{formatDateShort(r.date)}</span>,
      },
      {
        key: 'reason',
        header: 'Reason',
        width: 210,
        sortValue: (r) => r.reason,
        searchValue: (r) => r.reason,
        exportValue: (r) => r.reason,
        render: (r) => <span className="truncate muted">{r.reason}</span>,
      },
      {
        key: 'approved',
        header: 'Approved by',
        width: 150,
        optional: true,
        sortValue: (r) => (r.approvedBy ? lookups.userName(r.approvedBy) : ''),
        searchValue: (r) => (r.approvedBy ? lookups.userName(r.approvedBy) : ''),
        exportValue: (r) => (r.approvedBy ? lookups.userName(r.approvedBy) : ''),
        render: (r) => <span className="muted truncate">{r.approvedBy ? lookups.userName(r.approvedBy) : '-'}</span>,
      },
      {
        key: 'paidAt',
        header: 'Paid at',
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
    bulkActions.push({ label: 'Approve', icon: 'check' as const, run: (ids: string[]) => void settle(ids, 'approved') });
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
      label: 'Cancel',
      icon: 'x' as const,
      tone: 'danger' as const,
      run: async (ids: string[]) => {
        const answer = await confirm({
          title: `Cancel ${ids.length} payments?`,
          message: 'Cancelled payments stay on record. Any that had already posted to the ledger are reversed with a balancing entry.',
          confirmLabel: 'Cancel payments',
          tone: 'danger',
          reasonLabel: 'Reason for cancelling',
        });
        if (!answer.ok || !user) return;
        try {
          const result = await paymentService.transitionMany(user, ids, 'cancelled', { reason: answer.reason });
          refresh();
          toast({ tone: 'success', title: `${result.done} payments cancelled` });
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
        emptyTitle={mode === 'completed' ? 'No completed payments yet' : 'Nothing pending'}
        emptyMessage={
          mode === 'completed'
            ? 'Payments appear here once they are marked as paid.'
            : 'Every payment has been settled. Build a new batch from the outstanding list when produce comes in.'
        }
        emptyAction={<Button onClick={() => navigate('/payments/outstanding')}>See outstanding balances</Button>}
        toolbar={
          <FilterBar
            specs={[
              { key: 'status', label: 'Status', type: 'multi', options: Object.entries(PAYMENT_STATUS).map(([value, m]) => ({ value, label: m.label })) },
              { key: 'method', label: 'Method', type: 'multi', options: Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({ value, label })) },
              { key: 'date', label: 'Date', type: 'daterange' },
              { key: 'amount', label: 'Amount', type: 'numrange' },
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

function Outstanding({ search }: { search: string }) {
  const { user, can, refresh, toast, fail, confirm } = useStore();
  const lookups = useLookups();
  const { t, tn } = usePrefs();
  const [composer, setComposer] = useState<{ open: boolean; farmerId?: string }>({ open: false });

  const query = useQuery(() => farmerService.listWithFinancials());
  const all = (query.data ?? []).filter((f) => f.financials.balance !== 0);
  const owed = all.filter((f) => f.financials.balance > 0);
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
        header: t('field.balance'),
        width: 148,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.financials.balance,
        searchValue: (r) => String(r.financials.balance),
        exportValue: (r) => r.financials.balance,
        render: (r) => (
          <span className={`num strong ${r.financials.balance > 0 ? 'pos' : 'neg'}`}>{formatMoney(r.financials.balance)}</span>
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
    ],
    [lookups, t],
  );

  const bulkActions = can('batch.create')
    ? [
        {
          label: 'Create payment batch',
          icon: 'layers' as const,
          run: async (ids: string[]) => {
            const subset = owed.filter((f) => ids.includes(f.id));
            if (subset.length === 0) {
              toast({ tone: 'warn', title: 'Nobody selected is owed money' });
              return;
            }
            const total = subset.reduce((s, f) => s + f.financials.balance, 0);
            const answer = await confirm({
              title: 'Create a payment batch',
              message: (
                <p>
                  <b>{subset.length} farmers</b>, <b>{formatMoney(total)}</b> in total. Amounts come straight from each
                  ledger balance. Nothing is paid until the batch is approved and settled.
                </p>
              ),
              confirmLabel: 'Create batch',
            });
            if (!answer.ok || !user) return;
            try {
              const { batch } = await paymentService.createBatch(user, {
                name: `Harvest payment batch, ${today()}`,
                farmerIds: subset.map((f) => f.id),
              });
              refresh();
              toast({
                tone: 'success',
                title: 'Batch created',
                message: `${batch.code} · ${subset.length} farmers`,
                action: { label: 'Open batch', run: () => navigate(`/payments/batches/${batch.id}`) },
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
          <span className="metric__value num">{formatNumber(all.filter((f) => f.financials.balance < 0).length)}</span>
          <span className="metric__foot">{t('pay.inAdvanceFoot')}</span>
        </div>
      </div>

      <DataGrid
        rows={all}
        columns={columns}
        rowId={(r) => r.id}
        loading={query.loading}
        search={search}
        storageKey="outstanding"
        exportName="outstanding-balances"
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
    </>
  );
}

/* --------------------------------------------------------------- batches */

function Batches() {
  const { can, user, refresh, toast, fail } = useStore();
  const t = useT();
  const query = useQuery(() => paymentService.listBatches());
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState(`Harvest payment batch, ${today()}`);
  const [busy, setBusy] = useState(false);

  const batches = query.data ?? [];

  const create = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const { batch, payments } = await paymentService.createBatch(user, { name });
      refresh();
      setNewOpen(false);
      toast({ tone: 'success', title: `${batch.code} created`, message: `${payments.length} farmers included` });
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
          title="No payment batches yet"
          message="A batch collects everyone who is owed money into a single approval and payout."
          action={can('batch.create') ? <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>Create the first batch</Button> : undefined}
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
                    <span>Farmers</span>
                    <b>{formatNumber(b.farmers)}</b>
                  </div>
                  <div className="rowcard__cell">
                    <span>Total produce</span>
                    <b>{formatNumber(Math.round(b.produceQuantity))} KG</b>
                  </div>
                  <div className="rowcard__cell">
                    <span>Total amount</span>
                    <b>{formatMoney(b.total)}</b>
                  </div>
                  <div className="rowcard__cell">
                    <span>Paid</span>
                    <b className="pos">{formatMoney(b.paidAmount)}</b>
                  </div>
                  <div className="rowcard__cell">
                    <span>Remaining</span>
                    <b className={b.remaining > 0 ? 'neg' : ''}>{formatMoney(b.remaining)}</b>
                  </div>
                </div>
                <div style={{ marginTop: 'var(--s-3)' }}>
                  <ProgressPair paid={b.paidAmount} total={b.total} paidLabel="Paid" remainingLabel="Remaining" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New payment batch"
        subtitle="Every farmer currently owed money is included automatically."
        size="narrow"
        footer={
          <>
            <span className="spacer" />
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={create} loading={busy} icon="check">
              Create batch
            </Button>
          </>
        }
      >
        <div className="stack gap-4">
          <Field label="Batch name" required help="Shown on payment records and exports.">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Callout tone="info">
            Amounts are taken from each farmer’s ledger balance at the moment the batch is created. Creating a batch does
            not pay anyone. It creates pending payments for review.
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
        title="Batch not found"
        action={<Button onClick={() => navigate('/payments/batches')}>Back to batches</Button>}
      />
    );
  }

  const payments = query.data?.payments ?? [];
  const unpaid = payments.filter((p) => p.status !== 'paid' && p.status !== 'cancelled');

  const approve = async () => {
    if (!user) return;
    const answer = await confirm({
      title: `Approve ${batch.code}?`,
      message: (
        <p>
          Approving clears <b>{formatMoney(batch.total)}</b> across {batch.farmers} farmers for payout. Every pending
          payment in the batch becomes approved. Nothing posts to the ledger yet.
        </p>
      ),
      confirmLabel: 'Approve batch',
    });
    if (!answer.ok) return;
    try {
      await paymentService.setBatchStatus(user, batchId, 'approved');
      refresh();
      toast({ tone: 'success', title: `${batch.code} approved` });
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
        title: `${result.done} payments settled`,
        message: result.skipped.length ? `${result.skipped.length} could not be paid: ${result.skipped[0]?.reason}` : undefined,
      });
    } catch (e) {
      fail(e);
    }
  };

  return (
    <>
      <button className="btn btn--ghost btn--sm no-print" onClick={() => navigate('/payments/batches')} style={{ marginBottom: 'var(--s-3)' }}>
        <Icon name="arrow-left" size={14} /> All batches
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
            Created {formatDate(batch.createdAt.slice(0, 10))}
            {batch.approvedAt ? ` · approved ${formatDate(batch.approvedAt.slice(0, 10))}` : ''}
            {batch.notes ? ` · ${batch.notes}` : ''}
          </p>
        </div>
        <div className="row gap-2 no-print">
          <Button icon="printer" onClick={() => window.print()}>
            Print
          </Button>
          {can('batch.approve') && (batch.status === 'draft' || batch.status === 'pending_approval') && (
            <Button variant="primary" icon="check" onClick={approve}>
              Approve batch
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
          <span className="metric__label">Farmers</span>
          <span className="metric__value num">{formatNumber(batch.farmers)}</span>
        </div>
        <div className="metric">
          <span className="metric__label">Total produce</span>
          <span className="metric__value num">{formatNumber(Math.round(batch.produceQuantity))}</span>
          <span className="metric__foot">KG in this period</span>
        </div>
        <div className="metric metric--accent">
          <span className="metric__label">Total amount</span>
          <span className="metric__value num">{formatMoneyShort(batch.total)}</span>
          <span className="metric__foot">RWF</span>
        </div>
        <div className="metric">
          <span className="metric__label">Paid</span>
          <span className="metric__value num">{formatMoneyShort(batch.paidAmount)}</span>
          <span className="metric__foot">RWF settled</span>
        </div>
        <div className="metric metric--warn">
          <span className="metric__label">Remaining</span>
          <span className="metric__value num">{formatMoneyShort(batch.remaining)}</span>
          <span className="metric__foot">RWF still to pay</span>
        </div>
      </div>

      <section className="card" style={{ marginBottom: 'var(--s-4)' }}>
        <div className="card__body">
          <ProgressPair paid={batch.paidAmount} total={batch.total} />
        </div>
      </section>

      <div className="panel">
        <div className="gridtools">
          <span className="eyebrow">Farmers in this batch</span>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            Review every amount before approving
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="grid" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th><span className="th">Farmer</span></th>
                <th><span className="th">Farmer ID</span></th>
                <th><span className="th">Reference</span></th>
                <th className="num"><span className="th">Amount</span></th>
                <th><span className="th">Method</span></th>
                <th><span className="th">Status</span></th>
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
                <td colSpan={3}><span className="cell strong">Batch total</span></td>
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
