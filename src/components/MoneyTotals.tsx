/**
 * The owner's money view: for today, this week, this month, this year or all
 * time, what was spent on work and produce, what was paid and what is still
 * owed, per group and in total, with an Excel download listing every worker.
 */

import { useState } from 'react';
import { useQuery } from '../state/store';
import { navigate } from '../state/router';
import { Button, Skeleton } from './ui/primitives';
import { Icon } from './ui/Icon';
import { formatMoney, formatMoneyShort, formatNumber } from '../domain/money';
import { formatDate, today } from '../lib/date';
import { buildXlsx, downloadXlsx, type XRow } from '../lib/xlsx';
import { tx } from '../i18n/tx';
import * as totalsService from '../services/totalsService';
import type { Period } from '../services/totalsService';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
];

export function MoneyTotals() {
  const [period, setPeriod] = useState<Period>('week');
  const range = totalsService.periodRange(period);
  const q = useQuery(() => totalsService.totals(range), [period]);
  const t = q.data;
  const label = tx(PERIODS.find((p) => p.id === period)!.label);
  const rangeText = period === 'all' ? tx('All time') : range.from === range.to ? formatDate(range.from) : tx('{from} to {to}', { from: formatDate(range.from), to: formatDate(range.to) });

  const download = () => {
    if (!t) return;
    const head = [tx('Group'), tx('Worker ID'), tx('Worker'), tx('Days worked'), tx('Work pay'), tx('Produce'), tx('Other credits'), tx('Deductions'), tx('Total'), tx('Paid'), tx('Advances'), tx('Owed now')];
    const line = (g: string, id: string, n: string, m: totalsService.Money): (string | number)[] => [
      g, id, n, m.days, m.workPay, m.produce, m.other, m.deductions, totalsService.totalCost(m), m.paid, m.advances, m.owedNow,
    ];
    const rows: XRow[] = [
      { cells: [tx('Smart Agri-Ledger: money per worker and group')], bold: true },
      { cells: [tx('Period'), rangeText] },
      { cells: [tx('Downloaded'), formatDate(today())] },
      { cells: [] },
      { cells: head, bold: true },
    ];
    for (const g of t.groups) {
      for (const w of t.workers.filter((x) => x.groupId === g.groupId)) {
        rows.push({ cells: line(g.name, w.farmer.code, `${w.farmer.firstName} ${w.farmer.lastName}`, w) });
      }
      rows.push({ cells: line(g.name, '', tx('Group total ({count} workers)', { count: g.workers }), g), bold: true });
      rows.push({ cells: [] });
    }
    rows.push({ cells: line(tx('All groups'), '', tx('Grand total ({count} workers)', { count: t.all.workers }), t.all), bold: true });
    downloadXlsx(`money-${period}-${today()}`, buildXlsx(tx('Money'), rows, [24, 12, 26, 12, 14, 14, 14, 14, 14, 14, 14, 14]));
  };

  return (
    <section className="card" style={{ marginBottom: 'var(--s-4)' }}>
      <div className="card__head">
        <div className="row gap-2">
          <Icon name="coins" size={17} />
          <h2 className="section-title">{tx('Money')}</h2>
          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{rangeText}</span>
        </div>
        <span className="spacer" />
        <Button size="sm" icon="download" onClick={download} disabled={!t}>
          {tx('Download Excel')}
        </Button>
      </div>
      <div className="card__body">
        <div className="tabs tabs--wrap" role="tablist" style={{ marginBottom: 'var(--s-4)' }}>
          {PERIODS.map((p) => (
            <button key={p.id} role="tab" aria-selected={period === p.id} className={`tab ${period === p.id ? 'tab--on' : ''}`} onClick={() => setPeriod(p.id)}>
              {tx(p.label)}
            </button>
          ))}
        </div>

        {!t ? (
          <Skeleton height={160} />
        ) : (
          <>
            <div className="metrics">
              <Card label={tx('Work pay')} value={t.all.workPay} foot={tx('{count} days worked', { count: formatNumber(t.all.days) })} />
              <Card label={tx('Produce')} value={t.all.produce} foot={tx('Value of produce brought in')} />
              <Card label={tx('Total')} value={totalsService.totalCost(t.all)} foot={tx('Money used, {period}', { period: label.toLowerCase() })} accent />
              <Card label={tx('Paid')} value={t.all.paid} foot={tx('Handed over, {period}', { period: label.toLowerCase() })} />
              <Card label={tx('Owed now')} value={t.all.owedNow} foot={tx('Still to pay, all time')} warn />
            </div>

            <div style={{ overflowX: 'auto', marginTop: 'var(--s-4)' }}>
              <table className="grid" style={{ width: '100%', minWidth: 620 }}>
                <thead>
                  <tr>
                    {[tx('Group'), tx('Workers'), tx('Days worked'), tx('Work pay'), tx('Produce'), tx('Total'), tx('Paid'), tx('Owed now')].map((h, i) => (
                      <th key={h} className={i ? 'num' : ''}><span className="th">{h}</span></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {t.groups.length === 0 ? (
                    <tr><td colSpan={8}><span className="cell muted">{tx('Nothing recorded in this period.')}</span></td></tr>
                  ) : (
                    t.groups.map((g) => (
                      <tr key={g.groupId} style={{ cursor: 'pointer' }} onClick={() => navigate(`/farmers?coop=${g.groupId}`)}>
                        <td><span className="cell strong">{g.name}</span></td>
                        <td className="num"><span className="cell num">{g.workers}</span></td>
                        <td className="num"><span className="cell num">{g.days}</span></td>
                        <td className="num"><span className="cell num">{formatMoney(g.workPay)}</span></td>
                        <td className="num"><span className="cell num">{formatMoney(g.produce)}</span></td>
                        <td className="num"><span className="cell num strong">{formatMoney(totalsService.totalCost(g))}</span></td>
                        <td className="num"><span className="cell num">{formatMoney(g.paid)}</span></td>
                        <td className="num"><span className={`cell num ${g.owedNow > 0 ? 'pos' : ''}`}>{formatMoney(g.owedNow)}</span></td>
                      </tr>
                    ))
                  )}
                </tbody>
                {t.groups.length > 1 && (
                  <tfoot>
                    <tr>
                      <td><span className="cell strong">{tx('All groups')}</span></td>
                      <td className="num"><span className="cell num strong">{t.all.workers}</span></td>
                      <td className="num"><span className="cell num strong">{t.all.days}</span></td>
                      <td className="num"><span className="cell num strong">{formatMoney(t.all.workPay)}</span></td>
                      <td className="num"><span className="cell num strong">{formatMoney(t.all.produce)}</span></td>
                      <td className="num"><span className="cell num strong">{formatMoney(totalsService.totalCost(t.all))}</span></td>
                      <td className="num"><span className="cell num strong">{formatMoney(t.all.paid)}</span></td>
                      <td className="num"><span className="cell num strong">{formatMoney(t.all.owedNow)}</span></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Card({ label, value, foot, accent, warn }: { label: string; value: number; foot: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className={`metric ${accent ? 'metric--accent' : ''} ${warn ? 'metric--warn' : ''}`}>
      <span className="metric__label">{label}</span>
      <span className="metric__value num" title={formatMoney(value)}>{formatMoneyShort(value)}</span>
      <span className="metric__foot">{foot}</span>
    </div>
  );
}
