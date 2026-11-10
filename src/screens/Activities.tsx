/** Every recorded activity, filterable by category, crop, status and date. */

import { useMemo, useState } from 'react';
import { useLookups, useQuery, useStore } from '../state/store';
import { navigate, useRoute } from '../state/router';
import { DataGrid, type ColumnDef } from '../components/grid/DataGrid';
import { FilterBar, matchesDate, matchesMulti, type FilterValues } from '../components/Filters';
import { Badge, Button } from '../components/ui/primitives';
import { ActivityComposer } from '../components/ActivityComposer';
import { ACTIVITY_STATUS } from '../domain/status';
import { CATEGORY_META } from '../domain/activityCatalog';
import { formatMoney, formatNumber } from '../domain/money';
import { formatDateShort } from '../lib/date';
import { db } from '../db/db';
import * as activityService from '../services/activityService';
import type { Activity, ActivityCategory, Farmer } from '../domain/types';
import { usePrefs } from '../i18n';

import { cropLabel, translated, tx } from '../i18n/tx';
interface Row extends Activity {
  farmer?: Farmer;
}

const SECTION: Record<string, { title: string; blurb: string; categories: ActivityCategory[] }> = translated({
  farming: {
    title: 'Farming activities',
    blurb: 'Land preparation through to crop monitoring. Everything before the harvest.',
    categories: ['farming'],
  },
  harvest: {
    title: 'Harvesting activities',
    blurb: 'Collection, grading, weighing, storage and delivery.',
    categories: ['harvest'],
  },
  other: {
    title: 'Other activities',
    blurb: 'Operations, logistics, financial records, training and visits.',
    categories: ['operations', 'logistics', 'financial', 'other'],
  },
});

