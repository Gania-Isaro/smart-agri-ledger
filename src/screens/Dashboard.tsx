/**
 * Overview.
 *
 * Ordered by the questions a cooperative manager actually asks in the morning:
 * how many farmers do we have and what are they doing, how much produce came
 * in, what do we owe, and who needs paying today. The work queue is at the top
 * rather than buried under charts, because it is the only part anyone acts on.
 */

import { useMemo, useState } from 'react';
import { useQuery, useStore } from '../state/store';
import { Link, navigate } from '../state/router';
import { Icon } from '../components/ui/Icon';
import { Button, EmptyState, InfoDot, MetricSkeleton, Skeleton } from '../components/ui/primitives';
import { ChartCard, HBars, Legend, Meter, ProgressPair, TimeChart, CATEGORICAL } from '../components/charts';
import { formatMoney, formatMoneyShort, formatNumber } from '../domain/money';
import { FARMER_STATUS } from '../domain/status';
import * as analytics from '../services/analyticsService';
import * as paymentService from '../services/paymentService';
import { ActivityComposer } from '../components/ActivityComposer';
import { usePrefs } from '../i18n';

export function Dashboard() {
  const { user, can } = useStore();
  const { t, tn } = usePrefs();
  const [composerOpen, setComposerOpen] = useState(false);

  const overview = useQuery(() => analytics.overview());
  const byCrop = useQuery(() => analytics.harvestByCrop());
  const overTime = useQuery(() => analytics.harvestOverTime());
  const money = useQuery(() => analytics.moneyOverTime());
  const districts = useQuery(() => analytics.productionByDistrict());
  const coops = useQuery(() => analytics.productionByCooperative());
  const statuses = useQuery(() => analytics.farmersByStatus());
  const completion = useQuery(() => analytics.activityCompletion());
  const top = useQuery(() => analytics.topOutstanding(6));
  const batches = useQuery(() => paymentService.listBatches());

  const o = overview.data;
  const openBatch = batches.data?.find((b) => b.status !== 'completed' && b.status !== 'cancelled');

  const statusBars = useMemo(
    () =>
      (statuses.data ?? [])
        .map((s) => ({
          label: FARMER_STATUS[s.label as keyof typeof FARMER_STATUS] ? t(`status.${s.label}`) : s.label,
          value: s.value,
          /* Status keeps its reserved palette rather than borrowing a series
             colour, so a green bar means the same thing here as in the table. */
          colour: statusColour(s.label),
        }))
        .sort((a, b) => b.value - a.value),
    [statuses.data, t],
  );

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">{t('screen.overview.greeting', { name: user?.name.split(' ')[0] ?? '' })}</h1>
          <p className="page-sub">
            {o
              ? t('dash.sub', { farmers: formatNumber(o.totalFarmers), deliveries: formatNumber(o.deliveries) })
              : t('dash.loading')}
          </p>
        </div>
        <div className="row gap-2 no-print">
          <Button icon="chart" onClick={() => navigate('/reports')}>
            {t('nav.reports')}
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setComposerOpen(true)}>
            {t('action.recordActivity')}
          </Button>
        </div>
      </div>

      {/* ---- what needs doing ---- */}
      {o && (o.farmersOwed > 0 || o.unverifiedHarvests > 0 || o.pendingPayments > 0) && (
        <section className="card" style={{ marginBottom: 'var(--s-4)' }}>
          <div className="card__head">
            <div className="row gap-2">
              <Icon name="zap" size={17} />
              <h2 className="section-title">{t('screen.overview.attention')}</h2>
            </div>
          </div>
          <div className="card__body card__body--tight">
            <div className="row gap-2 wrap">
              {o.farmersOwed > 0 && (
                <Button icon="coins" onClick={() => navigate('/payments/outstanding')}>
                  {tn('dash.payFarmers', o.farmersOwed, { amount: formatMoneyShort(o.outstanding) })}
                </Button>
              )}
              {o.unverifiedHarvests > 0 && (
                <Button icon="badge-check" onClick={() => navigate('/production/harvests')}>
                  {tn('dash.verifyHarvests', o.unverifiedHarvests)}
                </Button>
              )}
              {o.pendingPayments > 0 && can('payment.approve') && (
                <Button icon="check-double" onClick={() => navigate('/payments/pending')}>
                  {tn('dash.approvePayments', o.pendingPayments)}
                </Button>
              )}
              {openBatch && (
                <Button icon="layers" onClick={() => navigate(`/payments/batches/${openBatch.id}`)}>
                  {t('dash.batchLeft', { code: openBatch.code, amount: formatMoneyShort(openBatch.remaining) })}
                </Button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ---- metrics ---- */}
      {overview.loading || !o ? (
        <MetricSkeleton count={8} />
      ) : (
        <div className="metrics">
          <Metric label={t('metric.totalFarmers')} value={formatNumber(o.totalFarmers)} foot={t('dash.activeThisSeason', { count: formatNumber(o.activeFarmers) })} onClick={() => navigate('/farmers')} />
          <Metric label={t('metric.currentlyFarming')} value={formatNumber(o.farmersFarming)} foot={t('dash.fieldWork')} onClick={() => navigate('/activities/farming')} />
          <Metric label={t('metric.haveHarvested')} value={formatNumber(o.farmersHarvested)} foot={tn('dash.deliveries', o.deliveries, { count: formatNumber(o.deliveries) })} onClick={() => navigate('/production/harvests')} />
          <Metric label={t('metric.produceCollected')} value={`${formatNumber(Math.round(o.produceKg))}`} foot={t('dash.kgWeight')} accent />
          <Metric label={t('metric.totalEarned')} value={formatMoneyShort(o.totalOwed)} foot={t('dash.rwfCredits')} />
          <Metric label={t('metric.totalPaid')} value={formatMoneyShort(o.totalPaid)} foot={t('dash.rwfSettled')} />
          <Metric
            label={t('metric.outstanding')}
            value={formatMoneyShort(o.outstanding)}
            foot={t('dash.rwfOwedTo', { count: formatNumber(o.farmersOwed) })}
            warn
            onClick={() => navigate('/payments/outstanding')}
            hint={t('dash.outstandingHint')}
          />
          <Metric label={t('metric.advances')} value={formatMoneyShort(o.advancesOutstanding)} foot={t('dash.rwfRecover')} />
        </div>
      )}

      {/* ---- money position ---- */}
      {o && (
        <section className="card" style={{ marginTop: 'var(--s-4)' }}>
          <div className="card__head">
            <h2 className="section-title">{t('screen.overview.moneyPosition')}</h2>
            <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>
              {t('dash.settledOf', { paid: formatMoney(o.totalPaid), total: formatMoney(o.totalPaid + o.outstanding) })}
            </span>
          </div>
          <div className="card__body">
            <ProgressPair
              paid={o.totalPaid}
              /* Paid plus what is still owed after advances and deductions, so
                 "Still owed" matches the Outstanding figure above it. */
              total={o.totalPaid + o.outstanding}
              paidLabel={t('dash.paidToFarmers')}
              remainingLabel={t('dash.stillOwed')}
            />
          </div>
        </section>
      )}

      {/* ---- charts ---- */}
      <div className="chartgrid" style={{ marginTop: 'var(--s-4)' }}>
        <ChartCard title={t('chart.harvestByCrop')} subtitle={t('chart.harvestByCropSub')}>
          {byCrop.loading ? <Skeleton height={150} /> : <HBars data={byCrop.data ?? []} unit="KG" />}
        </ChartCard>

        <ChartCard title={t('chart.produceOverTime')} subtitle={t('chart.produceOverTimeSub')}>
          {overTime.loading ? <Skeleton height={190} /> : <TimeChart data={overTime.data ?? []} unit="KG" seriesLabels={['Produce']} />}
        </ChartCard>

        <ChartCard
          title={t('chart.earnedPaid')}
          subtitle={t('chart.earnedPaidSub')}
          legend={
            <Legend
              items={[
                { label: t('chart.earnedBy'), colour: CATEGORICAL[0] },
                { label: t('chart.paidOut'), colour: CATEGORICAL[1] },
              ]}
            />
          }
        >
          {money.loading ? <Skeleton height={190} /> : <TimeChart data={money.data ?? []} money seriesLabels={[t('chart.earnedBy'), t('chart.paidOut')]} />}
        </ChartCard>

        <ChartCard title={t('chart.byStatus')} subtitle={t('chart.byStatusSub')}>
          {statuses.loading ? <Skeleton height={150} /> : <HBars data={statusBars} unit="" emptyLabel="No farmers registered yet" />}
        </ChartCard>

        <ChartCard title={t('chart.byDistrict')} subtitle={t('chart.byDistrictSub')}>
          {districts.loading ? <Skeleton height={130} /> : <HBars data={districts.data ?? []} unit="KG" />}
        </ChartCard>

        <ChartCard title={t('chart.byCoop')} subtitle={t('chart.byCoopSub')}>
          {coops.loading ? <Skeleton height={130} /> : <HBars data={coops.data ?? []} money />}
        </ChartCard>

        <ChartCard title={t('chart.completion')} subtitle={t('chart.completionSub')}>
          {completion.data && (
            <Meter
              value={completion.data.completed}
              total={completion.data.total}
              label={t('chart.completionLabel', {
                done: formatNumber(completion.data.completed),
                total: formatNumber(completion.data.total),
              })}
              caption={t('chart.completionCaption')}
            />
          )}
        </ChartCard>

        <ChartCard
          title={t('chart.owedMost')}
          subtitle={t('chart.owedMostSub')}
          action={
            <Button size="sm" variant="ghost" iconRight="chevron-right" onClick={() => navigate('/payments/outstanding')}>
              {t('misc.all')}
            </Button>
          }
        >
          {top.loading ? (
            <Skeleton height={130} />
          ) : (top.data ?? []).length === 0 ? (
            <EmptyState icon="check" title={t('chart.allSettled')} message={t('chart.allSettledSub')} />
          ) : (
            <div className="stack gap-2">
              {(top.data ?? []).map(({ farmer, balance }) => (
                <Link
                  key={farmer.id}
                  to={`/farmers/${farmer.id}`}
                  className="row gap-3"
                  style={{ padding: '6px 0', borderBottom: '1px solid var(--c-border-soft)', color: 'inherit', textDecoration: 'none' }}
                >
                  <span className="avatar" style={{ width: 26, height: 26, fontSize: 10 }}>
                    {farmer.firstName[0]}
                    {farmer.lastName[0]}
                  </span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="truncate strong" style={{ display: 'block', fontSize: 'var(--fs-sm)' }}>
                      {farmer.firstName} {farmer.lastName}
                    </span>
                    <span className="grid__code">
                      {farmer.code} · {farmer.district}
                    </span>
                  </span>
                  <b className="num pos" style={{ fontSize: 'var(--fs-sm)' }}>
                    {formatMoney(balance)}
                  </b>
                </Link>
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      <ActivityComposer open={composerOpen} onClose={() => setComposerOpen(false)} />
    </>
  );
}

function Metric({
  label,
  value,
  foot,
  accent,
  warn,
  onClick,
  hint,
}: {
  label: string;
  value: string;
  foot?: string;
  accent?: boolean;
  warn?: boolean;
  onClick?: () => void;
  hint?: string;
}) {
  const className = `metric ${accent ? 'metric--accent' : ''} ${warn ? 'metric--warn' : ''}`;
  const inner = (
    <>
      <span className="metric__label">
        {label}
        {hint && <InfoDot text={hint} />}
      </span>
      <span className="metric__value num">{value}</span>
      {foot && <span className="metric__foot">{foot}</span>}
    </>
  );
  return onClick ? (
    <button className={className} onClick={onClick}>
      {inner}
    </button>
  ) : (
    <div className={className}>{inner}</div>
  );
}

function statusColour(status: string): string {
  const tone = FARMER_STATUS[status as keyof typeof FARMER_STATUS]?.tone ?? 'slate';
  const map: Record<string, string> = {
    green: 'var(--c-green-600)',
    amber: 'var(--c-amber-600)',
    blue: 'var(--c-blue-600)',
    orange: 'var(--c-orange-600)',
    purple: 'var(--c-purple-600)',
    red: 'var(--c-red-600)',
    teal: 'var(--c-teal-600)',
    slate: 'var(--c-slate-600)',
  };
  return map[tone] ?? 'var(--c-slate-600)';
}
