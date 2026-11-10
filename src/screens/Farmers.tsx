/**
 * The farmer register. The screen the spec calls the Excel-inspired table.
 *
 * One row per farmer, carrying what they are doing, what they delivered, and
 * what they are owed, so the four questions a manager asks (who farms, who
 * harvested, who is owed, who is paid) are answerable without leaving it.
 *
 * The money columns are read-only by design. A balance is folded from the
 * ledger, so letting someone type over it would be letting them lie; the way
 * to change it is to record a transaction, which the "+" button does.
 */

import { useMemo, useState } from 'react';
import { useQuery, useLookups, useStore } from '../state/store';
import { navigate, useRoute } from '../state/router';
import { DataGrid, type ColumnDef } from '../components/grid/DataGrid';
import { FilterBar, matchesDate, matchesMulti, matchesNumber, type FilterValues } from '../components/Filters';
import { Badge, Button, Callout, Field, IconButton, Input, Select } from '../components/ui/primitives';
import { Modal } from '../components/ui/Modal';
import { Icon } from '../components/ui/Icon';
import { ActivityComposer } from '../components/ActivityComposer';
import { formatMoney, formatNumber } from '../domain/money';
import { FARMER_STATUS } from '../domain/status';
import { formatDateShort, today } from '../lib/date';
import { db } from '../db/db';
import * as farmerService from '../services/farmerService';
import * as paymentService from '../services/paymentService';
import { parseCSV, readFileText } from '../lib/csv';
import type { Activity, Farmer, FarmerStatus, Harvest } from '../domain/types';
import { usePrefs } from '../i18n';

import { cropLabel, tx } from '../i18n/tx';
import { txr } from '../i18n/rich';
import * as groupService from '../services/groupService';
import * as cloud from '../cloud/account';
interface Row extends farmerService.FarmerRow {
  latestActivity?: Activity;
  latestHarvest?: Harvest;
  totalQuantity: number;
  unit: string;
  deliveries: number;
}

