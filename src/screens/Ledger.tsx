/** Farmer ledgers, the full transaction journal, and adjustments. */

import { useMemo, useState } from 'react';
import { useLookups, useQuery, useStore } from '../state/store';
import { navigate, useRoute } from '../state/router';
import { DataGrid, type ColumnDef } from '../components/grid/DataGrid';
import { FilterBar, matchesDate, matchesMulti, matchesNumber, type FilterValues } from '../components/Filters';
import { Badge, Button, Callout, EmptyState, Skeleton } from '../components/ui/primitives';
import { Icon } from '../components/ui/Icon';
import { LedgerTable } from '../components/LedgerTable';
import { ActivityComposer } from '../components/ActivityComposer';
import { formatMoney, formatMoneyShort, formatNumber } from '../domain/money';
import { LEDGER_TYPE_LABEL } from '../domain/status';
import { counts, withRunningBalance } from '../domain/ledger';
import { formatDateShort, formatDateTime } from '../lib/date';
import { db } from '../db/db';
import * as ledgerService from '../services/ledgerService';
import * as farmerService from '../services/farmerService';
import * as audit from '../services/audit';
import type { Farmer, LedgerTransaction } from '../domain/types';
import { useT } from '../i18n';

import { tx as T } from '../i18n/tx';
export function Ledger({ search }: { search: string }) {
  const route = useRoute();
  const sub = route.segments[1];

  if (sub === 'transactions') return <Transactions search={search} />;
  if (sub === 'adjustments') return <Adjustments />;
  return <FarmerLedgers search={search} />;
}

/* -------------------------------------------------------- farmer ledgers */

