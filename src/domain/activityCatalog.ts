/**
 * The activity catalog.
 *
 * Every activity a cooperative records lives here with the fields it needs. The
 * "+" flow reads this catalog to build its picker and then generates the form
 * from `fields`, so adding a new activity type is a data change, not a new
 * screen. Admins can add custom types at runtime; those are stored in the
 * database with `custom: true` and merged into this list.
 */

import type { ActivityCategory, ActivityType, FieldSpec, LedgerTxType } from './types';

export const CATEGORY_META: Record<
  ActivityCategory,
  { label: string; icon: string; blurb: string; accent: string }
> = {
  farming: {
    label: 'Farming',
    icon: 'sprout',
    blurb: 'Everything that happens in the field before harvest',
    accent: 'var(--c-green-600)',
  },
  harvest: {
    label: 'Harvest',
    icon: 'basket',
    blurb: 'Collecting, grading and moving produce',
    accent: 'var(--c-amber-600)',
  },
  operations: {
    label: 'Farm Operations',
    icon: 'tools',
    blurb: 'Inspections, testing, equipment and input distribution',
    accent: 'var(--c-teal-600)',
  },
  logistics: {
    label: 'Logistics',
    icon: 'truck',
    blurb: 'Pickup, delivery, warehouse and inventory movement',
    accent: 'var(--c-blue-600)',
  },
  financial: {
    label: 'Financial',
    icon: 'coins',
    blurb: 'Anything that changes what a farmer is owed',
    accent: 'var(--c-purple-600)',
  },
  other: {
    label: 'Other',
    icon: 'dots',
    blurb: 'Training, meetings, visits and custom records',
    accent: 'var(--c-slate-600)',
  },
};

/* ------------------------------------------------------- reusable fields */

const notes: FieldSpec = { key: 'notes', label: 'Notes', type: 'textarea' };
const attachment: FieldSpec = {
  key: 'attachment',
  label: 'Supporting document or photo',
  type: 'file',
  help: 'Stored on the device, available offline.',
};

const area = (label = 'Area covered'): FieldSpec => ({
  key: 'areaHa',
  label,
  type: 'number',
  unit: 'ha',
  min: 0,
  half: true,
});

const UNIT_OPTIONS = [
  { value: 'KG', label: 'Kilogram (KG)' },
  { value: 'TONNE', label: 'Tonne' },
  { value: 'BAG', label: 'Bag' },
  { value: 'CRATE', label: 'Crate' },
  { value: 'LITRE', label: 'Litre' },
  { value: 'BUNCH', label: 'Bunch' },
  { value: 'PIECE', label: 'Piece' },
];

const GRADE_OPTIONS = [
  { value: 'A', label: 'Grade A, premium' },
  { value: 'B', label: 'Grade B, standard' },
  { value: 'C', label: 'Grade C, low' },
  { value: 'REJECT', label: 'Reject, not accepted' },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: 'mobile_money', label: 'Mobile money' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'cheque', label: 'Cheque' },
];

const amount = (label: string, help?: string): FieldSpec => ({
  key: 'amount',
  label,
  type: 'currency',
  required: true,
  min: 1,
  help,
});

const reference: FieldSpec = {
  key: 'reference',
  label: 'Reference number',
  type: 'text',
  half: true,
  help: 'Mobile money or bank reference, if any.',
};

const reason = (help: string): FieldSpec => ({ key: 'reason', label: 'Reason', type: 'text', required: true, help });

/** Fields shared by every harvest-style intake. */
const produceFields: FieldSpec[] = [
  { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 0, half: true },
  { key: 'unit', label: 'Unit', type: 'select', required: true, options: UNIT_OPTIONS, half: true },
  { key: 'grade', label: 'Quality grade', type: 'select', required: true, options: GRADE_OPTIONS, half: true },
  {
    key: 'pricePerUnit',
    label: 'Price per unit',
    type: 'currency',
    required: true,
    min: 0,
    half: true,
    help: 'Prefilled from the crop price list. Override for a negotiated price.',
  },
  {
    key: 'deductions',
    label: 'Deductions at intake',
    type: 'currency',
    min: 0,
    half: true,
    help: 'Transport, drying or packaging withheld from this delivery.',
  },
  {
    key: 'grossValue',
    label: 'Total value',
    type: 'currency',
    computed: 'grossValue',
    half: true,
    help: 'Quantity x price per unit. Calculated, not typed.',
  },
];

function type(
  id: string,
  label: string,
  category: ActivityCategory,
  icon: string,
  fields: FieldSpec[],
  extra: Partial<ActivityType> = {},
): ActivityType {
  return { id, label, category, icon, fields, ...extra };
}

