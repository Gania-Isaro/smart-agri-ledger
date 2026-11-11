/**
 * Demo data.
 *
 * Generated from a fixed seed so every run produces the same cooperative, and
 * generated in the same order a real cooperative would work: register farmers,
 * record field activity, take in harvests, issue advances, then pay. Ledger
 * entries are written by the same posting rules the live app uses, so the demo
 * balances are genuinely derived rather than typed in.
 */

import { db, type Counter } from './db';
import { DEMO_ACCOUNT_ID, DEMO_EMAIL } from './accounts';
import { uid, padCode } from '../lib/id';
import { addDays, monthKey, nowStamp, seasonFor, today, toISODate } from '../lib/date';
import { grossValue } from '../domain/money';
import { BUILT_IN_ACTIVITY_TYPES } from '../domain/activityCatalog';
import { balanceOf, directionFor } from '../domain/ledger';
import type {
  Activity,
  ActivityStatus,
  AppNotification,
  AuditEvent,
  Cooperative,
  Crop,
  Farmer,
  FarmerStatus,
  Harvest,
  LedgerTransaction,
  LedgerTxType,
  Payment,
  PaymentBatch,
  PaymentMethod,
  Unit,
  User,
  WorkDay,
} from '../domain/types';

/* --------------------------------------------------------------- helpers */

/** Mulberry32, small, fast, deterministic. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20260828);
const pick = <T,>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
const between = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const chance = (p: number) => rand() < p;

/* ----------------------------------------------------------- static data */

const COOPERATIVES: Cooperative[] = [
  { id: 'coop_kob', code: 'KOB', name: 'Koperative Abahinzi ba Rwamagana', district: 'Rwamagana', contact: '+250 788 300 101' },
  { id: 'coop_tuz', code: 'TUZ', name: 'Tuzamurane Musanze', district: 'Musanze', contact: '+250 788 300 202' },
  { id: 'coop_ind', code: 'IND', name: 'Indatwa Nyagatare Growers', district: 'Nyagatare', contact: '+250 788 300 303' },
];

const CROPS: Crop[] = [
  { id: 'crop_maize', name: 'Maize', defaultUnit: 'KG', defaultPricePerUnit: 400, colour: 'var(--cat-1)' },
  { id: 'crop_beans', name: 'Beans', defaultUnit: 'KG', defaultPricePerUnit: 750, colour: 'var(--cat-2)' },
  { id: 'crop_irish', name: 'Irish potato', defaultUnit: 'KG', defaultPricePerUnit: 320, colour: 'var(--cat-3)' },
  { id: 'crop_coffee', name: 'Coffee cherry', defaultUnit: 'KG', defaultPricePerUnit: 620, colour: 'var(--cat-4)' },
  { id: 'crop_rice', name: 'Rice paddy', defaultUnit: 'KG', defaultPricePerUnit: 480, colour: 'var(--cat-5)' },
  { id: 'crop_cassava', name: 'Cassava', defaultUnit: 'KG', defaultPricePerUnit: 260, colour: 'var(--cat-6)' },
  { id: 'crop_banana', name: 'Banana', defaultUnit: 'BUNCH', defaultPricePerUnit: 3500, colour: 'var(--cat-7)' },
  { id: 'crop_soy', name: 'Soybean', defaultUnit: 'KG', defaultPricePerUnit: 690, colour: 'var(--cat-8)' },
];

const DEMO_USERS: User[] = [
  /*
   * One account. The owner and the manager run this cooperative together and
   * share these credentials, so they sign in to the same place and see exactly
   * the same thing. There is no second view of the business to reconcile.
   *
   * The role system underneath is still real and still enforced (see rbac.ts);
   * this account simply holds every permission. That matters if the cooperative
   * ever grows enough to want a separate field officer or accountant login:
   * adding one is a new row here, not a rewrite.
   */
  {
    id: DEMO_ACCOUNT_ID,
    name: 'Isaro Gania',
    email: DEMO_EMAIL,
    pin: '1234',
    role: 'super_admin',
    cooperativeId: null,
    active: true,
    createdAt: '2026-01-05T08:00:00.000Z',
  },
];

