/** Harvests, crop performance and quality. */

import { useMemo, useState } from 'react';
import { useLookups, useQuery, useStore } from '../state/store';
import { navigate, useRoute } from '../state/router';
import { DataGrid, type ColumnDef } from '../components/grid/DataGrid';
import { FilterBar, matchesDate, matchesMulti, matchesNumber, type FilterValues } from '../components/Filters';
import { Badge, Callout } from '../components/ui/primitives';
import { ChartCard, HBars, Meter } from '../components/charts';
import { formatMoney, formatNumber } from '../domain/money';
import { GRADE_META, HARVEST_STATUS } from '../domain/status';
import { formatDateShort } from '../lib/date';
import { db } from '../db/db';
import * as harvestService from '../services/harvestService';
import * as analytics from '../services/analyticsService';
import type { Farmer, QualityGrade } from '../domain/types';
import { usePrefs } from '../i18n';

interface Row extends harvestService.HarvestRow {
  farmer?: Farmer;
}

export function Production({ search }: { search: string }) {
  const route = useRoute();
  const sub = route.segments[1] ?? 'harvests';

  if (sub === 'crops') return <Crops />;
  if (sub === 'quality') return <Quality />;
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
          matchesMulti(filters.grade, h.grade) &&
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
        header: 'Date',
        width: 92,
        mobile: 'subtitle',
        sortValue: (r) => r.date,
        searchValue: (r) => r.date,
        exportValue: (r) => r.date,
        render: (r) => <span className="num">{formatDateShort(r.date)}</span>,
      },
      {
        key: 'farmer',
        header: 'Farmer',
        width: 190,
        mobile: 'title',
        sortValue: (r) => `${r.farmer?.lastName ?? ''}`,
        searchValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''} ${r.farmer?.code ?? ''}`,
        exportValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''}`,
        render: (r) => <span className="truncate grid__link">{r.farmer ? `${r.farmer.firstName} ${r.farmer.lastName}` : '-'}</span>,
      },
      {
        key: 'code',
        header: 'Farmer ID',
        width: 92,
        optional: true,
        sortValue: (r) => r.farmer?.code ?? '',
        searchValue: (r) => r.farmer?.code ?? '',
        exportValue: (r) => r.farmer?.code ?? '',
        render: (r) => <span className="grid__code">{r.farmer?.code}</span>,
      },
      {
        key: 'crop',
        header: 'Crop',
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
        header: 'Quantity',
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
                  title: 'Correct the recorded quantity?',
                  message: (
                    <>
                      <p>
                        Changing {formatNumber(r.quantity)} {r.unit} to <b>{formatNumber(Number(next))} {r.unit}</b> changes
                        what this farmer is owed.
                      </p>
                      <p className="muted" style={{ marginTop: 'var(--s-2)' }}>
                        A balancing ledger entry is posted so the farmer can see exactly why their balance moved.
                      </p>
                    </>
                  ),
                  confirmLabel: 'Post the correction',
                  reasonLabel: 'Reason for the correction',
                });
                if (!answer.ok) return;
                await harvestService.correct(user, r.id, { quantity: Number(next) }, answer.reason ?? '');
                refresh();
                toast({ tone: 'success', title: 'Harvest corrected', message: 'A balancing entry was posted to the ledger.' });
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
        key: 'grade',
        header: 'Grade',
        width: 110,
        mobile: 'badge',
        sortValue: (r) => r.grade,
        searchValue: (r) => GRADE_META[r.grade].label,
        exportValue: (r) => r.grade,
        edit: can('harvest.edit')
          ? {
              type: 'select',
              options: (['A', 'B', 'C', 'REJECT'] as QualityGrade[]).map((g) => ({ value: g, label: GRADE_META[g].label })),
              value: (r) => r.grade,
              commit: async (r, next) => {
                if (!user) return;
                await harvestService.correct(user, r.id, { grade: next as QualityGrade }, 'Grade reassessed at intake');
                refresh();
              },
            }
          : undefined,
        render: (r) => <Badge meta={GRADE_META[r.grade]} />,
      },
      {
        key: 'price',
        header: 'Price / unit',
        width: 122,
        align: 'right',
        sortValue: (r) => r.pricePerUnit,
        searchValue: (r) => String(r.pricePerUnit),
        exportValue: (r) => r.pricePerUnit,
        render: (r) => <span className="num">{formatMoney(r.pricePerUnit)}</span>,
      },
      {
        key: 'gross',
        header: 'Gross value',
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
        header: 'Deductions',
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
        header: 'Net to farmer',
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
        header: 'Status',
        width: 126,
        sortValue: (r) => r.status,
        searchValue: (r) => HARVEST_STATUS[r.status].label,
        exportValue: (r) => HARVEST_STATUS[r.status].label,
        render: (r) => <Badge meta={HARVEST_STATUS[r.status]} />,
      },
      {
        key: 'district',
        header: 'District',
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
          label: 'Verify',
          icon: 'badge-check' as const,
          run: async (ids: string[]) => {
            if (!user) return;
            try {
              const n = await harvestService.setStatus(user, ids, 'verified');
              refresh();
              toast({ tone: 'success', title: `${n} harvest records verified` });
            } catch (e) {
              fail(e);
            }
          },
        },
        {
          label: 'Reject',
          icon: 'x' as const,
          tone: 'danger' as const,
          run: async (ids: string[]) => {
            const answer = await confirm({
              title: `Reject ${ids.length} harvest records?`,
              message:
                'Rejecting produce that was already credited reverses that credit with a ledger entry. The original record stays visible.',
              confirmLabel: 'Reject and reverse',
              tone: 'danger',
            });
            if (!answer.ok || !user) return;
            try {
              const n = await harvestService.setStatus(user, ids, 'rejected');
              refresh();
              toast({ tone: 'success', title: `${n} records rejected`, message: 'Credits were reversed in the ledger.' });
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
            <b>{unverified} harvest records</b> were captured in the field and still need a weight and grade check. Select
            them and choose Verify.
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
        emptyTitle="No harvests recorded"
        emptyMessage="Record a harvest with the + button to start tracking production."
        toolbar={
          <FilterBar
            specs={[
              { key: 'status', label: 'Status', type: 'multi', options: Object.entries(HARVEST_STATUS).map(([value, m]) => ({ value, label: m.label })) },
              { key: 'grade', label: 'Grade', type: 'multi', options: Object.entries(GRADE_META).map(([value, m]) => ({ value, label: m.label })) },
              { key: 'crop', label: 'Crop', type: 'multi', options: crops.map((c) => ({ value: c.id, label: c.name })) },
              { key: 'district', label: 'District', type: 'multi', options: [...new Set(all.map((r) => r.farmer?.district ?? ''))].filter(Boolean).map((d) => ({ value: d, label: d })) },
              { key: 'date', label: 'Harvest date', type: 'daterange' },
              { key: 'quantity', label: 'Quantity', type: 'numrange' },
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
        <ChartCard title="Quantity by crop" subtitle="Weight-based crops in KG">
          <HBars data={byCrop.data ?? []} unit="KG" />
        </ChartCard>
        <ChartCard title="Value by crop" subtitle="Gross value of produce received">
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
                <th><span className="th">Crop</span></th>
                <th><span className="th">Default unit</span></th>
                <th className="num"><span className="th">Price / unit</span></th>
                <th className="num"><span className="th">Deliveries</span></th>
                <th className="num"><span className="th">Quantity</span></th>
                <th className="num"><span className="th">Gross value</span></th>
                <th className="num"><span className="th">Share</span></th>
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
                <td colSpan={5}><span className="cell strong">Total</span></td>
                <td className="num"><span className="cell num strong">{formatMoney(grand)}</span></td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--s-2)' }}>
        Quantities mix units only where they are comparable, bunches and crates are counted separately from kilograms.
        {lookups.crop.size > 0 ? '' : ''}
      </p>
    </>
  );
}

/* --------------------------------------------------------------- quality */

function Quality() {
  const { t } = usePrefs();
  const query = useQuery(async () => harvestService.list());
  const rows = query.data ?? [];

  const byGrade = (['A', 'B', 'C', 'REJECT'] as QualityGrade[]).map((g) => {
    const set = rows.filter((r) => r.grade === g);
    return {
      grade: g,
      count: set.length,
      quantity: set.reduce((s, r) => s + r.quantity, 0),
      value: set.reduce((s, r) => s + r.gross, 0),
    };
  });

  const total = rows.length;
  const premium = byGrade[0]?.count ?? 0;
  const verified = rows.filter((r) => r.status === 'verified').length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('prod.qualityTitle')}</h1>
          <p className="page-sub">{t('prod.qualitySub')}</p>
        </div>
      </div>

      <div className="chartgrid">
        <ChartCard title="Deliveries by grade" subtitle="Number of deliveries in each grade">
          <HBars
            data={byGrade.map((g) => ({
              label: GRADE_META[g.grade].label,
              value: g.count,
              colour: g.grade === 'A' ? 'var(--c-green-600)' : g.grade === 'B' ? 'var(--c-teal-600)' : g.grade === 'C' ? 'var(--c-amber-600)' : 'var(--c-red-600)',
            }))}
            unit=""
          />
        </ChartCard>

        <ChartCard title="Premium share" subtitle="Grade A as a share of all deliveries">
          <Meter value={premium} total={total} label={`${premium} of ${total} deliveries are Grade A`} caption="Higher grades earn a higher price per unit." />
        </ChartCard>

        <ChartCard title="Verification progress" subtitle="Deliveries checked at intake">
          <Meter
            value={verified}
            total={total}
            label={`${verified} of ${total} verified`}
            caption="Unverified rows are field entries awaiting a weight and grade check."
            colour="var(--c-teal-600)"
          />
        </ChartCard>

        <ChartCard title="Value by grade" subtitle="Gross value received per grade">
          <HBars
            data={byGrade.map((g) => ({
              label: GRADE_META[g.grade].label,
              value: g.value,
              colour: g.grade === 'A' ? 'var(--c-green-600)' : g.grade === 'B' ? 'var(--c-teal-600)' : g.grade === 'C' ? 'var(--c-amber-600)' : 'var(--c-red-600)',
            }))}
            money
          />
        </ChartCard>
      </div>
    </>
  );
}