export function Activities({ search }: { search: string }) {
  const route = useRoute();
  const { user, can, crops, refresh, toast, fail } = useStore();
  const lookups = useLookups();
  const { t, tActivity, tCrop } = usePrefs();
  const [filters, setFilters] = useState<FilterValues>({});
  const [composer, setComposer] = useState(false);

  const section = route.segments[1] ? SECTION[route.segments[1]] : undefined;

  const query = useQuery(async () => {
    const [activities, farmers] = await Promise.all([activityService.listActivities(), db.farmers.toArray()]);
    const byId = new Map(farmers.map((f) => [f.id, f]));
    return activities.map<Row>((a) => ({ ...a, farmer: byId.get(a.farmerId) }));
  });

  const all = query.data ?? [];

  const rows = useMemo(() => {
    let list = all;
    if (section) list = list.filter((a) => section.categories.includes(a.category));
    return list.filter(
      (a) =>
        matchesMulti(filters.category, a.category) &&
        matchesMulti(filters.status, a.status) &&
        matchesMulti(filters.crop, a.cropId) &&
        matchesDate(filters.date, a.date),
    );
  }, [all, filters, section]);

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
        sortValue: (r) => `${r.farmer?.lastName ?? ''} ${r.farmer?.firstName ?? ''}`,
        searchValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''} ${r.farmer?.code ?? ''}`,
        exportValue: (r) => `${r.farmer?.firstName ?? ''} ${r.farmer?.lastName ?? ''}`,
        render: (r) => (
          <span className="truncate grid__link">
            {r.farmer ? `${r.farmer.firstName} ${r.farmer.lastName}` : 'Unknown'}
          </span>
        ),
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
        key: 'type',
        header: tx('Activity'),
        width: 172,
        mobile: 'cell',
        sortValue: (r) => tActivity(r.typeId, lookups.typeLabel(r.typeId)),
        searchValue: (r) => `${lookups.typeLabel(r.typeId)} ${tActivity(r.typeId, '')}`,
        exportValue: (r) => lookups.typeLabel(r.typeId),
        render: (r) => <span className="truncate strong">{tActivity(r.typeId, lookups.typeLabel(r.typeId))}</span>,
      },
      {
        key: 'category',
        header: tx('Category'),
        width: 130,
        sortValue: (r) => r.category,
        searchValue: (r) => CATEGORY_META[r.category].label,
        exportValue: (r) => CATEGORY_META[r.category].label,
        render: (r) => <span className="chip" style={{ height: 21 }}>{t(`cat.${r.category}`)}</span>,
      },
      {
        key: 'crop',
        header: tx('Crop'),
        width: 116,
        mobile: 'cell',
        sortValue: (r) => tCrop(r.cropId, lookups.cropName(r.cropId)),
        searchValue: (r) => `${lookups.cropName(r.cropId)} ${tCrop(r.cropId, '')}`,
        exportValue: (r) => (r.cropId ? lookups.cropName(r.cropId) : ''),
        render: (r) =>
          r.cropId ? (
            <span className="truncate">{tCrop(r.cropId, lookups.cropName(r.cropId))}</span>
          ) : (
            <span className="muted">-</span>
          ),
      },
      {
        key: 'quantity',
        header: tx('Quantity'),
        width: 106,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => Number(r.data.quantity ?? 0),
        searchValue: (r) => String(r.data.quantity ?? ''),
        exportValue: (r) => Number(r.data.quantity ?? 0) || '',
        render: (r) =>
          r.data.quantity ? (
            <span className="num">
              {formatNumber(Number(r.data.quantity))} {r.data.unit ?? ''}
            </span>
          ) : (
            <span className="muted">-</span>
          ),
      },
      {
        key: 'value',
        header: tx('Value'),
        width: 130,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => Number(r.data.grossValue ?? r.data.amount ?? 0),
        searchValue: (r) => String(r.data.grossValue ?? r.data.amount ?? ''),
        exportValue: (r) => Number(r.data.grossValue ?? r.data.amount ?? 0) || '',
        render: (r) => {
          const v = Number(r.data.grossValue ?? r.data.amount ?? 0);
          return v > 0 ? <span className="num">{formatMoney(v)}</span> : <span className="muted">-</span>;
        },
      },
      {
        key: 'status',
        header: tx('Status'),
        width: 132,
        mobile: 'badge',
        sortValue: (r) => r.status,
        searchValue: (r) => ACTIVITY_STATUS[r.status].label,
        exportValue: (r) => ACTIVITY_STATUS[r.status].label,
        render: (r) => <Badge meta={ACTIVITY_STATUS[r.status]} />,
      },
      {
        key: 'posted',
        header: tx('Ledger'),
        width: 100,
        sortValue: (r) => (r.transactionId ? 1 : 0),
        searchValue: (r) => (r.transactionId ? 'posted' : ''),
        exportValue: (r) => (r.transactionId ? 'posted' : ''),
        render: (r) =>
          r.transactionId ? (
            <span className="badge badge--purple" title={tx('This activity posted a ledger transaction')}>
              <span className="badge__glyph">₣</span>
              {tx('Posted')}
            </span>
          ) : (
            <span className="muted">-</span>
          ),
      },
      {
        key: 'by',
        header: tx('Recorded by'),
        width: 150,
        optional: true,
        sortValue: (r) => lookups.userName(r.createdBy),
        searchValue: (r) => lookups.userName(r.createdBy),
        exportValue: (r) => lookups.userName(r.createdBy),
        render: (r) => <span className="muted truncate">{lookups.userName(r.createdBy)}</span>,
      },
      {
        key: 'notes',
        header: tx('Notes'),
        width: 220,
        optional: true,
        searchValue: (r) => r.notes ?? '',
        exportValue: (r) => r.notes ?? '',
        sortValue: (r) => r.notes ?? '',
        render: (r) => <span className="truncate muted">{r.notes ?? '-'}</span>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lookups, t, tActivity, tCrop],
  );

  const bulkActions = can('activity.verify')
    ? [
        {
          label: tx('Mark verified'),
          icon: 'badge-check' as const,
          run: async (ids: string[]) => {
            if (!user) return;
            try {
              const n = await activityService.setActivityStatus(user, ids, 'verified');
              refresh();
              toast({ tone: 'success', title: tx('{n} activities verified', { n }) });
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
          <h1 className="page-title">{section?.title ?? tx('All activities')}</h1>
          <p className="page-sub">
            {section?.blurb ?? tx('Everything recorded against a worker, newest first. Click a row to open the worker.')}
          </p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setComposer(true)}>
          {tx('Record activity')}
        </Button>
      </div>

      <DataGrid
        rows={rows}
        columns={columns}
        rowId={(r) => r.id}
        loading={query.loading}
        search={search}
        storageKey={`activities-${route.segments[1] ?? 'all'}`}
        exportName="activities"
        onRowClick={(r) => navigate(`/farmers/${r.farmerId}`)}
        onError={fail}
        bulkActions={bulkActions}
        emptyTitle={tx('No activities recorded')}
        emptyMessage={tx('Use the + button to record farming, harvest, logistics or financial activity.')}
        emptyAction={<Button variant="primary" icon="plus" onClick={() => setComposer(true)}>{tx('Record activity')}</Button>}
        toolbar={
          <FilterBar
            specs={[
              ...(section
                ? []
                : ([{
                    key: 'category',
                    label: tx('Category'),
                    type: 'multi' as const,
                    options: Object.entries(CATEGORY_META).map(([value, m]) => ({ value, label: m.label })),
                  }])),
              { key: 'status', label: tx('Status'), type: 'multi', options: Object.entries(ACTIVITY_STATUS).map(([value, m]) => ({ value, label: m.label })) },
              { key: 'crop', label: tx('Crop'), type: 'multi', options: crops.map((c) => ({ value: c.id, label: cropLabel(c) })) },
              { key: 'date', label: tx('Date'), type: 'daterange' },
            ]}
            values={filters}
            onChange={setFilters}
          />
        }
      />

      <ActivityComposer open={composer} onClose={() => setComposer(false)} />
    </>
  );
}