const FIRST_NAMES = [
  'Jean Pierre', 'Alice', 'Emmanuel', 'Chantal', 'Eric', 'Solange', 'Innocent', 'Vestine',
  'Fabrice', 'Josiane', 'Theoneste', 'Immaculee', 'Olivier', 'Beatrice', 'Damascene', 'Esperance',
  'Aimable', 'Consolee', 'Gaspard', 'Mediatrice', 'Faustin', 'Jacqueline', 'Celestin', 'Donatha',
  'Straton', 'Angelique', 'Vedaste', 'Furaha',
];

const LAST_NAMES = [
  'Nkurunziza', 'Uwimana', 'Habimana', 'Mukamana', 'Ndayisaba', 'Uwase', 'Bizimana', 'Nyirahabimana',
  'Hakizimana', 'Mukandayisenga', 'Niyonsenga', 'Umutoni', 'Rwabuhungu', 'Ingabire', 'Munyaneza', 'Nyiranzeyimana',
  'Kalisa', 'Uwitonze', 'Twagirayezu', 'Mutesi', 'Sibomana', 'Nirere', 'Gatera', 'Kamikazi',
  'Rukundo', 'Uwera', 'Ntawukuriryayo', 'Iradukunda',
];

const PLACES: Record<string, { sectors: string[]; cells: string[]; villages: string[] }> = {
  Rwamagana: {
    sectors: ['Kigabiro', 'Muhazi', 'Musha', 'Fumbwe'],
    cells: ['Nyagasambu', 'Bicumbi', 'Karenge', 'Munyaga'],
    villages: ['Kabare', 'Rubona', 'Nyakabanda', 'Gishari', 'Mwulire'],
  },
  Musanze: {
    sectors: ['Kinigi', 'Muhoza', 'Gataraga', 'Nyange'],
    cells: ['Bisoke', 'Kabeza', 'Rungu', 'Mudakama'],
    villages: ['Nyabigoma', 'Kaguhu', 'Rwebeya', 'Bikungu', 'Muhabura'],
  },
  Nyagatare: {
    sectors: ['Karangazi', 'Matimba', 'Rwimiyaga', 'Tabagwe'],
    cells: ['Ndama', 'Kajuru', 'Nyamirama', 'Rwenyemera'],
    villages: ['Gakoma', 'Rukorota', 'Kabeza', 'Nyabishambi', 'Rwentanga'],
  },
};

/* ------------------------------------------------------------- generator */

export interface SeedResult {
  farmers: number;
  activities: number;
  harvests: number;
  payments: number;
  transactions: number;
}

