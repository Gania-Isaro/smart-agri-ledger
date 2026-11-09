/**
 * Reports.
 *
 * Every report is generated from the same services the screens use, so a
 * printed report and the app can never disagree. Export is CSV (which Excel
 * opens directly) and PDF via the browser print dialog, both work with no
 * network, which a hosted converter would not.
 */

import { useState } from 'react';
import { useLookups, useQuery, useStore } from '../state/store';
import { Icon, type IconName } from '../components/ui/Icon';
import { Button, Field, Input, Skeleton } from '../components/ui/primitives';
import { Modal } from '../components/ui/Modal';
import { formatMoney, formatNumber } from '../domain/money';
import { FARMER_STATUS, GRADE_META, LEDGER_TYPE_LABEL, PAYMENT_METHOD_LABEL, PAYMENT_STATUS } from '../domain/status';
import { formatDate, inRange, today } from '../lib/date';
import { exportCSV, printHTML, type Column } from '../lib/csv';
import { db } from '../db/db';
import * as analytics from '../services/analyticsService';
import * as harvestService from '../services/harvestService';
import * as paymentService from '../services/paymentService';
import * as ledgerService from '../services/ledgerService';
import { counts, signedAmount } from '../domain/ledger';
import { useT } from '../i18n';

import { translated, tx } from '../i18n/tx';
type ReportId =
  | 'farmer_activity'
  | 'harvest'
  | 'crop_production'
  | 'payments'
  | 'outstanding'
  | 'farmer_ledger'
  | 'cooperative'
  | 'seasonal'
  | 'financial_summary';

const REPORTS: { id: ReportId; name: string; description: string; icon: IconName }[] = translated([
  { id: 'farmer_activity', name: 'Farmer activity report', description: 'Every farmer with their deliveries, earnings and current status.', icon: 'users' },
  { id: 'harvest', name: 'Harvest report', description: 'Delivery-by-delivery detail: quantity, grade, price and net value.', icon: 'basket' },
  { id: 'crop_production', name: 'Crop production report', description: 'Quantity and value produced per crop, with each crop’s share.', icon: 'sprout' },
  { id: 'payments', name: 'Payment report', description: 'All payments with status, method, reference and approver.', icon: 'coins' },
  { id: 'outstanding', name: 'Outstanding balances', description: 'Who is still owed, how much, and what has already been paid.', icon: 'wallet' },
  { id: 'farmer_ledger', name: 'Farmer ledger report', description: 'The full transaction journal with running balances.', icon: 'book' },
  { id: 'cooperative', name: 'Cooperative report', description: 'Members, production and financial position for each cooperative.', icon: 'layers' },
  { id: 'seasonal', name: 'Seasonal report', description: 'Production and payments month by month across the season.', icon: 'calendar' },
  { id: 'financial_summary', name: 'Financial summary', description: 'The cooperative’s overall position: earned, paid, owed, advanced.', icon: 'chart' },
]);