export function Farmers({ search }: { search: string }) {
  const route = useRoute();
  const { t, tActivity, tCrop } = usePrefs();
  const { user, can, crops, cooperatives, refresh, toast, fail, confirm } = useStore();
  const lookups = useLookups();

  const [filters, setFilters] = useState<FilterValues>({});
  const [composer, setComposer] = useState<{ open: boolean; farmerId?: string }>({ open: false });
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Farmer | null>(null);
  const removeFarmer = useRemoveFarmer();
  const [importOpen, setImportOpen] = useState(false);

  const onlyActive = route.segments[1] === 'active';
  const groups = route.segments[1] === 'groups';
  /* Opened from a group card: show only that group's farmers. */
  const coopId = route.query.get('coop');
  const coop = coopId ? cooperatives.find((c) => c.id === coopId) : undefined;

  const query = useQuery(async () => {
    const [rows, activities, harvests] = await Promise.all([
      farmerService.listWithFinancials(),
      db.activities.toArray(),
      db.harvests.toArray(),
    ]);

    const latestAct = new Map<string, Activity>();
    for (const a of activities) {
      const prev = latestAct.get(a.farmerId);
      if (!prev || a.date > prev.date) latestAct.set(a.farmerId, a);
    }

    const perFarmer = new Map<string, { qty: number; unit: string; count: number; latest?: Harvest }>();
    for (const h of harvests) {
      if (h.status === 'rejected') continue;
      const e = perFarmer.get(h.farmerId) ?? { qty: 0, unit: h.unit, count: 0 };
      e.qty += h.quantity;
      e.count += 1;
      if (!e.latest || h.date > e.latest.date) e.latest = h;
      perFarmer.set(h.farmerId, e);
    }

    return rows.map<Row>((f) => {
      const h = perFarmer.get(f.id);
      return {
        ...f,
        latestActivity: latestAct.get(f.id),
        latestHarvest: h?.latest,
        totalQuantity: h?.qty ?? 0,
        unit: h?.unit ?? '',
        deliveries: h?.count ?? 0,
      };
    });
  });

  const all = query.data ?? [];

  const rows = useMemo(() => {
    let list = all;
    if (onlyActive) list = list.filter((r) => r.status !== 'inactive');

    return list.filter(
      (r) =>
        (!coopId || r.cooperativeId === coopId) &&
        matchesMulti(filters.status, r.status) &&
        matchesMulti(filters.crop, r.primaryCropId) &&
        matchesMulti(filters.district, r.district) &&
        matchesMulti(filters.cooperative, r.cooperativeId) &&
        matchesMulti(filters.activity, r.latestActivity?.category) &&
        matchesDate(filters.date, r.latestHarvest?.date ?? r.latestActivity?.date ?? null) &&
        matchesNumber(filters.quantity, r.totalQuantity) &&
        matchesNumber(filters.balance, r.financials.balance) 
    );
  }, [all, filters, onlyActive, coopId]);

  /* ---------------------------------------------------------- columns */

  const activityLabel = (r: Row) =>
    r.latestActivity ? tActivity(r.latestActivity.typeId, lookups.typeLabel(r.latestActivity.typeId)) : '-';

  const columns = useMemo<ColumnDef<Row>[]>(
    () => [
      {
        key: 'name',
        header: t('field.farmer'),
        width: 208,
        mobile: 'title',
        sortValue: (r) => `${r.lastName} ${r.firstName}`,
        searchValue: (r) => `${r.firstName} ${r.lastName} ${r.code} ${r.phone} ${r.village} ${r.idNumber ?? ''}`,
        exportValue: (r) => `${r.firstName} ${r.lastName}`,
        render: (r) => (
          <>
            <span className="avatar" style={{ width: 24, height: 24, fontSize: 9 }} aria-hidden="true">
              {r.firstName[0]}
              {r.lastName[0]}
            </span>
            <span className="truncate grid__link" title={`${r.firstName} ${r.lastName}`}>
              {r.firstName} {r.lastName}
            </span>
          </>
        ),
      },
      {
        key: 'code',
        header: t('field.farmerId'),
        width: 110,
        mobile: 'subtitle',
        sortValue: (r) => r.code,
        searchValue: (r) => r.code,
        exportValue: (r) => r.code,
        edit: can('farmer.edit')
          ? {
              type: 'text',
              value: (r) => r.code,
              commit: async (r, next) => {
                if (!user) return;
                // Rejected if it collides: two farmers sharing an ID is how a
                // payment reaches the wrong person.
                await farmerService.update(user, r.id, { code: next });
                refresh();
                toast({ tone: 'success', title: tx('Worker ID changed to {v}', { v: next.trim() }) });
              },
            }
          : undefined,
        render: (r) => <span className="grid__code">{r.code}</span>,
      },
      {
        key: 'idNumber',
        header: t('field.idNumber'),
        width: 170,
        optional: true,
        sortValue: (r) => r.idNumber ?? '',
        searchValue: (r) => r.idNumber ?? '',
        exportValue: (r) => r.idNumber ?? '',
        edit: can('farmer.edit')
          ? {
              type: 'text',
              value: (r) => r.idNumber ?? '',
              commit: async (r, next) => {
                if (!user) return;
                await farmerService.update(user, r.id, { idNumber: next.trim() || undefined });
                refresh();
              },
            }
          : undefined,
        render: (r) => (r.idNumber ? <span className="num truncate">{r.idNumber}</span> : <span className="muted">-</span>),
      },
      {
        key: 'activity',
        header: t('field.activity'),
        width: 140,
        mobile: 'cell',
        sortValue: (r) => activityLabel(r),
        searchValue: (r) => activityLabel(r),
        // Exports keep the English catalog name so a spreadsheet shared between
        // a Kinyarwanda and an English user still reconciles column for column.
        exportValue: (r) => (r.latestActivity ? lookups.typeLabel(r.latestActivity.typeId) : ''),
        render: (r) =>
          r.latestActivity ? <span className="truncate">{activityLabel(r)}</span> : <span className="muted">-</span>,
      },
      {
        key: 'crop',
        header: t('field.crop'),
        width: 120,
        mobile: 'cell',
        sortValue: (r) => tCrop(r.primaryCropId, lookups.cropName(r.primaryCropId)),
        searchValue: (r) => r.crops.map((c) => `${lookups.cropName(c)} ${tCrop(c, '')}`).join(' '),
        exportValue: (r) => lookups.cropName(r.primaryCropId),
        edit: can('farmer.edit')
          ? {
              type: 'select',
              options: crops.map((c) => ({ value: c.id, label: cropLabel(c) })),
              value: (r) => r.primaryCropId,
              commit: async (r, next) => {
                if (!user) return;
                await farmerService.update(user, r.id, { primaryCropId: next });
                refresh();
                toast({ tone: 'success', title: tx('Primary crop updated'), message: `${r.code} → ${lookups.cropName(next)}` });
              },
            }
          : undefined,
        render: (r) => (
          <>
            <span
              aria-hidden="true"
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: lookups.crop.get(r.primaryCropId)?.colour ?? 'var(--c-faint)',
                flexShrink: 0,
              }}
            />
            <span className="truncate">{tCrop(r.primaryCropId, lookups.cropName(r.primaryCropId))}</span>
          </>
        ),
      },
      {
        key: 'quantity',
        header: t('field.quantity'),
        width: 104,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.totalQuantity,
        searchValue: (r) => String(r.totalQuantity),
        exportValue: (r) => r.totalQuantity,
        render: (r) => (r.totalQuantity > 0 ? <span className="num">{formatNumber(r.totalQuantity)}</span> : <span className="muted">-</span>),
      },
      {
        key: 'unit',
        header: tx('Unit'),
        width: 68,
        optional: true,
        sortValue: (r) => r.unit,
        searchValue: (r) => r.unit,
        exportValue: (r) => r.unit,
        render: (r) => <span className="muted">{r.unit || '-'}</span>,
      },
      {
        key: 'date',
        header: t('field.lastActivity'),
        width: 108,
        mobile: 'cell',
        sortValue: (r) => r.latestHarvest?.date ?? r.latestActivity?.date ?? '',
        searchValue: (r) => r.latestActivity?.date ?? '',
        exportValue: (r) => r.latestHarvest?.date ?? r.latestActivity?.date ?? '',
        render: (r) => {
          const d = r.latestHarvest?.date ?? r.latestActivity?.date;
          return d ? <span className="num">{formatDateShort(d)}</span> : <span className="muted">-</span>;
        },
      },
      {
        key: 'status',
        header: t('field.status'),
        width: 148,
        mobile: 'badge',
        sortValue: (r) => r.status,
        searchValue: (r) => FARMER_STATUS[r.status].label,
        exportValue: (r) => FARMER_STATUS[r.status].label,
        edit: can('farmer.edit')
          ? {
              type: 'select',
              options: Object.entries(FARMER_STATUS).map(([value, m]) => ({ value, label: m.label })),
              value: (r) => r.status,
              commit: async (r, next) => {
                if (!user) return;
                await farmerService.setStatus(user, [r.id], next as FarmerStatus);
                refresh();
              },
            }
          : undefined,
        render: (r) => <Badge meta={FARMER_STATUS[r.status]} />,
      },
      {
        key: 'earned',
        header: t('field.amountEarned'),
        width: 136,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.financials.earned,
        searchValue: (r) => String(r.financials.earned),
        exportValue: (r) => r.financials.earned,
        render: (r) => (r.financials.earned > 0 ? <span className="num">{formatMoney(r.financials.earned)}</span> : <span className="muted">-</span>),
      },
      {
        key: 'paid',
        header: tx('Paid'),
        width: 126,
        align: 'right',
        optional: true,
        sortValue: (r) => r.financials.paid,
        exportValue: (r) => r.financials.paid,
        searchValue: (r) => String(r.financials.paid),
        render: (r) => <span className="num">{r.financials.paid > 0 ? formatMoney(r.financials.paid) : '-'}</span>,
      },
      {
        key: 'advances',
        header: tx('Advances'),
        width: 118,
        align: 'right',
        optional: true,
        sortValue: (r) => r.financials.advances,
        exportValue: (r) => r.financials.advances,
        searchValue: (r) => String(r.financials.advances),
        render: (r) => <span className="num">{r.financials.advances > 0 ? formatMoney(r.financials.advances) : '-'}</span>,
      },
      {
        key: 'balance',
        header: t('field.balance'),
        width: 138,
        align: 'right',
        mobile: 'cell',
        sortValue: (r) => r.financials.balance,
        searchValue: (r) => String(r.financials.balance),
        exportValue: (r) => r.financials.balance,
        render: (r) => {
          const b = r.financials.balance;
          if (b === 0) return <span className="muted">{tx('Settled')}</span>;
          return <span className={`num ${b > 0 ? 'pos' : 'neg'}`}>{formatMoney(b)}</span>;
        },
      },
      {
        key: 'payment',
        header: t('field.paymentStatus'),
        width: 148,
        sortValue: (r) => t(paymentLabel(r).labelKey),
        searchValue: (r) => t(paymentLabel(r).labelKey),
        exportValue: (r) => t(paymentLabel(r).labelKey),
        render: (r) => {
          const p = paymentLabel(r);
          return <Badge meta={{ ...p, label: t(p.labelKey), help: t(p.helpKey) }} />;
        },
      },
      {
        key: 'district',
        header: t('field.district'),
        width: 118,
        optional: true,
        sortValue: (r) => r.district,
        searchValue: (r) => `${r.district} ${r.sector} ${r.cell} ${r.village}`,
        exportValue: (r) => r.district,
        render: (r) => <span className="truncate">{r.district}</span>,
      },
      {
        key: 'village',
        header: t('field.village'),
        width: 118,
        optional: true,
        sortValue: (r) => r.village,
        searchValue: (r) => r.village,
        exportValue: (r) => r.village,
        render: (r) => <span className="truncate">{r.village}</span>,
      },
      {
        key: 'cooperative',
        header: t('field.cooperative'),
        width: 190,
        optional: true,
        sortValue: (r) => lookups.coopName(r.cooperativeId),
        searchValue: (r) => lookups.coopName(r.cooperativeId),
        exportValue: (r) => lookups.coopName(r.cooperativeId),
        render: (r) => <span className="truncate">{lookups.coopName(r.cooperativeId)}</span>,
      },
      {
        key: 'phone',
        header: t('field.phone'),
        width: 140,
        optional: true,
        searchValue: (r) => r.phone,
        exportValue: (r) => r.phone,
        sortValue: (r) => r.phone,
        edit: can('farmer.edit')
          ? {
              type: 'text',
              value: (r) => r.phone,
              commit: async (r, next) => {
                if (!user) return;
                await farmerService.update(user, r.id, { phone: next });
                refresh();
              },
            }
          : undefined,
        render: (r) => <span className="num truncate">{r.phone}</span>,
      },
      {
        key: 'farmSize',
        header: tx('Farm size'),
        width: 100,
        align: 'right',
        optional: true,
        sortValue: (r) => r.farmSizeHa,
        exportValue: (r) => r.farmSizeHa,
        searchValue: (r) => String(r.farmSizeHa),
        edit: can('farmer.edit')
          ? {
              type: 'number',
              min: 0,
              value: (r) => r.farmSizeHa,
              commit: async (r, next) => {
                if (!user) return;
                await farmerService.update(user, r.id, { farmSizeHa: Number(next) });
                refresh();
              },
            }
          : undefined,
        render: (r) => <span className="num">{r.farmSizeHa} ha</span>,
      },
      {
        key: 'season',
        header: tx('Season'),
        width: 92,
        optional: true,
        sortValue: (r) => r.season,
        searchValue: (r) => r.season,
        exportValue: (r) => r.season,
        render: (r) => <span className="muted">{r.season}</span>,
      },
      ...(can('farmer.edit') || can('farmer.archive')
        ? [
            {
              key: 'actions',
              header: tx('Actions'),
              width: 96,
              mobile: 'cell' as const,
              render: (r: Row) => (
                // Buttons stop the click so the row does not also open the profile.
                <span className="row gap-1" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                  {can('farmer.edit') && (
                    <IconButton icon="edit" size={16} label={tx('Edit {name}', { name: `${r.firstName} ${r.lastName}` })} onClick={() => setEditing(r)} />
                  )}
                  {can('farmer.archive') && (
                    <IconButton icon="trash" size={16} label={tx('Delete {name}', { name: `${r.firstName} ${r.lastName}` })} onClick={() => void removeFarmer(r)} />
                  )}
                </span>
              ),
            },
          ]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [can, crops, lookups, refresh, toast, user, t, tActivity, tCrop],
  );

  /* ------------------------------------------------------ bulk actions */

  const bulkActions = useMemo(() => {
    const actions = [];

    if (can('batch.create')) {
      actions.push({
        label: tx('Create payment batch'),
        icon: 'layers' as const,
        run: async (ids: string[]) => {
          const owed = all.filter((r) => ids.includes(r.id) && r.financials.balance > 0);
          if (owed.length === 0) {
            toast({ tone: 'warn', title: tx('Nobody in that selection is owed money'), message: tx('A batch only includes workers with a positive balance.') });
            return;
          }
          const total = owed.reduce((s, r) => s + r.financials.balance, 0);
          const answer = await confirm({
            title: tx('Create a payment batch'),
            message: (
              <>
                <p>
                  {txr('This creates pending payments for {farmers} totalling {amount}.', {
                    farmers: <b>{tx('{count} workers', { count: owed.length })}</b>,
                    amount: <b>{formatMoney(total)}</b>,
                  })}
                </p>
                <p style={{ marginTop: 'var(--s-2)' }} className="muted">
                  {tx('Each amount comes from that worker’s ledger balance. Nothing is paid until the batch is approved and settled.')}
                </p>
              </>
            ),
            confirmLabel: tx('Create batch for {length} workers', { length: owed.length }),
          });
          if (!answer.ok || !user) return;
          try {
            const { batch } = await paymentService.createBatch(user, {
              name: tx('Payment batch, {date}', { date: today() }),
              farmerIds: owed.map((r) => r.id),
            });
            refresh();
            toast({
              tone: 'success',
              title: tx('Payment batch created'),
              message: tx('{code} · {length} workers', { code: batch.code, length: owed.length }),
              action: { label: tx('Open'), run: () => navigate(`/payments/batches/${batch.id}`) },
            });
          } catch (e) {
            fail(e);
          }
        },
      });
    }

    if (can('farmer.edit')) {
      actions.push({
        label: tx('Set status'),
        icon: 'tag' as const,
        run: async (ids: string[]) => {
          const answer = await confirm({
            title: tx('Mark {length} workers as active', { length: ids.length }),
            message: tx('Status normally follows the records automatically. Setting it by hand is useful for correcting a stale row.'),
            confirmLabel: tx('Mark as active'),
          });
          if (!answer.ok || !user) return;
          try {
            await farmerService.setStatus(user, ids, 'active');
            refresh();
            toast({ tone: 'success', title: tx('{length} workers updated', { length: ids.length }) });
          } catch (e) {
            fail(e);
          }
        },
      });
    }

    return actions;
  }, [all, can, confirm, fail, refresh, toast, user]);

  if (groups) return <FarmerGroups rows={all} />;

  return (
    <>
      <FarmersTabs />
      <div className="page-head">
        <div>
          <h1 className="page-title">{coop ? coop.name : onlyActive ? t('nav.farmers.active') : t('screen.farmers.title')}</h1>
          <p className="page-sub">
            {coop ? `${t('nav.farmers.groups')} · ${coop.district}` : t('screen.farmers.sub')}
          </p>
        </div>
        <div className="row gap-2 no-print">
          {coop && (
            <Button icon="arrow-left" onClick={() => navigate('/farmers/groups')}>
              {t('nav.farmers.groups')}
            </Button>
          )}
          {can('data.import') && (
            <Button icon="upload" onClick={() => setImportOpen(true)}>
              {t('action.import')}
            </Button>
          )}
          {can('farmer.create') && (
            <Button variant="primary" icon="plus" onClick={() => setAddOpen(true)}>
              {t('action.addFarmer')}
            </Button>
          )}
        </div>
      </div>

      <DataGrid
        rows={rows}
        columns={columns}
        rowId={(r) => r.id}
        loading={query.loading}
        search={search}
        storageKey="farmers"
        exportName="farmers"
        onRowClick={(r) => navigate(`/farmers/${r.id}`)}
        onError={fail}
        bulkActions={bulkActions}
        emptyTitle={tx('No workers registered yet')}
        emptyMessage={tx('Add your first worker, or import a list from a spreadsheet.')}
        emptyAction={
          can('farmer.create') ? (
            <Button variant="primary" icon="plus" onClick={() => setAddOpen(true)}>
              {tx('Add worker')}
            </Button>
          ) : undefined
        }
        toolbar={
          <FilterBar
            specs={[
              { key: 'status', label: tx('Status'), type: 'multi', options: Object.entries(FARMER_STATUS).map(([value, m]) => ({ value, label: m.label })) },
              { key: 'crop', label: tx('Crop'), type: 'multi', options: crops.map((c) => ({ value: c.id, label: cropLabel(c) })) },
              { key: 'district', label: tx('District'), type: 'multi', options: uniq(all.map((r) => r.district)).map((d) => ({ value: d, label: d })) },
              { key: 'cooperative', label: tx('Cooperative'), type: 'select', options: cooperatives.map((c) => ({ value: c.id, label: c.name })) },
              { key: 'activity', label: tx('Activity type'), type: 'multi', options: [
                { value: 'farming', label: tx('Farming') },
                { value: 'harvest', label: tx('Harvest') },
                { value: 'financial', label: tx('Financial') },
                { value: 'logistics', label: tx('Logistics') },
                { value: 'operations', label: tx('Operations') },
                { value: 'other', label: tx('Other') },
              ] },
              { key: 'date', label: tx('Last activity'), type: 'daterange' },
              { key: 'quantity', label: tx('Quantity delivered'), type: 'numrange' },
              { key: 'balance', label: tx('Balance owed'), type: 'numrange' },
            ]}
            values={filters}
            onChange={setFilters}
          />
        }
      />

      {addOpen && <FarmerFormModal onClose={() => setAddOpen(false)} defaultCoopId={coopId ?? undefined} />}
      {editing && <FarmerFormModal farmer={editing} onClose={() => setEditing(null)} />}
      {importOpen && <ImportFarmersModal onClose={() => setImportOpen(false)} />}
      <ActivityComposer
        open={composer.open}
        farmerId={composer.farmerId}
        onClose={() => setComposer({ open: false })}
      />
    </>
  );
}