export async function seedDatabase(): Promise<SeedResult> {
  const now = nowStamp();
  const anchor = today();

  const farmers: Farmer[] = [];
  const activities: Activity[] = [];
  const harvests: Harvest[] = [];
  const payments: Payment[] = [];
  const transactions: LedgerTransaction[] = [];
  const audit: AuditEvent[] = [];
  const batches: PaymentBatch[] = [];

  let txSeq = 0;
  const txCode = () => padCode(`TXN-${anchor.slice(0, 4)}-`, ++txSeq, 6);

  /** Post a ledger entry using the same rules the live services use. */
  function post(
    farmerId: string,
    type: LedgerTxType,
    amountRwf: number,
    description: string,
    date: string,
    extra: Partial<LedgerTransaction> = {},
    createdBy = 'acc_demo',
  ): LedgerTransaction {
    const tx: LedgerTransaction = {
      id: uid('tx'),
      code: txCode(),
      farmerId,
      type,
      direction: directionFor(type, extra.direction),
      amount: amountRwf,
      description,
      date,
      voided: false,
      createdBy,
      createdAt: `${date}T09:${String(between(10, 59)).padStart(2, '0')}:00.000Z`,
      ...extra,
    };
    transactions.push(tx);
    return tx;
  }

  function log(entity: string, entityId: string, action: AuditEvent['action'], summary: string, userId: string, at: string) {
    audit.push({ id: uid('aud'), entity, entityId, action, summary, userId, at });
  }

  /* ---- payment batch for the current month ---- */
  const batch: PaymentBatch = {
    id: 'batch_current',
    code: 'PB-2026-08',
    name: 'Harvest Payment Batch, August 2026',
    period: monthKey(anchor),
    status: 'partially_paid',
    createdBy: 'acc_demo',
    createdAt: `${anchor.slice(0, 7)}-20T10:00:00.000Z`,
    approvedBy: 'acc_demo',
    approvedAt: `${anchor.slice(0, 7)}-21T14:30:00.000Z`,
    notes: 'Covers maize, beans and Irish potato deliveries received in August.',
  };
  const priorBatch: PaymentBatch = {
    id: 'batch_july',
    code: 'PB-2026-07',
    name: 'Harvest Payment Batch, July 2026',
    period: '2026-07',
    status: 'completed',
    createdBy: 'acc_demo',
    createdAt: '2026-07-22T10:00:00.000Z',
    approvedBy: 'acc_demo',
    approvedAt: '2026-07-23T09:00:00.000Z',
    completedAt: '2026-07-28T16:00:00.000Z',
    notes: 'Season B closing payments. Fully settled.',
  };
  batches.push(priorBatch, batch);

  /* ---- farmers ---- */
  const COUNT = 26;
  for (let i = 0; i < COUNT; i++) {
    const coop = i < 12 ? COOPERATIVES[0]! : i < 20 ? COOPERATIVES[1]! : COOPERATIVES[2]!;
    const place = PLACES[coop.district]!;
    const primary = i < 12 ? pick([CROPS[0]!, CROPS[1]!, CROPS[4]!]) : i < 20 ? pick([CROPS[2]!, CROPS[1]!, CROPS[6]!]) : pick([CROPS[0]!, CROPS[3]!, CROPS[5]!, CROPS[7]!]);
    const secondary = pick(CROPS.filter((c) => c.id !== primary.id));
    const registeredAt = toISODate(new Date(2025, between(0, 11), between(1, 28)));

    farmers.push({
      id: `frm_${String(i + 1).padStart(3, '0')}`,
      code: padCode('FR-', i + 1),
      firstName: FIRST_NAMES[i % FIRST_NAMES.length]!,
      lastName: LAST_NAMES[(i * 3 + 5) % LAST_NAMES.length]!,
      phone: `+250 78${between(0, 9)} ${between(100, 999)} ${between(100, 999)}`,
      gender: chance(0.55) ? 'F' : 'M',
      idNumber: `119${between(70, 99)}8${between(1000000, 9999999)}${between(10, 99)}`,
      village: pick(place.villages),
      cell: pick(place.cells),
      sector: pick(place.sectors),
      district: coop.district,
      cooperativeId: coop.id,
      farmSizeHa: Math.round((0.3 + rand() * 3.4) * 10) / 10,
      plots: between(1, 4),
      crops: [primary.id, secondary.id],
      primaryCropId: primary.id,
      season: seasonFor(anchor),
      status: 'active',
      registeredAt,
      archived: false,
      notes: chance(0.25) ? 'Member of the savings group. Prefers mobile money payouts.' : undefined,
    });
    log('farmer', farmers[i]!.id, 'create', `Registered ${farmers[i]!.firstName} ${farmers[i]!.lastName}`, 'acc_demo', `${registeredAt}T08:00:00.000Z`);
  }

  /* ---- activity + financial history per farmer ---- */
  const FARM_STEPS: { typeId: string; label: string; offset: number }[] = [
    { typeId: 'land_preparation', label: 'Land preparation', offset: -120 },
    { typeId: 'plowing', label: 'Plowing', offset: -112 },
    { typeId: 'planting', label: 'Planting', offset: -105 },
    { typeId: 'fertilizing', label: 'Fertilizing', offset: -80 },
    { typeId: 'weeding', label: 'Weeding', offset: -60 },
    { typeId: 'pest_control', label: 'Pest control', offset: -45 },
    { typeId: 'crop_monitoring', label: 'Crop monitoring', offset: -25 },
  ];

  farmers.forEach((farmer, index) => {
    const crop = CROPS.find((c) => c.id === farmer.primaryCropId)!;

    /* Field activities: everyone has some, later ones taper off. */
    const steps = FARM_STEPS.slice(0, between(3, FARM_STEPS.length));
    for (const step of steps) {
      const date = addDays(anchor, step.offset + between(-3, 3));
      const status: ActivityStatus = 'completed';
      activities.push({
        id: uid('act'),
        farmerId: farmer.id,
        typeId: step.typeId,
        category: 'farming',
        status,
        date,
        cropId: crop.id,
        data: {
          areaHa: farmer.farmSizeHa,
          ...(step.typeId === 'planting' ? { seedQuantity: between(10, 60), seedVariety: `${crop.name} improved`, season: farmer.season } : {}),
          ...(step.typeId === 'fertilizing' ? { inputName: pick(['NPK 17-17-17', 'Urea', 'DAP']), inputQuantity: between(20, 120) } : {}),
          ...(step.typeId === 'weeding' ? { labourers: between(2, 8) } : {}),
          ...(step.typeId === 'pest_control' ? { pest: pick(['Fall armyworm', 'Aphids', 'Stalk borer']), inputName: 'Rocket 44 EC', inputQuantity: between(1, 5) } : {}),
          ...(step.typeId === 'crop_monitoring' ? { condition: pick(['excellent', 'good', 'good', 'fair']), expectedYield: between(200, 1400) } : {}),
        },
        documentIds: [],
        createdBy: 'acc_demo',
        createdAt: `${date}T10:00:00.000Z`,
        updatedAt: `${date}T10:00:00.000Z`,
      });
    }

    /* Advances: about a third of farmers took one before harvest. */
    let hasAdvance = false;
    if (chance(0.34)) {
      hasAdvance = true;
      const date = addDays(anchor, -between(35, 75));
      const amt = between(2, 8) * 5000;
      const tx = post(farmer.id, 'advance', amt, 'Pre-harvest advance', date, { reference: `ADV-${between(1000, 9999)}` }, 'acc_demo');
      activities.push({
        id: uid('act'), farmerId: farmer.id, typeId: 'advance_payment', category: 'financial',
        status: 'completed', date, data: { amount: amt, method: 'mobile_money', reason: 'Pre-harvest advance for inputs' },
        transactionId: tx.id, documentIds: [], createdBy: 'acc_demo',
        createdAt: `${date}T09:00:00.000Z`, updatedAt: `${date}T09:00:00.000Z`,
      });
      log('transaction', tx.id, 'create', `Advance of ${amt} RWF issued`, 'acc_demo', `${date}T09:00:00.000Z`);
    }

    /* Input credit for some farmers. */
    if (chance(0.22)) {
      const date = addDays(anchor, -between(50, 90));
      const amt = between(3, 9) * 2500;
      post(farmer.id, 'loan', amt, 'Fertilizer issued on credit', date, {}, 'acc_demo');
    }

    /*
     * Harvests. Two thirds of farmers have delivered; the rest are still in the
     * field, which is what makes the "who has farmed vs who has harvested"
     * question on the dashboard interesting.
     */
    const harvestCount = index % 3 === 2 ? 0 : between(1, 2);
    let delivered = 0;

    for (let h = 0; h < harvestCount; h++) {
      /*
       * Deliveries arrive across the season, not all in one week: the first is
       * recent, a second (where there is one) came in an earlier month. That is
       * both how a season actually runs and what makes the monthly charts show
       * a trend rather than a single dot.
       */
      const date = h === 0 ? addDays(anchor, -between(2, 26)) : addDays(anchor, -between(34, 96));
      const unit: Unit = crop.defaultUnit;
      const quantity = unit === 'BUNCH' ? between(8, 40) : between(60, 900);
      const priceFactor = chance(0.5) ? 1 : chance(0.75) ? 0.92 : 0.8;
      const pricePerUnit = Math.round((crop.defaultPricePerUnit * priceFactor) / 5) * 5;
      const deductions = chance(0.4) ? between(1, 6) * 1000 : 0;
      const gross = grossValue(quantity, pricePerUnit);
      const verified = chance(0.75);

      const harvest: Harvest = {
        id: uid('hrv'),
        farmerId: farmer.id,
        cropId: crop.id,
        date,
        quantity,
        unit,
        pricePerUnit,
        deductions,
        status: verified ? 'verified' : 'recorded',
        batchId: monthKey(date) === batch.period ? batch.id : priorBatch.id,
        createdBy: 'acc_demo',
        createdAt: `${date}T11:00:00.000Z`,
        updatedAt: `${date}T11:00:00.000Z`,
        notes: priceFactor < 0.85 ? 'High moisture content at intake.' : undefined,
      };
      harvests.push(harvest);
      delivered += gross;

      const tx = post(farmer.id, 'harvest', gross, `${crop.name} delivery, ${quantity} ${unit} @ ${pricePerUnit} RWF`, date, { harvestId: harvest.id, batchId: harvest.batchId }, 'acc_demo');

      const act: Activity = {
        id: uid('act'), farmerId: farmer.id, typeId: 'harvesting', category: 'harvest',
        status: verified ? 'verified' : 'completed', date, cropId: crop.id,
        data: { quantity, unit, pricePerUnit, deductions, grossValue: gross },
        harvestId: harvest.id, transactionId: tx.id, documentIds: [],
        createdBy: 'acc_demo', createdAt: `${date}T11:00:00.000Z`, updatedAt: `${date}T11:00:00.000Z`,
      };
      activities.push(act);
      harvest.activityId = act.id;
      tx.activityId = act.id;
      log('harvest', harvest.id, 'create', `Recorded ${quantity} ${unit} of ${crop.name}`, 'acc_demo', `${date}T11:00:00.000Z`);

      if (deductions > 0) {
        post(farmer.id, 'deduction', deductions, 'Transport and drying at intake', date, { harvestId: harvest.id }, 'acc_demo');
      }
      if (priceFactor === 1 && chance(0.45)) {
        post(farmer.id, 'bonus', between(2, 6) * 2500, 'Loyalty bonus', addDays(date, 1), { harvestId: harvest.id }, 'acc_demo');
      }
    }

    /*
     * Payments for anything delivered in an earlier month were settled with the
     * July batch, which is marked completed, so it has to actually contain the
     * payments that completed it.
     */
    const earlier = harvests.filter((h) => h.farmerId === farmer.id && monthKey(h.date) !== batch.period);
    if (earlier.length > 0) {
      const earlierValue = earlier.reduce((sum, h) => sum + grossValue(h.quantity, h.pricePerUnit), 0);
      const payDate = addDays(earlier[0]!.date, between(3, 9));
      const amt = Math.round(earlierValue / 500) * 500;
      if (amt > 0) {
        const ref = `PAY-26${String(index + 1).padStart(3, '0')}-${between(100, 999)}`;
        const payment: Payment = {
          id: uid('pay'),
          farmerId: farmer.id,
          amount: amt,
          method: chance(0.7) ? 'mobile_money' : 'cash',
          status: 'paid',
          date: payDate,
          reference: ref,
          reason: `${priorBatch.name} settlement`,
          batchId: priorBatch.id,
          harvestIds: earlier.map((h) => h.id),
          createdBy: 'acc_demo',
          createdAt: `${payDate}T15:00:00.000Z`,
          approvedBy: 'acc_demo',
          approvedAt: `${payDate}T15:30:00.000Z`,
          paidAt: `${payDate}T16:00:00.000Z`,
        };
        const tx = post(farmer.id, 'payment', amt, `Payment ${ref}`, payDate, { paymentId: payment.id, batchId: priorBatch.id, reference: ref }, 'acc_demo');
        payment.transactionId = tx.id;
        payments.push(payment);
        delivered -= amt;
      }
    }

    /* Payments against what has been delivered this month. */
    if (delivered > 0) {
      const roll = rand();
      const settledFully = roll < 0.3;
      const settledPartly = roll >= 0.3 && roll < 0.72;

      if (settledFully || settledPartly) {
        const date = addDays(anchor, -between(1, 12));
        const owed = Math.max(delivered - (hasAdvance ? 20000 : 0), 5000);
        const amt = settledFully ? Math.round(owed / 500) * 500 : Math.round((owed * (0.3 + rand() * 0.4)) / 500) * 500;
        const method: PaymentMethod = chance(0.7) ? 'mobile_money' : chance(0.6) ? 'bank_transfer' : 'cash';
        const payment: Payment = {
          id: uid('pay'),
          farmerId: farmer.id,
          amount: amt,
          method,
          status: 'paid',
          date,
          reference: `PAY-${anchor.slice(2, 4)}${String(index + 1).padStart(3, '0')}-${between(100, 999)}`,
          reason: 'August harvest settlement',
          batchId: batch.id,
          harvestIds: harvests.filter((h) => h.farmerId === farmer.id).map((h) => h.id),
          createdBy: 'acc_demo',
          createdAt: `${date}T15:00:00.000Z`,
          approvedBy: 'acc_demo',
          approvedAt: `${date}T15:30:00.000Z`,
          paidAt: `${date}T16:00:00.000Z`,
        };
        const tx = post(farmer.id, 'payment', amt, `Payment ${payment.reference}`, date, { paymentId: payment.id, batchId: batch.id, reference: payment.reference }, 'acc_demo');
        payment.transactionId = tx.id;
        payments.push(payment);
        log('payment', payment.id, 'pay', `Paid ${amt} RWF to ${farmer.firstName} ${farmer.lastName}`, 'acc_demo', `${date}T16:00:00.000Z`);
      } else if (chance(0.6)) {
        /* Sitting in the batch waiting for approval, the work queue. */
        const date = addDays(anchor, -between(0, 4));
        const amt = Math.round(Math.max(delivered * 0.6, 10000) / 500) * 500;
        payments.push({
          id: uid('pay'), farmerId: farmer.id, amount: amt, method: 'mobile_money',
          status: chance(0.5) ? 'pending' : 'approved', date,
          reference: `PAY-${anchor.slice(2, 4)}${String(index + 1).padStart(3, '0')}-${between(100, 999)}`,
          reason: 'August harvest settlement', batchId: batch.id,
          harvestIds: harvests.filter((h) => h.farmerId === farmer.id).map((h) => h.id),
          createdBy: 'acc_demo', createdAt: `${date}T15:00:00.000Z`,
        });
      }
    }

    /* A couple of other activities to make the timelines feel real. */
    if (chance(0.3)) {
      const date = addDays(anchor, -between(10, 60));
      activities.push({
        id: uid('act'), farmerId: farmer.id, typeId: 'training', category: 'other', status: 'completed',
        date, data: { topic: pick(['Post-harvest handling', 'Soil fertility', 'Cooperative bookkeeping']), hours: between(2, 6), trainer: 'RAB extension officer' },
        documentIds: [], createdBy: 'acc_demo', createdAt: `${date}T13:00:00.000Z`, updatedAt: `${date}T13:00:00.000Z`,
      });
    }
  });

  /* ---- one disputed account, so the status vocabulary is exercised ---- */
  const disputedFarmer = farmers[7]!;
  const dDate = addDays(anchor, -3);
  post(disputedFarmer.id, 'adjustment', 12000, 'Weight correction disputed by worker', dDate, { direction: 'debit' }, 'acc_demo');
  log('transaction', 'adjustment', 'update', `Balance adjusted for ${disputedFarmer.code}, under review`, 'acc_demo', `${dDate}T10:00:00.000Z`);

  /* ---- daily work: the last two weeks, a few people from each group ----
     The demo has to show the main job of the app, so each working day has
     people recorded with a (drawn) photo, some paid on the day, some owed. */
  const workdays: WorkDay[] = [];
  const TASKS = ['Weeding', 'Planting', 'Harvesting', 'Land preparation', 'Spraying'];
  const crew = COOPERATIVES.flatMap((c) => farmers.filter((f) => f.cooperativeId === c.id).slice(0, 4));
  for (let back = 13; back >= 0; back--) {
    const date = addDays(anchor, -back);
    if (new Date(`${date}T12:00:00`).getDay() === 0) continue; // no work on Sunday
    crew.forEach((farmer, i) => {
      if ((i + back) % 4 === 3) return; // not everyone works every day
      const amount = (i + back) % 5 === 0 ? 1500 : 3000;
      const paidNow = (i + back) % 2 === 0;
      const task = TASKS[(back + Math.floor(i / 4)) % TASKS.length]!;
      const site = COOPERATIVES.find((c) => c.id === farmer.cooperativeId)?.district ?? '';
      const earned = post(farmer.id, 'work', amount, `Day's work, ${task}`, date);
      const paid = paidNow ? post(farmer.id, 'payment', amount, "Paid for the day's work", date) : undefined;
      workdays.push({
        id: uid('wdy'),
        farmerId: farmer.id,
        date,
        amount,
        photo: demoPhoto(`${farmer.firstName} ${farmer.lastName}`, date, i),
        photoTakenAt: `${date}T07:${String(10 + (i % 40)).padStart(2, '0')}:00.000Z`,
        task,
        site,
        transactionId: earned.id,
        paidTxId: paid?.id,
        recordedBy: 'acc_demo',
        recordedAt: `${date}T07:${String(12 + (i % 40)).padStart(2, '0')}:00.000Z`,
      });
    });
  }

  /* ---- derive farmer status from what actually happened ---- */
  const byFarmer = new Map<string, LedgerTransaction[]>();
  for (const tx of transactions) {
    const list = byFarmer.get(tx.farmerId) ?? [];
    list.push(tx);
    byFarmer.set(tx.farmerId, list);
  }

  for (const farmer of farmers) {
    const txs = byFarmer.get(farmer.id) ?? [];
    const balance = balanceOf(txs);
    const hasHarvest = harvests.some((h) => h.farmerId === farmer.id);
    const hasPaid = payments.some((p) => p.farmerId === farmer.id && p.status === 'paid');

    let status: FarmerStatus;
    if (farmer.id === disputedFarmer.id) status = 'disputed';
    else if (balance > 0 && (hasHarvest || workdays.some((d) => d.farmerId === farmer.id))) status = 'awaiting_payment';
    else if (hasPaid && balance <= 0) status = 'paid';
    else if (hasHarvest) status = 'harvested';
    else if (activities.some((a) => a.farmerId === farmer.id && a.category === 'farming')) status = 'in_progress';
    else status = 'active';
    farmer.status = status;
  }

  /* ---- notifications ---- */
  const awaiting = farmers.filter((f) => f.status === 'awaiting_payment').length;
  const unverified = harvests.filter((h) => h.status === 'recorded').length;
  const pendingPay = payments.filter((p) => p.status === 'pending').length;

  const notifications: AppNotification[] = [
    { id: uid('ntf'), kind: 'financial', title: `${awaiting} workers are awaiting payment`, body: 'Open Payments, Owed, to pay them.', at: nowStamp(), read: false, link: '#/payments/outstanding' },
    { id: uid('ntf'), kind: 'financial', title: 'Payment batch requires approval', body: `${batch.name} has ${pendingPay} payments still pending approval.`, at: addStamp(-2), read: false, link: '#/payments/batches' },
    { id: uid('ntf'), kind: 'operational', title: `${unverified} harvest records need verification`, body: 'Field entries are waiting for their weight to be checked.', at: addStamp(-5), read: false, link: '#/production/harvests' },
    { id: uid('ntf'), kind: 'financial', title: `Balance adjusted for ${disputedFarmer.code}`, body: 'A 12,000 RWF debit adjustment was posted and is under dispute.', at: addStamp(-26), read: false, link: '#/ledger/transactions' },
    { id: uid('ntf'), kind: 'operational', title: 'New worker registered', body: `${farmers[farmers.length - 1]!.firstName} ${farmers[farmers.length - 1]!.lastName} was added to the register.`, at: addStamp(-50), read: true, link: '#/farmers' },
  ];

  /* ---- counters, so newly created records continue the sequences ---- */
  const counters: Counter[] = [
    { key: 'farmer', value: farmers.length },
    { key: 'transaction', value: txSeq },
    { key: 'payment', value: payments.length },
    { key: 'batch', value: 2 },
  ];

  await db.transaction(
    'rw',
    [db.users, db.cooperatives, db.crops, db.farmers, db.activityTypes, db.activities, db.harvests, db.payments, db.batches, db.transactions, db.workdays, db.audit, db.notifications, db.counters, db.settings],
    async () => {
      // Last line of defence against a concurrent seed: if another run already
      // committed, abandon this one rather than writing duplicate codes.
      if (await db.settings.get('seeded')) return;
      await Promise.all([
        db.users.bulkPut(DEMO_USERS),
        db.cooperatives.bulkPut(COOPERATIVES),
        db.crops.bulkPut(CROPS),
        db.activityTypes.bulkPut(BUILT_IN_ACTIVITY_TYPES),
        db.farmers.bulkPut(farmers),
        db.activities.bulkPut(activities),
        db.harvests.bulkPut(harvests),
        db.payments.bulkPut(payments),
        db.batches.bulkPut(batches),
        db.transactions.bulkPut(transactions),
        db.workdays.bulkPut(workdays),
        db.audit.bulkPut(audit),
        db.notifications.bulkPut(notifications),
        db.counters.bulkPut(counters),
        db.settings.put({ key: 'seeded', value: now }),
      ]);
    },
  );

  return {
    farmers: farmers.length,
    activities: activities.length,
    harvests: harvests.length,
    payments: payments.length,
    transactions: transactions.length,
  };
}