function FarmerLedgers({ search }: { search: string }) {
  const lookups = useLookups();
  const t = useT();
  const { fail } = useStore();
  const [openId, setOpenId] = useState<string | null>(null);

  const query = useQuery(() => farmerService.listWithFinancials());
  const rows = query.data ?? [];

  const detail = useQuery(async () => (openId ? ledgerService.ledgerFor(openId) : null), [openId]);

  const columns = useMemo<ColumnDef<farmerService.FarmerRow>[]>(
    () => [
      {
        key: 'farmer',
        header: T('Worker'),
        width: 210,
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
        header: T('Worker ID'),
        width: 96,
        mobile: 'subtitle',
        sortValue: (r) => r.code,
        searchValue: (r) => r.code,
        exportValue: (r) => r.code,
        render: (r) => <span className="grid__code">{r.code}</span>,
      },
      {
        key: 'entries',
        header: T('Entries'),
        width: 88,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.financials.transactionCount,
        searchValue: (r) => String(r.financials.transactionCount),
        exportValue: (r) => r.financials.transactionCount,
        render: (r) => <span className="num">{formatNumber(r.financials.transactionCount)}</span>,
      },
      {
        key: 'credits',
        header: T('Total added'),
        width: 138,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.financials.earned,
        searchValue: (r) => String(r.financials.earned),
        exportValue: (r) => r.financials.earned,
        render: (r) => <span className="num pos">{formatMoney(r.financials.earned)}</span>,
      },
      {
        key: 'debits',
        header: T('Total taken off'),
        width: 138,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.financials.paid + r.financials.advances + r.financials.deductions,
        searchValue: (r) => String(r.financials.paid),
        exportValue: (r) => r.financials.paid + r.financials.advances + r.financials.deductions,
        render: (r) => (
          <span className="num neg">{formatMoney(r.financials.paid + r.financials.advances + r.financials.deductions)}</span>
        ),
      },
      {
        key: 'balance',
        header: T('Balance'),
        width: 148,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.financials.balance,
        searchValue: (r) => String(r.financials.balance),
        exportValue: (r) => r.financials.balance,
        render: (r) => {
          const b = r.financials.balance;
          return <span className={`num strong ${b > 0 ? 'pos' : b < 0 ? 'neg' : 'muted'}`}>{formatMoney(b)}</span>;
        },
      },
      {
        key: 'last',
        header: T('Last movement'),
        width: 128,
        sortValue: (r) => r.financials.lastActivityDate ?? '',
        searchValue: (r) => r.financials.lastActivityDate ?? '',
        exportValue: (r) => r.financials.lastActivityDate ?? '',
        render: (r) => <span className="num">{r.financials.lastActivityDate ? formatDateShort(r.financials.lastActivityDate) : '-'}</span>,
      },
      {
        key: 'coop',
        header: T('Group'),
        width: 200,
        optional: true,
        sortValue: (r) => lookups.coopName(r.cooperativeId),
        searchValue: (r) => lookups.coopName(r.cooperativeId),
        exportValue: (r) => lookups.coopName(r.cooperativeId),
        render: (r) => <span className="truncate">{lookups.coopName(r.cooperativeId)}</span>,
      },
    ],
    [lookups],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('led.farmersTitle')}</h1>
          <p className="page-sub">{t('led.farmersSub')}</p>
        </div>
      </div>

      <DataGrid
        rows={rows}
        columns={columns}
        rowId={(r) => r.id}
        loading={query.loading}
        search={search}
        storageKey="ledgers"
        exportName="farmer-ledgers"
        selectable={false}
        onRowClick={(r) => setOpenId(r.id)}
        onError={fail}
        emptyTitle={T('No accounts yet')}
        emptyMessage={T('Ledger accounts appear as soon as the first transaction is posted.')}
      />

      {openId && (
        <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpenId(null)}>
          <div className="modal modal--wide" role="dialog" aria-label={T('Worker account')}>
            <div className="modal__head">
              <div className="grow">
                <h2 className="modal__title">
                  {rows.find((r) => r.id === openId)?.firstName} {rows.find((r) => r.id === openId)?.lastName}
                </h2>
                <p className="modal__sub">{T('Full account, oldest entry first.')}</p>
              </div>
              <button className="iconbtn" onClick={() => setOpenId(null)} aria-label={T('Close')}>
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="modal__body">
              {detail.loading ? <Skeleton height={220} /> : <LedgerTable lines={detail.data ?? []} showFarmer={false} />}
            </div>
            <div className="modal__foot">
              <span className="spacer" />
              <Button onClick={() => navigate(`/farmers/${openId}`)} iconRight="chevron-right">
                {T('Open worker profile')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ---------------------------------------------------------- transactions */

interface TxRow extends LedgerTransaction {
  farmer?: Farmer;
}

function Transactions({ search }: { search: string }) {
  const { user, can, refresh, toast, fail, confirm } = useStore();
  const lookups = useLookups();
  const t = useT();
  const [filters, setFilters] = useState<FilterValues>({});

  const query = useQuery(async () => {
    const [txs, farmers] = await Promise.all([ledgerService.allTransactions(), db.farmers.toArray()]);
    const byId = new Map(farmers.map((f) => [f.id, f]));
    return txs.map<TxRow>((t) => ({ ...t, farmer: byId.get(t.farmerId) }));
  });

  const all = query.data ?? [];
  const rows = useMemo(
    () =>
      all.filter(
        (t) =>
          matchesMulti(filters.type, t.type) &&
          matchesMulti(filters.direction, t.direction) &&
          matchesDate(filters.date, t.date) &&
          matchesNumber(filters.amount, t.amount),
      ),
    [all, filters],
  );

  const doVoid = async (tx: TxRow) => {
    const answer = await confirm({
      title: T('Void {code}?', { code: tx.code }),
      message: (
        <>
          <p>
            {tx.description}, <b>{formatMoney(tx.amount)}</b> ({tx.direction === 'credit' ? T('added') : T('taken off')}).
          </p>
          <p style={{ marginTop: 'var(--s-2)' }}>
            {T('The entry is not deleted. It stays on the account marked voided, with a matching reversal next to it. Neither counts toward the balance, so it goes back to what it was before this entry.')}
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
      toast({ tone: 'success', title: T('{code} voided', { code: tx.code }), message: T('A reversing entry was appended.') });
    } catch (e) {
      fail(e);
    }
  };

  const columns = useMemo<ColumnDef<TxRow>[]>(
    () => [
      {
        key: 'code',
        header: T('Entry'),
        width: 152,
        mobile: 'subtitle',
        sortValue: (r) => r.code,
        searchValue: (r) => r.code,
        exportValue: (r) => r.code,
        render: (r) => (
          <span className="grid__code">
            {r.code}
            {r.reversesId && <Icon name="undo" size={11} style={{ display: 'inline', marginLeft: 4 }} />}
          </span>
        ),
      },
      {
        key: 'date',
        header: T('Date'),
        width: 92,
        mobile: 'cell',
        sortValue: (r) => r.date,
        searchValue: (r) => r.date,
        exportValue: (r) => r.date,
        render: (r) => <span className="num">{formatDateShort(r.date)}</span>,
      },
      {
        key: 'farmer',
        header: T('Worker'),
        width: 186,
        mobile: 'title',
        sortValue: (r) => r.farmer?.lastName ?? '',
        searchValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''} ${r.farmer?.code ?? ''}`,
        exportValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''}`,
        render: (r) => <span className="truncate grid__link">{r.farmer ? `${r.farmer.firstName} ${r.farmer.lastName}` : '-'}</span>,
      },
      {
        key: 'type',
        header: T('Type'),
        width: 130,
        mobile: 'cell',
        sortValue: (r) => r.type,
        searchValue: (r) => LEDGER_TYPE_LABEL[r.type] ?? r.type,
        exportValue: (r) => LEDGER_TYPE_LABEL[r.type],
        render: (r) => <span className="chip" style={{ height: 21 }}>{LEDGER_TYPE_LABEL[r.type]}</span>,
      },
      {
        key: 'description',
        header: T('Description'),
        width: 250,
        sortValue: (r) => r.description,
        searchValue: (r) => r.description,
        exportValue: (r) => r.description,
        render: (r) => <span className="truncate" title={r.description}>{r.description}</span>,
      },
      {
        key: 'debit',
        header: T('Taken off'),
        width: 128,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => (r.direction === 'debit' ? r.amount : 0),
        searchValue: (r) => (r.direction === 'debit' ? String(r.amount) : ''),
        exportValue: (r) => (r.direction === 'debit' ? r.amount : ''),
        render: (r) => (r.direction === 'debit' ? <span className="num neg">{formatMoney(r.amount)}</span> : null),
      },
      {
        key: 'credit',
        header: T('Added'),
        width: 128,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => (r.direction === 'credit' ? r.amount : 0),
        searchValue: (r) => (r.direction === 'credit' ? String(r.amount) : ''),
        exportValue: (r) => (r.direction === 'credit' ? r.amount : ''),
        render: (r) => (r.direction === 'credit' ? <span className="num pos">{formatMoney(r.amount)}</span> : null),
      },
      {
        key: 'status',
        header: T('State'),
        width: 110,
        mobile: 'badge',
        sortValue: (r) => (r.voided ? 1 : 0),
        searchValue: (r) => (r.voided ? 'voided' : 'active'),
        exportValue: (r) => (r.voided ? 'voided' : 'active'),
        render: (r) =>
          r.voided ? (
            <Badge meta={{ label: T('Voided'), glyph: '✕', tone: 'slate', help: r.voidReason }} />
          ) : r.reversesId ? (
            <Badge meta={{ label: T('Reversal'), glyph: '↺', tone: 'blue', help: T('Cancels an earlier entry.') }} />
          ) : (
            <Badge meta={{ label: T('Posted'), glyph: '✓', tone: 'green' }} />
          ),
      },
      {
        key: 'by',
        header: T('Created by'),
        width: 156,
        sortValue: (r) => lookups.userName(r.createdBy),
        searchValue: (r) => lookups.userName(r.createdBy),
        exportValue: (r) => lookups.userName(r.createdBy),
        render: (r) => (
          <span className="muted truncate" title={formatDateTime(r.createdAt)}>
            {lookups.userName(r.createdBy)}
          </span>
        ),
      },
      {
        key: 'actions',
        header: '',
        width: 54,
        render: (r) =>
          can('ledger.void') && !r.voided && !r.reversesId ? (
            <button className="iconbtn" style={{ width: 26, height: 26 }} onClick={(e) => { e.stopPropagation(); void doVoid(r); }} aria-label={T('Void {code}', { code: r.code })} title={T('Cancel this entry')}>
              <Icon name="undo" size={14} />
            </button>
          ) : null,
      },
    ],
    // doVoid is stable enough for this screen; it only closes over store helpers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, lookups],
  );

  const totals = rows.reduce(
    (acc, t) => {
      if (!counts(t)) return acc;
      if (t.direction === 'credit') acc.credit += t.amount;
      else acc.debit += t.amount;
      return acc;
    },
    { credit: 0, debit: 0 },
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('led.txTitle')}</h1>
          <p className="page-sub">{t('led.txSub')}</p>
        </div>
      </div>

      <div className="metrics" style={{ marginBottom: 'var(--s-4)' }}>
        <div className="metric">
          <span className="metric__label">{t('led.entriesShown')}</span>
          <span className="metric__value num">{formatNumber(rows.length)}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{t('led.totalCredits')}</span>
          <span className="metric__value num pos">{formatMoneyShort(totals.credit)}</span>
          <span className="metric__foot">{T('RWF owed to workers')}</span>
        </div>
        <div className="metric">
          <span className="metric__label">{t('led.totalDebits')}</span>
          <span className="metric__value num neg">{formatMoneyShort(totals.debit)}</span>
          <span className="metric__foot">{T('RWF paid or withheld')}</span>
        </div>
        <div className="metric metric--accent">
          <span className="metric__label">{t('led.netPosition')}</span>
          <span className="metric__value num">{formatMoneyShort(totals.credit - totals.debit)}</span>
          <span className="metric__foot">{T('RWF still owed overall')}</span>
        </div>
      </div>

      <DataGrid
        rows={rows}
        columns={columns}
        rowId={(r) => r.id}
        loading={query.loading}
        search={search}
        storageKey="transactions"
        exportName="transactions"
        selectable={false}
        onRowClick={(r) => navigate(`/farmers/${r.farmerId}`)}
        onError={fail}
        emptyTitle={T('No transactions yet')}
        emptyMessage={T('Recording a harvest or a payment posts the first entry.')}
        toolbar={
          <FilterBar
            specs={[
              { key: 'type', label: T('Type'), type: 'multi', options: Object.entries(LEDGER_TYPE_LABEL).map(([value, label]) => ({ value, label })) },
              { key: 'direction', label: T('Direction'), type: 'select', options: [{ value: 'credit', label: T('Added') }, { value: 'debit', label: T('Taken off') }] },
              { key: 'date', label: T('Date'), type: 'daterange' },
              { key: 'amount', label: T('Amount'), type: 'numrange' },
            ]}
            values={filters}
            onChange={setFilters}
          />
        }
      />
    </>
  );
}

/* ----------------------------------------------------------- adjustments */

function Adjustments() {
  const { can } = useStore();
  const lookups = useLookups();
  const t = useT();
  const [composer, setComposer] = useState(false);

  const query = useQuery(async () => {
    const [txs, farmers, trail] = await Promise.all([
      ledgerService.allTransactions(),
      db.farmers.toArray(),
      audit.recentTrail(150),
    ]);
    const byId = new Map(farmers.map((f) => [f.id, f]));
    const adjustments = txs.filter((t) => t.type === 'adjustment' || t.voided || t.reversesId);
    return {
      lines: withRunningBalance(adjustments).reverse(),
      names: new Map(farmers.map((f) => [f.id, `${f.firstName} ${f.lastName} (${f.code})`])),
      byId,
      trail: trail.filter((e) => e.entity === 'transaction'),
    };
  });

  if (query.loading) return <Skeleton height={300} />;
  const d = query.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('led.adjTitle')}</h1>
          <p className="page-sub">{t('led.adjSub')}</p>
        </div>
        {can('ledger.post') && (
          <Button variant="primary" icon="plus" onClick={() => setComposer(true)}>
            {T('Post an adjustment')}
          </Button>
        )}
      </div>

      <Callout tone="info" icon="shield">
        {T('A balance can never be typed over. Every correction on this page is a transaction of its own, which is why the history still adds up after it.')}
      </Callout>

      <div style={{ marginTop: 'var(--s-4)' }}>
        {!d || d.lines.length === 0 ? (
          <EmptyState icon="shield" title={T('No adjustments have been made')} message={T('Nothing has been corrected or voided on any account.')} />
        ) : (
          <LedgerTable lines={d.lines} showFarmer farmerNames={d.names} emptyMessage={T('No adjustments recorded.')} />
        )}
      </div>

      {d && d.trail.length > 0 && (
        <section className="card" style={{ marginTop: 'var(--s-4)' }}>
          <div className="card__head">
            <h2 className="section-title">{T('Audit trail')}</h2>
            <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
              {T('Who did what, in order')}
            </span>
          </div>
          <div className="card__body">
            <ul className="stack gap-3">
              {d.trail.slice(0, 20).map((e) => (
                <li key={e.id} className="row gap-3" style={{ alignItems: 'flex-start' }}>
                  <span className={`notif__icon notif__icon--${e.action === 'void' ? 'financial' : 'operational'}`} style={{ width: 26, height: 26 }}>
                    <Icon name={e.action === 'void' ? 'undo' : 'edit'} size={13} />
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

      <ActivityComposer open={composer} typeId="adjustment" onClose={() => setComposer(false)} />
    </>
  );
}