/* --------------------------------------------------------------- helpers */

/**
 * Payment standing, derived from the ledger rather than stored. Returns keys
 * rather than words so the caller can render it in the active language.
 */
function paymentLabel(r: Row) {
  const { balance, paid, earned } = r.financials;
  if (earned === 0) return { labelKey: 'pay.nothingOwed', helpKey: 'pay.nothingOwedHelp', label: '', glyph: '-', tone: 'slate' as const };
  if (balance > 0 && paid > 0) return { labelKey: 'pay.partPaid', helpKey: 'pay.partPaidHelp', label: '', glyph: '◒', tone: 'orange' as const };
  if (balance > 0) return { labelKey: 'pay.pending', helpKey: 'pay.pendingHelp', label: '', glyph: '○', tone: 'amber' as const };
  if (balance < 0) return { labelKey: 'pay.inAdvance', helpKey: 'pay.inAdvanceHelp', label: '', glyph: '◆', tone: 'blue' as const };
  return { labelKey: 'pay.paid', helpKey: 'pay.paidHelp', label: '', glyph: '✓', tone: 'green' as const };
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs)].sort();
}

/* -------------------------------------------------------- section tabs */

/**
 * Farmers and their daily work are one section: the register and the
 * attendance sheet are the same people, so they sit side by side.
 */
