/** Harvests and crop performance. */

import { useMemo, useState } from 'react';
import { useLookups, useQuery, useStore } from '../state/store';
import { navigate, useRoute } from '../state/router';
import { DataGrid, type ColumnDef } from '../components/grid/DataGrid';
import { FilterBar, matchesDate, matchesMulti, matchesNumber, type FilterValues } from '../components/Filters';
import { Badge, Callout } from '../components/ui/primitives';
import { ChartCard, HBars } from '../components/charts';
import { formatMoney, formatNumber } from '../domain/money';
import { HARVEST_STATUS } from '../domain/status';
import { formatDateShort } from '../lib/date';
import { db } from '../db/db';
import * as harvestService from '../services/harvestService';
import * as analytics from '../services/analyticsService';
import type { Farmer } from '../domain/types';
import { usePrefs } from '../i18n';

import { cropLabel, tx } from '../i18n/tx';
import { txr } from '../i18n/rich';
interface Row extends harvestService.HarvestRow {
  farmer?: Farmer;
}

export function Production({ search }: { search: string }) {
  const route = useRoute();
  const sub = route.segments[1] ?? 'harvests';

  if (sub === 'crops') return <Crops />;
  return <Harvests search={search} />;
}

/* -------------------------------------------------------------- harvests */

function Harvests({ search }: { search: string }) {
  const { user, can, crops, refresh, toast, fail, confirm } = useStore();
  const lookups = useLookups();
  const { t, tCrop } = usePrefs();
  const [filters, setFilters] = useState<FilterValues>({});

  const query = useQuery(async () => {
    const [harvests, farmers] = await Promise.all([harvestService.list(), db.farmers.toArray()]);
    const byId = new Map(farmers.map((f) => [f.id, f]));
    return harvests.map<Row>((h) => ({ ...h, farmer: byId.get(h.farmerId) }));
  });

  const all = query.data ?? [];
  const rows = useMemo(
    () =>
      all.filter(
        (h) =>
          matchesMulti(filters.status, h.status) &&
          matchesMulti(filters.crop, h.cropId) &&
          matchesMulti(filters.district, h.farmer?.district) &&
          matchesDate(filters.date, h.date) &&
          matchesNumber(filters.quantity, h.quantity),
      ),
    [all, filters],
  );

  const unverified = all.filter((h) => h.status === 'recorded').length;

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        key: 'date',
        header: tx('Date'),
        width: 92,
        mobile: 'subtitle',
        sortValue: (r) => r.date,
        searchValue: (r) => r.date,
        exportValue: (r) => r.date,
        render: (r) => <span className="num">{formatDateShort(r.date)}</span>,
      },
      {
        key: 'farmer',
        header: tx('Worker'),
        width: 190,
        mobile: 'title',
        sortValue: (r) => `${r.farmer?.lastName ?? ''}`,
        searchValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''} ${r.farmer?.code ?? ''}`,
        exportValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''}`,
        render: (r) => <span className="truncate grid__link">{r.farmer ? `${r.farmer.firstName} ${r.farmer.lastName}` : '-'}</span>,
      },
      {
        key: 'code',
        header: tx('Worker ID'),
        width: 92,
        optional: true,
        sortValue: (r) => r.farmer?.code ?? '',
        searchValue: (r) => r.farmer?.code ?? '',
        exportValue: (r) => r.farmer?.code ?? '',
        render: (r) => <span className="grid__code">{r.farmer?.code}</span>,
      },
      {
        key: 'crop',
        header: tx('Crop'),
        width: 124,
        mobile: 'cell',
        sortValue: (r) => tCrop(r.cropId, lookups.cropName(r.cropId)),
        searchValue: (r) => `${lookups.cropName(r.cropId)} ${tCrop(r.cropId, '')}`,
        exportValue: (r) => lookups.cropName(r.cropId),
        render: (r) => (
          <>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: lookups.crop.get(r.cropId)?.colour, flexShrink: 0 }} />
            <span className="truncate">{tCrop(r.cropId, lookups.cropName(r.cropId))}</span>
          </>
        ),
      },
      {
        key: 'quantity',
        header: tx('Quantity'),
        width: 112,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.quantity,
        searchValue: (r) => String(r.quantity),
        exportValue: (r) => r.quantity,
        edit: can('harvest.edit')
          ? {
              type: 'number',
              min: 0,
              value: (r) => r.quantity,
              commit: async (r, next) => {
                if (!user) return;
                const answer = await confirm({
                  title: tx('Correct the recorded quantity?'),
                  message: (
                    <>
                      <p>
                        {txr('Changing {before} to {after} changes what this worker is owed.', {
                          before: `${formatNumber(r.quantity)} ${r.unit}`,
                          after: <b>{formatNumber(Number(next))} {r.unit}</b>,
                        })}
                      </p>
                      <p className="muted" style={{ marginTop: 'var(--s-2)' }}>
                        {tx('The difference is added to or taken off what the worker is owed, so they can see exactly why it changed.')}
                      </p>
                    </>
                  ),
                  confirmLabel: tx('Post the correction'),
                  reasonLabel: tx('Reason for the correction'),
                });
                if (!answer.ok) return;
                await harvestService.correct(user, r.id, { quantity: Number(next) }, answer.reason ?? '');
                refresh();
                toast({ tone: 'success', title: tx('Harvest corrected'), message: tx('The difference was added to or taken off what the worker is owed.') });
              },
            }
          : undefined,
        render: (r) => (
          <span className="num">
            {formatNumber(r.quantity)} <span className="muted">{r.unit}</span>
          </span>
        ),
      },
      {
        key: 'price',
        header: tx('Price / unit'),
        width: 122,
        align: 'right',
        sortValue: (r) => r.pricePerUnit,
        searchValue: (r) => String(r.pricePerUnit),
        exportValue: (r) => r.pricePerUnit,
        render: (r) => <span className="num">{formatMoney(r.pricePerUnit)}</span>,
      },
      {
        key: 'gross',
        header: tx('Gross value'),
        width: 134,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.gross,
        searchValue: (r) => String(r.gross),
        exportValue: (r) => r.gross,
        render: (r) => <span className="num">{formatMoney(r.gross)}</span>,
      },
      {
        key: 'deductions',
        header: tx('Deductions'),
        width: 122,
        align: 'right',
        optional: true,
        sortValue: (r) => r.deductions,
        searchValue: (r) => String(r.deductions),
        exportValue: (r) => r.deductions,
        render: (r) => <span className="num neg">{r.deductions ? `− ${formatMoney(r.deductions)}` : '-'}</span>,
      },
      {
        key: 'net',
        header: tx('Net to worker'),
        width: 140,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.net,
        searchValue: (r) => String(r.net),
        exportValue: (r) => r.net,
        render: (r) => <span className="num strong pos">{formatMoney(r.net)}</span>,
      },
      {
        key: 'status',
        header: tx('Status'),
        width: 126,
        sortValue: (r) => r.status,
        searchValue: (r) => HARVEST_STATUS[r.status].label,
        exportValue: (r) => HARVEST_STATUS[r.status].label,
        render: (r) => <Badge meta={HARVEST_STATUS[r.status]} />,
      },
      {
        key: 'district',
        header: tx('District'),
        width: 116,
        optional: true,
        sortValue: (r) => r.farmer?.district ?? '',
        searchValue: (r) => r.farmer?.district ?? '',
        exportValue: (r) => r.farmer?.district ?? '',
        render: (r) => <span className="truncate">{r.farmer?.district}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, confirm, lookups, refresh, toast, user, tCrop],
  );

  const bulkActions = can('harvest.verify')
    ? [
        {
          label: tx('Verify'),
          icon: 'badge-check' as const,
          run: async (ids: string[]) => {
            if (!user) return;
            try {
              const n = await harvestService.setStatus(user, ids, 'verified');
              refresh();
              toast({ tone: 'success', title: tx('{n} harvest records verified', { n }) });
            } catch (e) {
              fail(e);
            }
          },
        },
        {
          label: tx('Reject'),
          icon: 'x' as const,
          tone: 'danger' as const,
          run: async (ids: string[]) => {
            const answer = await confirm({
              title: tx('Reject {length} harvest records?', { length: ids.length }),
              message: tx('Rejecting produce takes its value back off what the worker is owed. The original record stays visible.'),
              confirmLabel: tx('Reject and reverse'),
              tone: 'danger',
            });
            if (!answer.ok || !user) return;
            try {
              const n = await harvestService.setStatus(user, ids, 'rejected');
              refresh();
              toast({ tone: 'success', title: tx('{n} records rejected', { n }), message: tx('Their value was taken back off what the workers are owed.') });
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
          <h1 className="page-title">{t('prod.harvestsTitle')}</h1>
          <p className="page-sub">{t('prod.harvestsSub')}</p>
        </div>
      </div>

      {unverified > 0 && can('harvest.verify') && (
        <div style={{ marginBottom: 'var(--s-3)' }}>
          <Callout tone="warn" icon="alert">
            {txr('{records} were captured in the field and still need their weight checked. Select them and choose Verify.', {
              records: <b>{tx('{count} harvest records', { count: unverified })}</b>,
            })}
          </Callout>
        </div>
      )}

      <DataGrid
        rows={rows}
        columns={columns}
        rowId={(r) => r.id}
        loading={query.loading}
        search={search}
        storageKey="harvests"
        exportName="harvests"
        onRowClick={(r) => navigate(`/farmers/${r.farmerId}`)}
        onError={fail}
        bulkActions={bulkActions}
        emptyTitle={tx('No harvests recorded')}
        emptyMessage={tx('Record a harvest with the + button to start tracking production.')}
        toolbar={
          <FilterBar
            specs={[
              { key: 'status', label: tx('Status'), type: 'multi', options: Object.entries(HARVEST_STATUS).map(([value, m]) => ({ value, label: m.label })) },
              { key: 'crop', label: tx('Crop'), type: 'multi', options: crops.map((c) => ({ value: c.id, label: cropLabel(c) })) },
              { key: 'district', label: tx('District'), type: 'multi', options: [...new Set(all.map((r) => r.farmer?.district ?? ''))].filter(Boolean).map((d) => ({ value: d, label: d })) },
              { key: 'date', label: tx('Harvest date'), type: 'daterange' },
              { key: 'quantity', label: tx('Quantity'), type: 'numrange' },
            ]}
            values={filters}
            onChange={setFilters}
          />
        }
      />
    </>
  );
}

/* ----------------------------------------------------------------- crops */

function Crops() {
  const lookups = useLookups();
  const { t } = usePrefs();
  const totals = useQuery(() => harvestService.totalsByCrop());
  const byCrop = useQuery(() => analytics.harvestByCrop());
  const { crops } = useStore();

  const rows = totals.data ?? [];
  const grand = rows.reduce((s, r) => s + r.value, 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('prod.cropsTitle')}</h1>
          <p className="page-sub">{t('prod.cropsSub')}</p>
        </div>
      </div>

      <div className="chartgrid" style={{ marginBottom: 'var(--s-4)' }}>
        <ChartCard title={tx('Quantity by crop')} subtitle={tx('Weight-based crops in KG')}>
          <HBars data={byCrop.data ?? []} unit="KG" />
        </ChartCard>
        <ChartCard title={tx('Value by crop')} subtitle={tx('Gross value of produce received')}>
          <HBars
            data={(byCrop.data ?? []).map((d) => ({ label: d.label, value: d.secondary ?? 0, colour: d.colour }))}
            money
          />
        </ChartCard>
      </div>

      <div className="panel">
        <div style={{ overflowX: 'auto' }}>
          <table className="grid" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th><span className="th">{tx('Crop')}</span></th>
                <th><span className="th">{tx('Default unit')}</span></th>
                <th className="num"><span className="th">{tx('Price / unit')}</span></th>
                <th className="num"><span className="th">{tx('Deliveries')}</span></th>
                <th className="num"><span className="th">{tx('Quantity')}</span></th>
                <th className="num"><span className="th">{tx('Gross value')}</span></th>
                <th className="num"><span className="th">{tx('Share')}</span></th>
              </tr>
            </thead>
            <tbody>
              {crops.map((c) => {
                const t = rows.find((r) => r.cropId === c.id);
                const value = t?.value ?? 0;
                return (
                  <tr key={c.id}>
                    <td>
                      <span className="cell">
                        <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 2, background: c.colour }} />
                        <span className="strong">{c.name}</span>
                      </span>
                    </td>
                    <td><span className="cell muted">{c.defaultUnit}</span></td>
                    <td className="num"><span className="cell num">{formatMoney(c.defaultPricePerUnit)}</span></td>
                    <td className="num"><span className="cell num">{formatNumber(t?.deliveries ?? 0)}</span></td>
                    <td className="num"><span className="cell num">{t ? `${formatNumber(t.quantity)} ${t.unit}` : '-'}</span></td>
                    <td className="num"><span className="cell num strong">{value ? formatMoney(value) : '-'}</span></td>
                    <td className="num">
                      <span className="cell num">{grand > 0 ? `${Math.round((value / grand) * 100)}%` : '-'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}><span className="cell strong">{tx('Total')}</span></td>
                <td className="num"><span className="cell num strong">{formatMoney(grand)}</span></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-2)' }}>
        {tx('Quantities mix units only where they are comparable, bunches and crates are counted separately from kilograms.')}
        {lookups.crop.size > 0 ? '' : ''}
      </p>
    </>
  );
}