export function Reports() {
  const t = useT();
  const [open, setOpen] = useState<ReportId | null>(null);
  const overview = useQuery(() => analytics.overview());
  const o = overview.data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('rep.title')}</h1>
          <p className="page-sub">{t('rep.sub')}</p>
        </div>
      </div>

      {o && (
        <div className="metrics" style={{ marginBottom: 'var(--s-4)' }}>
          <div className="metric metric--accent">
            <span className="metric__label">{tx('Produce collected')}</span>
            <span className="metric__value num">{formatNumber(Math.round(o.produceKg))}</span>
            <span className="metric__foot">{tx('KG across {count} deliveries', { count: formatNumber(o.deliveries) })}</span>
          </div>
          <div className="metric">
            <span className="metric__label">{tx('Earned by farmers')}</span>
            <span className="metric__value num">{formatMoney(o.totalOwed)}</span>
          </div>
          <div className="metric">
            <span className="metric__label">{tx('Paid out')}</span>
            <span className="metric__value num">{formatMoney(o.totalPaid)}</span>
          </div>
          <div className="metric metric--warn">
            <span className="metric__label">{tx('Still owed')}</span>
            <span className="metric__value num">{formatMoney(o.outstanding)}</span>
            <span className="metric__foot">{tx('To {count} farmers', { count: formatNumber(o.farmersOwed) })}</span>
          </div>
        </div>
      )}

      <div className="reportlist">
        {REPORTS.map((r) => (
          <button key={r.id} className="reporttile" onClick={() => setOpen(r.id)}>
            <span className="row gap-2">
              <span className="picktile__icon" style={{ width: 26, height: 26 }}>
                <Icon name={r.icon} size={15} />
              </span>
              <span className="reporttile__name">{r.name}</span>
            </span>
            <span className="reporttile__desc">{r.description}</span>
            <span className="row gap-2" style={{ marginTop: 'var(--s-2)', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              <Icon name="download" size={12} /> CSV
              <Icon name="printer" size={12} /> PDF
            </span>
          </button>
        ))}
      </div>

      {open && <ReportModal id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/* ---------------------------------------------------------------- runner */

interface ReportData {
  title: string;
  columns: { key: string; header: string; num?: boolean }[];
  rows: Record<string, string | number>[];
  totals?: Record<string, string | number>;
  cards?: { label: string; value: string }[];
}

function ReportModal({ id, onClose }: { id: ReportId; onClose: () => void }) {
  const meta = REPORTS.find((r) => r.id === id)!;
  const lookups = useLookups();
  const { cooperatives, toast } = useStore();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(today());

  const query = useQuery(() => build(id, { from, to }, lookups, cooperatives), [id, from, to]);
  const data = query.data;

  const doCSV = () => {
    if (!data) return;
    const columns: Column<Record<string, string | number>>[] = data.columns.map((c) => ({
      key: c.key,
      header: c.header,
      value: (row) => row[c.key] ?? '',
    }));
    exportCSV(`${id}-${today()}.csv`, data.rows, columns);
    toast({ tone: 'success', title: tx('CSV exported'), message: tx('Open it directly in Excel.') });
  };

  const doPDF = () => {
    if (!data) return;
    const head = data.columns.map((c) => `<th class="${c.num ? 'num' : ''}">${c.header}</th>`).join('');
    const body = data.rows
      .map(
        (row) =>
          `<tr>${data.columns.map((c) => `<td class="${c.num ? 'num' : ''}">${escapeHTML(String(row[c.key] ?? ''))}</td>`).join('')}</tr>`,
      )
      .join('');
    const foot = data.totals
      ? `<tfoot><tr>${data.columns
          .map((c) => `<td class="${c.num ? 'num' : ''}">${escapeHTML(String(data.totals?.[c.key] ?? ''))}</td>`)
          .join('')}</tr></tfoot>`
      : '';
    const cards = data.cards
      ? `<div class="cards">${data.cards.map((c) => `<div class="card"><span>${escapeHTML(c.label)}</span><b>${escapeHTML(c.value)}</b></div>`).join('')}</div>`
      : '';

    printHTML(
      data.title,
      `<h1>${escapeHTML(data.title)}</h1>
       <p class="meta">Smart Agri-Ledger · ${from ? `${formatDate(from)} - ` : tx('All records up to') + ' '}${formatDate(to)} · ${tx('generated')} ${formatDate(today())}</p>
       ${cards}
       <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${foot}</table>`,
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={meta.name}
      subtitle={meta.description}
      size="wide"
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {tx('Close')}
          </Button>
          <Button icon="printer" onClick={doPDF} disabled={!data}>
            {tx('Print / PDF')}
          </Button>
          <Button variant="primary" icon="download" onClick={doCSV} disabled={!data}>
            {tx('Export CSV')}
          </Button>
        </>
      }
    >
      <div className="stack gap-4">
        <div className="formgrid">
          <Field label={tx('From')} help={tx('Leave empty for all records.')}>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={tx('To')}>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>

        {query.loading || !data ? (
          <Skeleton height={220} />
        ) : (
          <>
            {data.cards && (
              <div className="metrics">
                {data.cards.map((c) => (
                  <div className="metric" key={c.label}>
                    <span className="metric__label">{c.label}</span>
                    <span className="metric__value metric__value--sm num">{c.value}</span>
                  </div>
                ))}
              </div>
            )}

            <div>
              <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
                {formatNumber(data.rows.length)} rows
              </p>
              <div className="panel" style={{ maxHeight: 340, overflow: 'auto' }}>
                <table className="grid" style={{ width: '100%' }}>
                  <thead>
                    <tr>
                      {data.columns.map((c) => (
                        <th key={c.key} className={c.num ? 'num' : ''}>
                          <span className="th">{c.header}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.slice(0, 60).map((row, i) => (
                      <tr key={i}>
                        {data.columns.map((c) => (
                          <td key={c.key} className={c.num ? 'num' : ''}>
                            <span className={`cell ${c.num ? 'num' : ''}`}>{row[c.key]}</span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  {data.totals && (
                    <tfoot>
                      <tr>
                        {data.columns.map((c) => (
                          <td key={c.key} className={c.num ? 'num' : ''}>
                            <span className={`cell strong ${c.num ? 'num' : ''}`}>{data.totals?.[c.key] ?? ''}</span>
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {data.rows.length > 60 && (
                <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-2)' }}>
                  {tx('Showing the first 60 rows. The export contains all {count}.', { count: formatNumber(data.rows.length) })}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- builders */

async function build(
  id: ReportId,
  range: { from: string; to: string },
  lookups: ReturnType<typeof useLookups>,
  cooperatives: { id: string; name: string; district: string }[],
): Promise<ReportData> {
  const within = (d: string | null | undefined) => (d ? inRange(d, range.from || null, range.to || null) : false);

  switch (id) {
    case 'farmer_activity': {
      const rows = await analytics.farmerReport();
      return {
        title: tx('Farmer activity report'),
        columns: [
          { key: 'code', header: tx('Farmer ID') },
          { key: 'name', header: tx('Farmer') },
          { key: 'district', header: tx('District') },
          { key: 'crop', header: tx('Primary crop') },
          { key: 'deliveries', header: tx('Deliveries'), num: true },
          { key: 'quantity', header: tx('Quantity (KG)'), num: true },
          { key: 'earned', header: tx('Earned'), num: true },
          { key: 'paid', header: tx('Paid'), num: true },
          { key: 'balance', header: tx('Balance'), num: true },
          { key: 'status', header: tx('Status') },
        ],
        rows: rows.map((r) => ({
          code: r.code,
          name: r.name,
          district: r.district,
          crop: r.crop,
          deliveries: r.deliveries,
          quantity: formatNumber(Math.round(r.quantity)),
          earned: formatMoney(r.earned),
          paid: formatMoney(r.paid),
          balance: formatMoney(r.balance),
          status: FARMER_STATUS[r.status].label,
        })),
        totals: {
          code: tx('Total'),
          deliveries: rows.reduce((s, r) => s + r.deliveries, 0),
          quantity: formatNumber(Math.round(rows.reduce((s, r) => s + r.quantity, 0))),
          earned: formatMoney(rows.reduce((s, r) => s + r.earned, 0)),
          paid: formatMoney(rows.reduce((s, r) => s + r.paid, 0)),
          balance: formatMoney(rows.reduce((s, r) => s + r.balance, 0)),
        },
        cards: [
          { label: tx('Farmers'), value: formatNumber(rows.length) },
          { label: tx('Delivered'), value: formatNumber(rows.filter((r) => r.deliveries > 0).length) },
          { label: tx('Owed'), value: formatNumber(rows.filter((r) => r.balance > 0).length) },
        ],
      };
    }

    case 'harvest': {
      const [harvests, farmers] = await Promise.all([harvestService.list(), db.farmers.toArray()]);
      const byId = new Map(farmers.map((f) => [f.id, f]));
      const scoped = harvests.filter((h) => within(h.date));
      return {
        title: tx('Harvest report'),
        columns: [
          { key: 'date', header: tx('Date') },
          { key: 'code', header: tx('Farmer ID') },
          { key: 'farmer', header: tx('Farmer') },
          { key: 'crop', header: tx('Crop') },
          { key: 'quantity', header: tx('Quantity'), num: true },
          { key: 'unit', header: tx('Unit') },
          { key: 'grade', header: tx('Grade') },
          { key: 'price', header: tx('Price/unit'), num: true },
          { key: 'gross', header: tx('Gross value'), num: true },
          { key: 'deductions', header: tx('Deductions'), num: true },
          { key: 'net', header: tx('Net'), num: true },
          { key: 'status', header: tx('Status') },
        ],
        rows: scoped.map((h) => ({
          date: formatDate(h.date),
          code: byId.get(h.farmerId)?.code ?? '',
          farmer: `${byId.get(h.farmerId)?.firstName ?? ''} ${byId.get(h.farmerId)?.lastName ?? ''}`.trim(),
          crop: lookups.cropName(h.cropId),
          quantity: formatNumber(h.quantity),
          unit: h.unit,
          grade: GRADE_META[h.grade].label,
          price: formatMoney(h.pricePerUnit),
          gross: formatMoney(h.gross),
          deductions: h.deductions ? formatMoney(h.deductions) : '',
          net: formatMoney(h.net),
          status: h.status,
        })),
        totals: {
          date: tx('Total'),
          gross: formatMoney(scoped.reduce((s, h) => s + h.gross, 0)),
          deductions: formatMoney(scoped.reduce((s, h) => s + h.deductions, 0)),
          net: formatMoney(scoped.reduce((s, h) => s + h.net, 0)),
        },
        cards: [
          { label: tx('Deliveries'), value: formatNumber(scoped.length) },
          { label: tx('Gross value'), value: formatMoney(scoped.reduce((s, h) => s + h.gross, 0)) },
          { label: tx('Net to farmers'), value: formatMoney(scoped.reduce((s, h) => s + h.net, 0)) },
        ],
      };
    }

    case 'crop_production': {
      const totals = await harvestService.totalsByCrop();
      const grand = totals.reduce((s, t) => s + t.value, 0);
      return {
        title: tx('Crop production report'),
        columns: [
          { key: 'crop', header: tx('Crop') },
          { key: 'deliveries', header: tx('Deliveries'), num: true },
          { key: 'quantity', header: tx('Quantity'), num: true },
          { key: 'unit', header: tx('Unit') },
          { key: 'value', header: tx('Gross value'), num: true },
          { key: 'share', header: tx('Share of value'), num: true },
        ],
        rows: totals.map((t) => ({
          crop: lookups.cropName(t.cropId),
          deliveries: t.deliveries,
          quantity: formatNumber(Math.round(t.quantity)),
          unit: t.unit,
          value: formatMoney(t.value),
          share: grand ? `${Math.round((t.value / grand) * 100)}%` : '0%',
        })),
        totals: { crop: tx('Total'), deliveries: totals.reduce((s, t) => s + t.deliveries, 0), value: formatMoney(grand), share: '100%' },
      };
    }

    case 'payments': {
      const [listed, farmers, txs, activities] = await Promise.all([
        paymentService.list(),
        db.farmers.toArray(),
        db.transactions.toArray(),
        db.activities.toArray(),
      ]);
      const byId = new Map(farmers.map((f) => [f.id, f]));
      const activityById = new Map(activities.map((a) => [a.id, a]));
      /* A payment recorded with "Record activity" goes straight to the ledger
         without a payment record. It is still money paid, so it belongs here,
         or this report would disagree with every other total in the app. */
      const direct = txs
        .filter((t) => t.type === 'payment' && !t.paymentId && counts(t))
        .map((t) => {
          const data = t.activityId ? activityById.get(t.activityId)?.data : undefined;
          return {
            id: t.id,
            farmerId: t.farmerId,
            date: t.date,
            reference: t.reference || t.code,
            amount: t.amount,
            method: (data?.method as string | undefined) ?? '',
            status: 'paid' as const,
            reason: t.description,
          };
        });
      const payments = [...listed, ...direct].sort((a, b) => (a.date < b.date ? 1 : -1));
      const scoped = payments.filter((p) => within(p.date));
      const paid = scoped.filter((p) => p.status === 'paid');
      return {
        title: tx('Payment report'),
        columns: [
          { key: 'date', header: tx('Date') },
          { key: 'reference', header: tx('Reference') },
          { key: 'code', header: tx('Farmer ID') },
          { key: 'farmer', header: tx('Farmer') },
          { key: 'amount', header: tx('Amount'), num: true },
          { key: 'method', header: tx('Method') },
          { key: 'status', header: tx('Status') },
          { key: 'reason', header: tx('Reason') },
        ],
        rows: scoped.map((p) => ({
          date: formatDate(p.date),
          reference: p.reference,
          code: byId.get(p.farmerId)?.code ?? '',
          farmer: `${byId.get(p.farmerId)?.firstName ?? ''} ${byId.get(p.farmerId)?.lastName ?? ''}`.trim(),
          amount: formatMoney(p.amount),
          method: PAYMENT_METHOD_LABEL[p.method] ?? (p.method || '-'),
          status: PAYMENT_STATUS[p.status].label,
          reason: p.reason,
        })),
        totals: { date: tx('Total, all statuses'), amount: formatMoney(scoped.filter((p) => p.status !== 'cancelled').reduce((s, p) => s + p.amount, 0)) },
        cards: [
          { label: tx('Payments'), value: formatNumber(scoped.length) },
          { label: tx('Settled'), value: formatMoney(paid.reduce((s, p) => s + p.amount, 0)) },
          { label: tx('Not yet paid'), value: formatMoney(scoped.filter((p) => p.status !== 'paid' && p.status !== 'cancelled').reduce((s, p) => s + p.amount, 0)) },
        ],
      };
    }

    case 'outstanding': {
      const rows = (await analytics.farmerReport()).filter((r) => r.balance !== 0);
      return {
        title: tx('Outstanding balances'),
        columns: [
          { key: 'code', header: tx('Farmer ID') },
          { key: 'name', header: tx('Farmer') },
          { key: 'district', header: tx('District') },
          { key: 'earned', header: tx('Earned'), num: true },
          { key: 'paid', header: tx('Paid'), num: true },
          { key: 'advances', header: tx('Advances'), num: true },
          { key: 'deductions', header: tx('Deductions'), num: true },
          { key: 'balance', header: tx('Balance owed'), num: true },
        ],
        rows: rows.map((r) => ({
          code: r.code,
          name: r.name,
          district: r.district,
          earned: formatMoney(r.earned),
          paid: formatMoney(r.paid),
          advances: formatMoney(r.advances),
          deductions: formatMoney(r.deductions),
          balance: formatMoney(r.balance),
        })),
        totals: { code: tx('Net (owed minus advances)'), balance: formatMoney(rows.reduce((s, r) => s + r.balance, 0)) },
        cards: [
          { label: tx('Farmers owed'), value: formatNumber(rows.filter((r) => r.balance > 0).length) },
          { label: tx('Total owed'), value: formatMoney(rows.filter((r) => r.balance > 0).reduce((s, r) => s + r.balance, 0)) },
          { label: tx('In advance'), value: formatNumber(rows.filter((r) => r.balance < 0).length) },
        ],
      };
    }

    case 'farmer_ledger': {
      const [txs, farmers] = await Promise.all([ledgerService.allTransactions(), db.farmers.toArray()]);
      const byId = new Map(farmers.map((f) => [f.id, f]));
      const scoped = txs.filter((t) => within(t.date)).sort((a, b) => (a.date < b.date ? -1 : 1));
      let running = 0;
      return {
        title: tx('Farmer ledger report'),
        columns: [
          { key: 'date', header: tx('Date') },
          { key: 'code', header: tx('Transaction') },
          { key: 'farmer', header: tx('Farmer') },
          { key: 'type', header: tx('Type') },
          { key: 'description', header: tx('Description') },
          { key: 'debit', header: tx('Debit'), num: true },
          { key: 'credit', header: tx('Credit'), num: true },
          { key: 'by', header: tx('Created by') },
        ],
        rows: scoped.map((t) => {
          running += signedAmount(t);
          return {
            date: formatDate(t.date),
            code: t.code,
            farmer: `${byId.get(t.farmerId)?.code ?? ''} ${byId.get(t.farmerId)?.lastName ?? ''}`.trim(),
            type: LEDGER_TYPE_LABEL[t.type] ?? t.type,
            description: t.voided ? `${t.description} (VOIDED)` : t.reversesId ? `${t.description} (REVERSAL)` : t.description,
            debit: t.direction === 'debit' && counts(t) ? formatMoney(t.amount) : '',
            credit: t.direction === 'credit' && counts(t) ? formatMoney(t.amount) : '',
            by: lookups.userName(t.createdBy),
          };
        }),
        totals: {
          date: tx('Net position'),
          debit: formatMoney(scoped.filter((t) => counts(t) && t.direction === 'debit').reduce((s, t) => s + t.amount, 0)),
          credit: formatMoney(scoped.filter((t) => counts(t) && t.direction === 'credit').reduce((s, t) => s + t.amount, 0)),
          by: formatMoney(running),
        },
      };
    }

    case 'cooperative': {
      const rows = await analytics.farmerReport();
      return {
        title: tx('Cooperative report'),
        columns: [
          { key: 'name', header: tx('Cooperative') },
          { key: 'district', header: tx('District') },
          { key: 'members', header: tx('Members'), num: true },
          { key: 'quantity', header: tx('Quantity (KG)'), num: true },
          { key: 'earned', header: tx('Earned'), num: true },
          { key: 'paid', header: tx('Paid'), num: true },
          { key: 'balance', header: tx('Owed'), num: true },
        ],
        rows: cooperatives.map((c) => {
          const members = rows.filter((r) => r.cooperative === c.name);
          return {
            name: c.name,
            district: c.district,
            members: members.length,
            quantity: formatNumber(Math.round(members.reduce((s, r) => s + r.quantity, 0))),
            earned: formatMoney(members.reduce((s, r) => s + r.earned, 0)),
            paid: formatMoney(members.reduce((s, r) => s + r.paid, 0)),
            balance: formatMoney(members.reduce((s, r) => s + Math.max(r.balance, 0), 0)),
          };
        }),
        totals: {
          name: tx('Total'),
          members: rows.length,
          earned: formatMoney(rows.reduce((s, r) => s + r.earned, 0)),
          paid: formatMoney(rows.reduce((s, r) => s + r.paid, 0)),
          balance: formatMoney(rows.reduce((s, r) => s + Math.max(r.balance, 0), 0)),
        },
      };
    }

    case 'seasonal': {
      const [produce, money] = await Promise.all([analytics.harvestOverTime(12), analytics.moneyOverTime(12)]);
      const merged = produce.map((p) => {
        const m = money.find((x) => x.label === p.label);
        return {
          month: p.label,
          quantity: formatNumber(p.value),
          earned: formatMoney(m?.value ?? 0),
          paid: formatMoney(m?.secondary ?? 0),
          gap: formatMoney((m?.value ?? 0) - (m?.secondary ?? 0)),
        };
      });
      return {
        title: tx('Seasonal report'),
        columns: [
          { key: 'month', header: tx('Month') },
          { key: 'quantity', header: tx('Produce (KG)'), num: true },
          { key: 'earned', header: tx('Earned'), num: true },
          { key: 'paid', header: tx('Paid'), num: true },
          { key: 'gap', header: tx('Unsettled'), num: true },
        ],
        rows: merged,
      };
    }

    case 'financial_summary': {
      const [position, o] = await Promise.all([ledgerService.position(), analytics.overview()]);
      return {
        title: tx('Financial summary'),
        columns: [
          { key: 'item', header: tx('Item') },
          { key: 'value', header: tx('Amount'), num: true },
        ],
        rows: [
          { item: tx('Total earned by farmers (credits)'), value: formatMoney(position.totalEarned) },
          { item: tx('Total paid to farmers (debits)'), value: formatMoney(position.totalPaid) },
          { item: tx('Advances and loans issued'), value: formatMoney(position.totalAdvances) },
          { item: tx('Deductions applied'), value: formatMoney(position.totalDeductions) },
          { item: tx('Outstanding to farmers'), value: formatMoney(position.outstanding) },
          { item: tx('Advances still to recover'), value: formatMoney(position.inAdvance) },
          { item: tx('Farmers currently owed'), value: formatNumber(position.farmersOwed) },
          { item: tx('Farmers on the register'), value: formatNumber(o.totalFarmers) },
          { item: tx('Deliveries recorded'), value: formatNumber(o.deliveries) },
          { item: tx('Produce collected (KG)'), value: formatNumber(Math.round(o.produceKg)) },
        ],
        cards: [
          { label: tx('Earned'), value: formatMoney(position.totalEarned) },
          { label: tx('Paid'), value: formatMoney(position.totalPaid) },
          { label: tx('Outstanding'), value: formatMoney(position.outstanding) },
        ],
      };
    }
  }
}

function escapeHTML(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
