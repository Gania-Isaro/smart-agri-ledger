/**
 * The crop price list. Each crop has a unit and a usual price per unit, used
 * to fill in the form when produce is recorded. The owner keeps the list:
 * adds crops, changes prices, and removes crops nobody has used. A manager
 * can add a crop their group grows, but not its price: it starts with no
 * price until the owner sets one.
 */

import { db } from '../db/db';
import { uid } from '../lib/id';
import { toPositiveMoney } from '../domain/money';
import { assertCan, can } from '../domain/rbac';
import type { Crop, ID, Unit, User } from '../domain/types';
import * as audit from './audit';
import { ValidationError } from './farmerService';
import { tx } from '../i18n/tx';

export const UNITS: Unit[] = ['KG', 'TONNE', 'BAG', 'CRATE', 'LITRE', 'BUNCH', 'PIECE'];

export interface CropInput {
  id?: ID;
  name: string;
  unit: Unit;
  price: number | string;
}

export async function saveCrop(user: User, input: CropInput): Promise<Crop> {
  const owner = can(user, 'settings.manage');
  // Anyone who records produce may add a crop; changing one, or pricing it, is the owner's.
  if (!owner) {
    assertCan(user, 'harvest.create');
    if (input.id) assertCan(user, 'settings.manage');
  }
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name.length < 2) throw new ValidationError(tx('Give the crop a name.'), 'name');
  if (!UNITS.includes(input.unit)) throw new ValidationError(tx('Choose a unit.'), 'unit');
  const price = owner ? toPositiveMoney(input.price, 'Price') : 0;

  const all = await db.crops.toArray();
  if (all.some((c) => c.id !== input.id && c.name.toLowerCase() === name.toLowerCase())) {
    throw new ValidationError(tx('{name} is already on the list.', { name }), 'name');
  }

  const before = input.id ? await db.crops.get(input.id) : undefined;
  if (input.id && !before) throw new ValidationError(tx('That crop no longer exists.'));
  const crop: Crop = {
    id: before?.id ?? uid('crop'),
    name,
    defaultUnit: input.unit,
    defaultPricePerUnit: price,
    colour: before?.colour ?? `var(--cat-${(all.length % 8) + 1})`,
    // A name the owner typed is shown as typed, in both languages.
    renamed: before ? before.renamed || before.name !== name : true,
  };
  await db.crops.put(crop);
  await audit.record(
    user,
    'crop',
    crop.id,
    before ? 'update' : 'create',
    before ? `Crop ${before.name} set to ${crop.name}, ${price} RWF per ${crop.defaultUnit}` : `Added crop ${crop.name}, ${price} RWF per ${crop.defaultUnit}`,
    { before, after: crop },
  );
  return crop;
}

/** How many records use a crop. A crop in use cannot be deleted, or those records would lose it. */
export async function cropUse(id: ID): Promise<number> {
  const [workers, harvests, activities] = await Promise.all([
    db.farmers.where('primaryCropId').equals(id).count(),
    db.harvests.where('cropId').equals(id).count(),
    db.activities.where('cropId').equals(id).count(),
  ]);
  return workers + harvests + activities;
}

export async function deleteCrop(user: User, id: ID): Promise<void> {
  assertCan(user, 'settings.manage');
  const before = await db.crops.get(id);
  if (!before) throw new ValidationError(tx('That crop no longer exists.'));
  const used = await cropUse(id);
  if (used > 0) {
    throw new ValidationError(tx('{name} is used by {count} workers or records, so it cannot be deleted. You can still rename it or change its price.', { name: before.name, count: used }));
  }
  if ((await db.crops.count()) <= 1) throw new ValidationError(tx('Keep at least one crop.'));
  await db.crops.delete(id);
  await audit.record(user, 'crop', id, 'delete', `Deleted crop ${before.name}`, { before });
}