export function FarmersTabs() {
  const route = useRoute();
  const { t } = usePrefs();
  const tabs = [
    { path: '/farmers', label: t('nav.farmers.all'), on: route.path === '/farmers' },
    { path: '/farmers/groups', label: t('nav.farmers.groups'), on: route.path === '/farmers/groups' },
    { path: '/farmers/work', label: t('nav.work'), on: route.path.startsWith('/farmers/work') },
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

/* ------------------------------------------------------- delete farmer */

/**
 * Delete a farmer, or archive them when they already have records.
 *
 * A farmer with nothing recorded (a typo, a duplicate) is removed outright.
 * Anyone with harvests, payments, work days or ledger entries is archived
 * instead: hidden from every list, history kept, restorable later. Deleting
 * them would leave payments and totals pointing at nobody.
 */
export function useRemoveFarmer() {
  const { user, confirm, refresh, toast, fail } = useStore();
  return async (farmer: Farmer): Promise<'deleted' | 'archived' | null> => {
    const name = `${farmer.firstName} ${farmer.lastName}`;
    try {
      const history = await farmerService.historyCount(farmer.id);
      if (history === 0) {
        const r = await confirm({
          title: tx('Delete {name}?', { name }),
          message: tx('Nothing has been recorded for this worker yet, so they are removed completely. This cannot be undone.'),
          confirmLabel: tx('Delete worker'),
          tone: 'danger',
        });
        if (!r.ok) return null;
        await farmerService.remove(user!, farmer.id);
        refresh();
        toast({ tone: 'success', title: tx('{name} deleted', { name }) });
        return 'deleted';
      }
      const r = await confirm({
        title: tx('Archive {name}?', { name }),
        message: tx('{name} already has records in the books ({count}: harvests, payments, work days or ledger entries), so they cannot be deleted without breaking the totals. Archiving hides them from every list and keeps their history. You can restore them later.', { name, count: history }),
        confirmLabel: tx('Archive worker'),
        tone: 'danger',
      });
      if (!r.ok) return null;
      await farmerService.archive(user!, farmer.id, true);
      refresh();
      toast({ tone: 'success', title: tx('{name} archived', { name }) });
      return 'archived';
    } catch (e) {
      fail(e);
      return null;
    }
  };
}

/* ------------------------------------------------------------ add farmer */

/** Register a new farmer, or edit one when `farmer` is given. */
export function FarmerFormModal({
  onClose,
  farmer: existing,
  defaultCoopId,
  onCreated,
}: {
  onClose: () => void;
  farmer?: Farmer;
  defaultCoopId?: string;
  /** Called with the new farmer once registered, e.g. to record their work straight away. */
  onCreated?: (farmer: Farmer) => void;
}) {
  const { user, crops, cooperatives, refresh, toast, fail, confirm } = useStore();
  const { t } = usePrefs();
  const [form, setForm] = useState(
    existing
      ? {
          code: existing.code,
          idNumber: existing.idNumber ?? '',
          firstName: existing.firstName,
          lastName: existing.lastName,
          phone: existing.phone,
          gender: existing.gender as string,
          village: existing.village,
          cell: existing.cell,
          sector: existing.sector,
          district: existing.district,
          cooperativeId: existing.cooperativeId,
          farmSizeHa: String(existing.farmSizeHa),
          plots: String(existing.plots),
          primaryCropId: existing.primaryCropId,
          season: existing.season,
        }
      : {
          code: '',
          idNumber: '',
          firstName: '',
          lastName: '',
          phone: '',
          gender: 'F',
          village: '',
          cell: '',
          sector: '',
          district: (defaultCoopId && cooperatives.find((c) => c.id === defaultCoopId)?.district) || '',
          cooperativeId: defaultCoopId || cooperatives[0]?.id || '',
          farmSizeHa: '1',
          plots: '1',
          primaryCropId: crops[0]?.id ?? '',
          season: '2026 A',
        },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      if (existing) {
        const updated = await farmerService.update(user, existing.id, {
          code: form.code.trim() || existing.code,
          idNumber: form.idNumber.trim() || undefined,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          phone: form.phone.trim(),
          gender: form.gender as Farmer['gender'],
          village: form.village.trim(),
          cell: form.cell.trim(),
          sector: form.sector.trim(),
          district: form.district.trim(),
          cooperativeId: form.cooperativeId,
          farmSizeHa: Number(form.farmSizeHa),
          plots: Number(form.plots),
          primaryCropId: form.primaryCropId,
        });
        refresh();
        toast({ tone: 'success', title: tx('{firstName} {lastName} updated', { firstName: updated.firstName, lastName: updated.lastName }) });
        onClose();
        return;
      }
      /* Same name in the same district is almost always the same person
         typed twice. Ask before creating a second record for them. */
      const first = form.firstName.trim().toLowerCase();
      const last = form.lastName.trim().toLowerCase();
      const twin = (await db.farmers.toArray()).find(
        (f) =>
          !f.archived &&
          f.firstName.trim().toLowerCase() === first &&
          f.lastName.trim().toLowerCase() === last &&
          f.district.trim().toLowerCase() === form.district.trim().toLowerCase(),
      );
      if (twin) {
        const answer = await confirm({
          title: tx('{name} is already registered', { name: `${twin.firstName} ${twin.lastName}` }),
          message: tx('A worker with this name already exists in {district} ({code}). Register a second, different person anyway?', {
            district: twin.district,
            code: twin.code,
          }),
          confirmLabel: tx('Yes, a different person'),
        });
        if (!answer.ok) {
          setBusy(false);
          return;
        }
      }
      const farmer = await farmerService.create(user, {
        code: form.code.trim() || undefined,
        idNumber: form.idNumber.trim() || undefined,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim(),
        gender: form.gender as Farmer['gender'],
        village: form.village.trim(),
        cell: form.cell.trim(),
        sector: form.sector.trim(),
        district: form.district.trim(),
        cooperativeId: form.cooperativeId,
        farmSizeHa: Number(form.farmSizeHa),
        plots: Number(form.plots),
        crops: [form.primaryCropId],
        primaryCropId: form.primaryCropId,
        season: form.season,
        registeredAt: today(),
      });
      refresh();
      toast({
        tone: 'success',
        title: tx('{firstName} {lastName} registered', { firstName: farmer.firstName, lastName: farmer.lastName }),
        message: farmer.code,
        action: { label: tx('Open profile'), run: () => navigate(`/farmers/${farmer.id}`) },
      });
      onClose();
      onCreated?.(farmer);
    } catch (err) {
      const e2 = err as Error & { field?: string };
      if (e2.field) setErrors({ [e2.field]: e2.message });
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? tx('Edit {name}', { name: `${existing.firstName} ${existing.lastName}` }) : tx('Register a worker')}
      subtitle={existing ? tx('Changes are kept in the audit trail.') : tx('The worker ID is generated automatically and cannot be reused.')}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {tx('Cancel')}
          </Button>
          <Button variant="primary" type="submit" form="add-farmer" loading={busy} icon="check">
            {existing ? tx('Save changes') : tx('Register worker')}
          </Button>
        </>
      }
    >
      <form id="add-farmer" onSubmit={submit} className="formgrid">
        <Field label={t('field.farmerId')} error={errors.code} help={t('field.farmerIdHelp')}>
          <Input
            value={form.code}
            onChange={(e) => set('code', e.target.value)}
            placeholder={existing ? undefined : t('field.farmerIdAuto')}
            invalid={Boolean(errors.code)}
          />
        </Field>
        <Field label={t('field.idNumber')} error={errors.idNumber} help={t('field.idNumberHelp')}>
          <Input
            value={form.idNumber}
            onChange={(e) => set('idNumber', e.target.value)}
            inputMode="numeric"
            invalid={Boolean(errors.idNumber)}
          />
        </Field>
        <Field label={tx('First name')} required error={errors.firstName}>
          <Input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} invalid={Boolean(errors.firstName)} autoFocus />
        </Field>
        <Field label={tx('Last name')} required error={errors.lastName}>
          <Input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} invalid={Boolean(errors.lastName)} />
        </Field>
        <Field label={tx('Phone')} error={errors.phone} help={tx('Used for mobile money payouts.')}>
          <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+250 78…" invalid={Boolean(errors.phone)} />
        </Field>
        <Field label={tx('Gender')}>
          <Select
            options={[
              { value: 'F', label: tx('Female') },
              { value: 'M', label: tx('Male') },
              { value: 'other', label: tx('Other') },
              { value: 'undisclosed', label: tx('Prefer not to say') },
            ]}
            value={form.gender}
            onChange={(e) => set('gender', e.target.value)}
          />
        </Field>
        <Field label={tx('District')} required error={errors.district}>
          <Input value={form.district} onChange={(e) => set('district', e.target.value)} invalid={Boolean(errors.district)} />
        </Field>
        <Field label={tx('Sector')}>
          <Input value={form.sector} onChange={(e) => set('sector', e.target.value)} />
        </Field>
        <Field label={tx('Cell')}>
          <Input value={form.cell} onChange={(e) => set('cell', e.target.value)} />
        </Field>
        <Field label={tx('Village')}>
          <Input value={form.village} onChange={(e) => set('village', e.target.value)} />
        </Field>
        <Field label={tx('Cooperative')} required error={errors.cooperativeId}>
          <Select options={cooperatives.map((c) => ({ value: c.id, label: c.name }))} value={form.cooperativeId} onChange={(e) => set('cooperativeId', e.target.value)} />
        </Field>
        <Field label={tx('Primary crop')} required error={errors.primaryCropId}>
          <Select options={crops.map((c) => ({ value: c.id, label: cropLabel(c) }))} value={form.primaryCropId} onChange={(e) => set('primaryCropId', e.target.value)} />
        </Field>
        <Field label={tx('Farm size')} error={errors.farmSizeHa} suffix="ha">
          <Input type="number" step="0.1" min="0" className="input input--money num" value={form.farmSizeHa} onChange={(e) => set('farmSizeHa', e.target.value)} />
        </Field>
        <Field label={tx('Number of plots')} error={errors.plots}>
          <Input type="number" min="0" step="1" value={form.plots} onChange={(e) => set('plots', e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- import */

function ImportFarmersModal({ onClose }: { onClose: () => void }) {
  const { user, crops, cooperatives, refresh, toast, fail } = useStore();
  const [preview, setPreview] = useState<Record<string, string>[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const template =
    'code,idNumber,firstName,lastName,phone,district,sector,cell,village,cooperative,primaryCrop,farmSizeHa,plots';

  const onFile = async (file: File) => {
    setError('');
    try {
      const text = await readFileText(file);
      const parsed = parseCSV(text);
      if (parsed.rows.length === 0) {
        setError(tx('That file has no data rows.'));
        return;
      }
      setPreview(parsed.rows);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doImport = async () => {
    if (!user || !preview) return;
    setBusy(true);
    try {
      const drafts = preview.map((row) => {
        const coop = cooperatives.find((c) => c.name.toLowerCase() === (row.cooperative ?? '').toLowerCase() || c.code.toLowerCase() === (row.cooperative ?? '').toLowerCase());
        const crop = crops.find((c) => c.name.toLowerCase() === (row.primaryCrop ?? '').toLowerCase());
        return {
          code: row.code?.trim() || undefined,
          idNumber: row.idNumber?.trim() || undefined,
          firstName: row.firstName ?? '',
          lastName: row.lastName ?? '',
          phone: row.phone ?? '',
          gender: 'undisclosed' as const,
          village: row.village ?? '',
          cell: row.cell ?? '',
          sector: row.sector ?? '',
          district: row.district ?? '',
          cooperativeId: coop?.id ?? cooperatives[0]?.id ?? '',
          farmSizeHa: Number(row.farmSizeHa || 0),
          plots: Number(row.plots || 1),
          crops: crop ? [crop.id] : [],
          primaryCropId: crop?.id ?? crops[0]?.id ?? '',
          season: '2026 A',
          registeredAt: today(),
        };
      });
      const created = await farmerService.importFarmers(user, drafts);
      refresh();
      toast({ tone: 'success', title: tx('{length} workers imported', { length: created.length }) });
      onClose();
    } catch (e) {
      setError((e as Error).message);
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={tx('Import workers from a spreadsheet')}
      subtitle={tx('CSV exported from Excel. The whole file is checked before anything is saved.')}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {tx('Cancel')}
          </Button>
          <Button variant="primary" onClick={doImport} disabled={!preview} loading={busy} icon="upload">
            Import {preview ? `${preview.length} workers` : ''}
          </Button>
        </>
      }
    >
      <div className="stack gap-4">
        <Callout tone="info">
          {txr('Column headers must be: {columns}. Cooperative and crop are matched by name; unknown values fall back to the first on file.', {
            columns: <code style={{ fontSize: 'var(--fs-xs)' }}>{template}</code>,
          })}
        </Callout>

        <label className="btn btn--secondary" style={{ width: 'fit-content', cursor: 'pointer' }}>
          <Icon name="upload" size={15} />
          Choose CSV file
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </label>

        {error && <Callout tone="danger" icon="alert">{error}</Callout>}

        {preview && (
          <div>
            <p className="eyebrow" style={{ marginBottom: 'var(--s-2)' }}>
              {tx('Preview, first 5 of {count} rows', { count: preview.length })}
            </p>
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-md)' }}>
              <table className="grid" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    {Object.keys(preview[0] ?? {}).map((h) => (
                      <th key={h}>
                        <span className="th">{h}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.slice(0, 5).map((row, i) => (
                    <tr key={i}>
                      {Object.values(row).map((v, j) => (
                        <td key={j}>
                          <span className="cell">{v}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- groups */

function FarmerGroups({ rows }: { rows: farmerService.FarmerRow[] }) {
  const { cooperatives, can, membership, cloudEnabled } = useStore();
  const { t } = usePrefs();
  const [editing, setEditing] = useState<{ id?: string; name: string; district: string } | null>(null);
  const isOwner = can('settings.manage');
  const online = Boolean(cloudEnabled && membership);

  const groups = cooperatives.map((c) => {
    const members = rows.filter((r) => r.cooperativeId === c.id);
    return {
      coop: c,
      members: members.length,
      owed: members.reduce((s, r) => s + Math.max(r.financials.balance, 0), 0),
      earned: members.reduce((s, r) => s + r.financials.earned, 0),
      paid: members.reduce((s, r) => s + r.financials.paid, 0),
    };
  });

  return (
    <>
      <FarmersTabs />
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('nav.farmers.groups')}</h1>
          <p className="page-sub">
            {isOwner
              ? tx('Each group can have its own manager, who sees only that group. Tap a group to see its workers.')
              : tx('Tap a group to see only its workers.')}
          </p>
        </div>
        {isOwner && (
          <div className="row gap-2 no-print">
            <Button variant="primary" icon="plus" onClick={() => setEditing({ name: '', district: '' })}>
              {tx('New group')}
            </Button>
          </div>
        )}
      </div>

      {isOwner && !online && (
        <Callout tone="info" icon="info">
          {tx('Manager codes need the online account. On this phone-only account, groups still keep workers and totals apart.')}
        </Callout>
      )}

      <div className="reportlist" style={{ marginTop: 'var(--s-3)' }}>
        {groups.map((g) => (
          <div key={g.coop.id} className="reporttile" role="button" tabIndex={0} onClick={() => navigate(`/farmers?coop=${g.coop.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/farmers?coop=${g.coop.id}`)}>
            <span className="row gap-2">
              <Icon name="users" size={16} />
              <span className="reporttile__name">{g.coop.name}</span>
              <span className="spacer" />
              {isOwner && (
                <IconButton
                  icon="edit"
                  size={15}
                  label={tx('Edit {name}', { name: g.coop.name })}
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing({ id: g.coop.id, name: g.coop.name, district: g.coop.district });
                  }}
                />
              )}
            </span>
            {(g.coop.district || g.coop.contact) && (
              <span className="reporttile__desc">{[g.coop.district, g.coop.contact].filter(Boolean).join(' · ')}</span>
            )}
            <div className="rowcard__grid" style={{ marginTop: 'var(--s-2)' }}>
              <div className="rowcard__cell">
                <span>{tx('Workers')}</span>
                <b>{formatNumber(g.members)}</b>
              </div>
              <div className="rowcard__cell">
                <span>{tx('Earned')}</span>
                <b>{formatMoney(g.earned)}</b>
              </div>
              <div className="rowcard__cell">
                <span>{tx('Owed')}</span>
                <b className={g.owed > 0 ? 'pos' : ''}>{formatMoney(g.owed)}</b>
              </div>
            </div>
            {isOwner && online && membership && <ManagerCode coopId={membership.coopId} groupId={g.coop.id} />}
          </div>
        ))}
      </div>

      {editing && <GroupModal value={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** The code a group's manager joins with. Shown to the owner only. */
function ManagerCode({ coopId, groupId }: { coopId: string; groupId: string }) {
  const { toast, fail, confirm } = useStore();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const show = async (renew = false) => {
    setBusy(true);
    try {
      setCode(renew ? await cloud.newGroupCode(coopId, groupId) : await cloud.groupCode(coopId, groupId));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row gap-2 wrap" style={{ marginTop: 'var(--s-3)' }} onClick={(e) => e.stopPropagation()}>
      {code ? (
        <>
          <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{tx('Manager code')}</span>
          <b className="num" style={{ letterSpacing: 1 }}>{code}</b>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(code);
              toast({ tone: 'success', title: tx('Code copied') });
            }}
          >
            {tx('Copy')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={busy}
            onClick={async () => {
              const r = await confirm({
                title: tx('Make a new code?'),
                message: tx('The old code stops working for new sign-ups. Managers already in the group stay in it.'),
                confirmLabel: tx('New code'),
              });
              if (r.ok) await show(true);
            }}
          >
            {tx('New code')}
          </Button>
        </>
      ) : (
        <Button size="sm" icon="lock" loading={busy} onClick={() => void show()}>
          {tx('Show manager code')}
        </Button>
      )}
    </div>
  );
}

function GroupModal({ value, onClose }: { value: { id?: string; name: string; district: string }; onClose: () => void }) {
  const { user, refresh, toast, fail } = useStore();
  const [name, setName] = useState(value.name);
  const [district, setDistrict] = useState(value.district);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      if (value.id) await groupService.updateGroup(user, value.id, { name, district });
      else await groupService.createGroup(user, { name, district });
      refresh();
      toast({ tone: 'success', title: value.id ? tx('Group saved') : tx('Group created'), message: name });
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
      title={value.id ? tx('Edit {name}', { name: value.name }) : tx('New group')}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>{tx('Cancel')}</Button>
          <Button variant="primary" type="submit" form="group-form" loading={busy} icon="check">{tx('Save')}</Button>
        </>
      }
    >
      <form id="group-form" onSubmit={submit} className="formgrid">
        <Field label={tx('Group name')} required>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t2('District')}>
          <Input value={district} onChange={(e) => setDistrict(e.target.value)} />
        </Field>
      </form>
    </Modal>
  );
}

const t2 = (s: string) => tx(s);