/** A small drawn picture standing in for a work-day photo in the demo. */
function demoPhoto(name: string, date: string, i: number): string {
  const shirts = ['#7aa874', '#c9a26b', '#6f8fb0', '#b07a6f', '#8f7ab0', '#6fb0a6'];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">` +
    `<rect width="320" height="240" fill="#cfe0c4"/>` +
    `<ellipse cx="160" cy="250" rx="100" ry="90" fill="${shirts[i % shirts.length]}"/>` +
    `<circle cx="160" cy="105" r="46" fill="#6b4a35"/>` +
    `<rect y="212" width="320" height="28" fill="#000" fill-opacity=".55"/>` +
    `<text x="8" y="231" font-family="Arial" font-size="13" fill="#fff">${name.replace(/[<&>]/g, '')} · ${date} · demo</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function addStamp(hoursAgo: number): string {
  return new Date(Date.now() + hoursAgo * 3600_000).toISOString();
}

/**
 * Runs once per account database. Safe to call on every boot, and safe to call
 * twice at once: React StrictMode fires the boot effect twice in development,
 * and two concurrent seed runs would collide on the unique transaction codes.
 * The in-flight promise collapses those into one run, and the marker is
 * re-checked inside the write transaction so a second caller cannot slip past.
 */
let seeding: Promise<boolean> | null = null;

export interface NewAccountSeed {
  cooperativeName: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
}

/**
 * A brand-new account starts empty, no farmers, no harvests, no money.
 *
 * What it does get is the reference data the app cannot function without: the
 * crop price list and the activity catalog. Starting with zero crops would mean
 * a farmer could be registered but no harvest could ever be recorded against
 * them, which is an empty app in the unhelpful sense. Every one of these is
 * editable, so a cooperative growing something else can change it.
 */
export async function seedNewAccount(input: NewAccountSeed): Promise<void> {
  const now = nowStamp();

  const owner: User = {
    id: input.ownerId,
    name: input.ownerName,
    email: input.ownerEmail,
    pin: '',
    role: 'super_admin',
    cooperativeId: 'coop_own',
    active: true,
    createdAt: now,
  };

  const cooperative: Cooperative = {
    id: 'coop_own',
    code: input.cooperativeName.slice(0, 3).toUpperCase(),
    name: input.cooperativeName,
    district: '',
    contact: '',
  };

  await db.transaction(
    'rw',
    [db.users, db.cooperatives, db.crops, db.activityTypes, db.settings],
    async () => {
      if (await db.settings.get('seeded')) return;
      await Promise.all([
        db.users.put(owner),
        db.cooperatives.put(cooperative),
        db.crops.bulkPut(CROPS),
        db.activityTypes.bulkPut(BUILT_IN_ACTIVITY_TYPES),
        db.settings.put({ key: 'seeded', value: now }),
        db.settings.put({ key: 'isDemo', value: false }),
      ]);
    },
  );
}

/** Fills the demo account with a full working cooperative. */
export async function ensureDemoSeeded(): Promise<boolean> {
  if (seeding) return seeding;
  seeding = (async () => {
    const marker = await db.settings.get('seeded');
    if (marker) return false;
    await seedDatabase();
    await db.settings.put({ key: 'isDemo', value: true });
    return true;
  })().finally(() => {
    seeding = null;
  });
  return seeding;
}

/**
 * Prepare whichever account just signed in. The demo gets the generated
 * cooperative; everybody else gets an empty book and their own name on it.
 */
export async function prepareAccount(accountId: string, blank: NewAccountSeed): Promise<void> {
  if (accountId === DEMO_ACCOUNT_ID) {
    await ensureDemoSeeded();
    return;
  }
  await seedNewAccount(blank);
}

/** Wipes the current account and regenerates it. Used by the Settings screen. */
export async function resetDatabase(): Promise<SeedResult> {
  await Promise.all(db.tables.map((t) => t.clear()));
  return seedDatabase();
}

/** Clears the current account back to empty, keeping only reference data. */
export async function clearAccountData(input: NewAccountSeed): Promise<void> {
  await Promise.all(db.tables.map((t) => t.clear()));
  await seedNewAccount(input);
}