/* -------------------------------------------------------------- catalog */

export const BUILT_IN_ACTIVITY_TYPES: ActivityType[] = [
  /* ---- Farming ---- */
  type('land_preparation', 'Land preparation', 'farming', 'shovel', [area(), notes]),
  type('plowing', 'Plowing', 'farming', 'tractor', [
    area(),
    { key: 'method', label: 'Method', type: 'select', half: true, options: [
      { value: 'manual', label: 'Manual' },
      { value: 'ox', label: 'Ox plough' },
      { value: 'tractor', label: 'Tractor' },
    ] },
    notes,
  ]),
  type('planting', 'Planting', 'farming', 'seedling', [
    area('Area planted'),
    { key: 'seedQuantity', label: 'Seed quantity', type: 'number', unit: 'KG', min: 0, half: true },
    { key: 'seedVariety', label: 'Seed variety', type: 'text', half: true },
    { key: 'season', label: 'Season', type: 'text', half: true, help: 'e.g. 2026 A' },
    notes,
  ], { description: 'Sowing the crop for the season.' }),
  type('seeding', 'Seeding', 'farming', 'seedling', [
    area('Area seeded'),
    { key: 'seedQuantity', label: 'Seed quantity', type: 'number', unit: 'KG', min: 0, half: true },
    notes,
  ]),
  type('fertilizing', 'Fertilizing', 'farming', 'flask', [
    { key: 'inputName', label: 'Fertilizer', type: 'text', required: true, half: true },
    { key: 'inputQuantity', label: 'Quantity applied', type: 'number', unit: 'KG', min: 0, half: true },
    area('Area covered'),
    notes,
  ]),
  type('irrigation', 'Irrigation', 'farming', 'droplet', [
    area(),
    { key: 'hours', label: 'Duration', type: 'number', unit: 'hours', min: 0, half: true },
    { key: 'waterSource', label: 'Water source', type: 'text', half: true },
    notes,
  ]),
  type('weeding', 'Weeding', 'farming', 'sprout', [
    area(),
    { key: 'labourers', label: 'Labourers', type: 'number', min: 0, half: true },
    notes,
  ]),
  type('pest_control', 'Pest control', 'farming', 'bug', [
    { key: 'pest', label: 'Pest observed', type: 'text', half: true },
    { key: 'inputName', label: 'Pesticide used', type: 'text', half: true },
    { key: 'inputQuantity', label: 'Quantity', type: 'number', unit: 'L', min: 0, half: true },
    area(),
    notes,
  ]),
  type('spraying', 'Spraying', 'farming', 'spray', [
    { key: 'inputName', label: 'Product sprayed', type: 'text', required: true, half: true },
    { key: 'inputQuantity', label: 'Quantity', type: 'number', unit: 'L', min: 0, half: true },
    area(),
    notes,
  ]),
  type('disease_treatment', 'Disease treatment', 'farming', 'shield', [
    { key: 'disease', label: 'Disease', type: 'text', required: true, half: true },
    { key: 'treatment', label: 'Treatment applied', type: 'text', half: true },
    area('Area affected'),
    notes,
  ]),
  type('pruning', 'Pruning', 'farming', 'scissors', [area(), notes]),
  type('crop_monitoring', 'Crop monitoring', 'farming', 'eye', [
    { key: 'condition', label: 'Crop condition', type: 'select', half: true, options: [
      { value: 'excellent', label: 'Excellent' },
      { value: 'good', label: 'Good' },
      { value: 'fair', label: 'Fair' },
      { value: 'poor', label: 'Poor' },
    ] },
    { key: 'expectedYield', label: 'Expected yield', type: 'number', unit: 'KG', min: 0, half: true },
    notes,
    attachment,
  ]),

  /* ---- Harvest ---- */
  type('harvesting', 'Harvesting', 'harvest', 'basket', [...produceFields, notes, attachment], {
    createsHarvest: true,
    postsLedger: 'harvest',
    description: 'Records produce received and credits the farmer account.',
  }),
  type('collection', 'Collection', 'harvest', 'box', [...produceFields, notes], {
    createsHarvest: true,
    postsLedger: 'harvest',
    description: 'Produce collected from the farm gate.',
  }),
  type('sorting', 'Sorting', 'harvest', 'filter', [
    { key: 'quantity', label: 'Quantity sorted', type: 'number', min: 0, half: true },
    { key: 'unit', label: 'Unit', type: 'select', options: UNIT_OPTIONS, half: true },
    { key: 'rejected', label: 'Quantity rejected', type: 'number', min: 0, half: true },
    notes,
  ]),
  type('grading', 'Grading', 'harvest', 'star', [
    { key: 'quantity', label: 'Quantity graded', type: 'number', min: 0, half: true },
    { key: 'unit', label: 'Unit', type: 'select', options: UNIT_OPTIONS, half: true },
    { key: 'grade', label: 'Grade assigned', type: 'select', required: true, options: GRADE_OPTIONS, half: true },
    notes,
  ]),
  type('weighing', 'Weighing', 'harvest', 'scale', [
    { key: 'quantity', label: 'Weight recorded', type: 'number', required: true, min: 0, half: true },
    { key: 'unit', label: 'Unit', type: 'select', required: true, options: UNIT_OPTIONS, half: true },
    { key: 'scaleId', label: 'Scale / station', type: 'text', half: true },
    notes,
  ]),
  type('packaging', 'Packaging', 'harvest', 'package', [
    { key: 'packages', label: 'Packages', type: 'number', min: 0, half: true },
    { key: 'packageType', label: 'Package type', type: 'text', half: true },
    notes,
  ]),
  type('storage', 'Storage', 'harvest', 'warehouse', [
    { key: 'quantity', label: 'Quantity stored', type: 'number', min: 0, half: true },
    { key: 'unit', label: 'Unit', type: 'select', options: UNIT_OPTIONS, half: true },
    { key: 'location', label: 'Store / warehouse', type: 'text', half: true },
    notes,
  ]),
  type('delivery', 'Delivery', 'harvest', 'truck', [
    { key: 'quantity', label: 'Quantity delivered', type: 'number', min: 0, half: true },
    { key: 'unit', label: 'Unit', type: 'select', options: UNIT_OPTIONS, half: true },
    { key: 'destination', label: 'Destination', type: 'text', half: true },
    { key: 'vehicle', label: 'Vehicle / plate', type: 'text', half: true },
    notes,
  ]),

  /* ---- Farm operations ---- */
  type('farm_inspection', 'Farm inspection', 'operations', 'clipboard', [
    { key: 'outcome', label: 'Outcome', type: 'select', half: true, options: [
      { value: 'pass', label: 'Pass' },
      { value: 'follow_up', label: 'Needs follow-up' },
      { value: 'fail', label: 'Fail' },
    ] },
    { key: 'inspector', label: 'Inspector', type: 'text', half: true },
    notes,
    attachment,
  ]),
  type('soil_testing', 'Soil testing', 'operations', 'flask', [
    { key: 'ph', label: 'Soil pH', type: 'number', min: 0, max: 14, half: true },
    { key: 'organicMatter', label: 'Organic matter', type: 'number', unit: '%', min: 0, half: true },
    { key: 'recommendation', label: 'Recommendation', type: 'textarea' },
    attachment,
  ]),
  type('equipment_usage', 'Equipment usage', 'operations', 'tools', [
    { key: 'equipment', label: 'Equipment', type: 'text', required: true, half: true },
    { key: 'hours', label: 'Hours used', type: 'number', min: 0, half: true },
    notes,
  ]),
  type('equipment_maintenance', 'Equipment maintenance', 'operations', 'wrench', [
    { key: 'equipment', label: 'Equipment', type: 'text', required: true, half: true },
    { key: 'cost', label: 'Maintenance cost', type: 'currency', min: 0, half: true },
    notes,
  ]),
  type('input_distribution', 'Input distribution', 'operations', 'box', [
    { key: 'inputName', label: 'Input', type: 'text', required: true, half: true },
    { key: 'inputQuantity', label: 'Quantity', type: 'number', min: 0, half: true },
    { key: 'unit', label: 'Unit', type: 'select', options: UNIT_OPTIONS, half: true },
    {
      key: 'onCredit',
      label: 'Issued on credit',
      type: 'select',
      half: true,
      help: 'On credit posts a debit to the farmer account, recovered at harvest.',
      options: [
        { value: 'no', label: 'No, free / already paid' },
        { value: 'yes', label: 'Yes, recover from harvest' },
      ],
    },
    { key: 'value', label: 'Value of inputs', type: 'currency', min: 0, half: true },
    notes,
  ]),
  type('seed_distribution', 'Seed distribution', 'operations', 'seedling', [
    { key: 'inputName', label: 'Seed variety', type: 'text', required: true, half: true },
    { key: 'inputQuantity', label: 'Quantity', type: 'number', unit: 'KG', min: 0, half: true },
    { key: 'value', label: 'Value', type: 'currency', min: 0, half: true },
    notes,
  ]),
  type('fertilizer_distribution', 'Fertilizer distribution', 'operations', 'flask', [
    { key: 'inputName', label: 'Fertilizer', type: 'text', required: true, half: true },
    { key: 'inputQuantity', label: 'Quantity', type: 'number', unit: 'KG', min: 0, half: true },
    { key: 'value', label: 'Value', type: 'currency', min: 0, half: true },
    notes,
  ]),
  type('pesticide_distribution', 'Pesticide distribution', 'operations', 'spray', [
    { key: 'inputName', label: 'Pesticide', type: 'text', required: true, half: true },
    { key: 'inputQuantity', label: 'Quantity', type: 'number', unit: 'L', min: 0, half: true },
    { key: 'value', label: 'Value', type: 'currency', min: 0, half: true },
    notes,
  ]),

  /* ---- Logistics ---- */
  type('produce_pickup', 'Produce pickup', 'logistics', 'truck', [
    { key: 'quantity', label: 'Quantity', type: 'number', min: 0, half: true },
    { key: 'unit', label: 'Unit', type: 'select', options: UNIT_OPTIONS, half: true },
    { key: 'vehicle', label: 'Vehicle / plate', type: 'text', half: true },
    { key: 'driver', label: 'Driver', type: 'text', half: true },
    notes,
  ]),
  type('produce_delivery', 'Produce delivery', 'logistics', 'truck', [
    { key: 'quantity', label: 'Quantity', type: 'number', min: 0, half: true },
    { key: 'unit', label: 'Unit', type: 'select', options: UNIT_OPTIONS, half: true },
    { key: 'destination', label: 'Destination', type: 'text', required: true, half: true },
    { key: 'vehicle', label: 'Vehicle / plate', type: 'text', half: true },
    notes,
  ]),
  type('warehouse_intake', 'Warehouse intake', 'logistics', 'warehouse', [
    { key: 'quantity', label: 'Quantity received', type: 'number', required: true, min: 0, half: true },
    { key: 'unit', label: 'Unit', type: 'select', required: true, options: UNIT_OPTIONS, half: true },
    { key: 'location', label: 'Warehouse', type: 'text', half: true },
    { key: 'grade', label: 'Grade on arrival', type: 'select', options: GRADE_OPTIONS, half: true },
    notes,
  ]),
  type('transportation', 'Transportation', 'logistics', 'truck', [
    { key: 'from', label: 'From', type: 'text', half: true },
    { key: 'destination', label: 'To', type: 'text', half: true },
    { key: 'cost', label: 'Transport cost', type: 'currency', min: 0, half: true },
    notes,
  ]),
  type('inventory_movement', 'Inventory movement', 'logistics', 'arrows', [
    { key: 'from', label: 'From location', type: 'text', half: true },
    { key: 'destination', label: 'To location', type: 'text', half: true },
    { key: 'quantity', label: 'Quantity', type: 'number', min: 0, half: true },
    { key: 'unit', label: 'Unit', type: 'select', options: UNIT_OPTIONS, half: true },
    notes,
  ]),

  /* ---- Financial ---- */
  type('farmer_payment', 'Farmer payment', 'financial', 'coins', [
    amount('Amount paid', 'Checked against the farmer outstanding balance before posting.'),
    { key: 'method', label: 'Payment method', type: 'select', required: true, options: PAYMENT_METHOD_OPTIONS, half: true },
    reference,
    reason('What this payment settles, e.g. August maize delivery.'),
    notes,
  ], { postsLedger: 'payment', description: 'Records money you have already paid a farmer, and debits their account.' }),

  type('advance_payment', 'Advance payment', 'financial', 'hand-coins', [
    amount('Advance amount', 'Money already handed over. Recovered automatically from future harvest credits.'),
    { key: 'method', label: 'Payment method', type: 'select', required: true, options: PAYMENT_METHOD_OPTIONS, half: true },
    reference,
    reason('Why the advance is being issued.'),
    notes,
  ], { postsLedger: 'advance', description: 'Money handed over before harvest, carried as a negative balance.' }),

  type('bonus', 'Bonus', 'financial', 'gift', [
    amount('Bonus amount'),
    reason('Quality, loyalty or volume bonus.'),
    notes,
  ], { postsLedger: 'bonus', description: 'Credits the farmer account.' }),

  type('deduction', 'Deduction', 'financial', 'minus-circle', [
    amount('Deduction amount'),
    reason('Transport, drying, losses or repayment.'),
    notes,
  ], { postsLedger: 'deduction', description: 'Withholds money from what the farmer is owed.' }),

  type('loan', 'Loan / credit', 'financial', 'bank', [
    amount('Loan amount'),
    { key: 'dueDate', label: 'Expected recovery date', type: 'date', half: true },
    reason('Purpose of the loan.'),
    notes,
  ], { postsLedger: 'loan', description: 'Inputs or cash extended on credit.' }),

  type('reimbursement', 'Reimbursement', 'financial', 'receipt', [
    amount('Reimbursement amount'),
    reason('What the farmer spent on behalf of the cooperative.'),
    attachment,
    notes,
  ], { postsLedger: 'reimbursement', description: 'Credits the farmer for money they fronted.' }),

  type('adjustment', 'Adjustment', 'financial', 'edit', [
    amount('Adjustment amount'),
    {
      key: 'direction',
      label: 'Direction',
      type: 'select',
      required: true,
      half: true,
      help: 'Credit increases what the farmer is owed. Debit reduces it.',
      options: [
        { value: 'credit', label: 'Credit, increase what we owe' },
        { value: 'debit', label: 'Debit, reduce what we owe' },
      ],
    },
    reason('Correction being made. Required for the audit trail.'),
    notes,
  ], { postsLedger: 'adjustment', description: 'Accountant correction. Always leaves an audit entry.' }),

  /* ---- Other ---- */
  type('training', 'Training', 'other', 'graduation', [
    { key: 'topic', label: 'Topic', type: 'text', required: true, half: true },
    { key: 'hours', label: 'Duration', type: 'number', unit: 'hours', min: 0, half: true },
    { key: 'trainer', label: 'Trainer', type: 'text', half: true },
    notes,
  ]),
  type('meeting', 'Meeting', 'other', 'users', [
    { key: 'topic', label: 'Subject', type: 'text', required: true, half: true },
    { key: 'attendees', label: 'Attendees', type: 'number', min: 0, half: true },
    notes,
  ]),
  type('field_visit', 'Field visit', 'other', 'map-pin', [
    { key: 'officer', label: 'Officer', type: 'text', half: true },
    { key: 'purpose', label: 'Purpose', type: 'text', half: true },
    notes,
    attachment,
  ]),
  type('contract_signing', 'Contract signing', 'other', 'file-signature', [
    { key: 'contractRef', label: 'Contract reference', type: 'text', required: true, half: true },
    { key: 'committedQuantity', label: 'Committed quantity', type: 'number', min: 0, half: true },
    { key: 'unit', label: 'Unit', type: 'select', options: UNIT_OPTIONS, half: true },
    attachment,
    notes,
  ]),
  type('quality_inspection', 'Quality inspection', 'other', 'badge-check', [
    { key: 'grade', label: 'Grade assigned', type: 'select', required: true, options: GRADE_OPTIONS, half: true },
    { key: 'inspector', label: 'Inspector', type: 'text', half: true },
    { key: 'outcome', label: 'Outcome', type: 'select', half: true, options: [
      { value: 'accepted', label: 'Accepted' },
      { value: 'accepted_with_deduction', label: 'Accepted with deduction' },
      { value: 'rejected', label: 'Rejected' },
    ] },
    notes,
    attachment,
  ]),
  type('custom', 'Custom activity', 'other', 'plus', [
    { key: 'title', label: 'Activity name', type: 'text', required: true },
    notes,
    attachment,
  ], { description: 'A one-off record that does not fit the catalog.' }),
];

/** Activity types that move money, used to gate the picker by permission. */
export const FINANCIAL_TYPE_IDS = new Set(
  BUILT_IN_ACTIVITY_TYPES.filter((t) => t.postsLedger).map((t) => t.id),
);

export function ledgerTypeFor(activityType: ActivityType): LedgerTxType | undefined {
  return activityType.postsLedger;
}

export function findType(types: ActivityType[], id: string): ActivityType | undefined {
  return types.find((t) => t.id === id);
}

/** Group a catalog into the categories the picker renders. */
export function byCategory(types: ActivityType[]): { category: ActivityCategory; types: ActivityType[] }[] {
  const order: ActivityCategory[] = ['farming', 'harvest', 'operations', 'logistics', 'financial', 'other'];
  return order
    .map((category) => ({ category, types: types.filter((t) => t.category === category) }))
    .filter((g) => g.types.length > 0);
}

export { UNIT_OPTIONS, GRADE_OPTIONS, PAYMENT_METHOD_OPTIONS };
