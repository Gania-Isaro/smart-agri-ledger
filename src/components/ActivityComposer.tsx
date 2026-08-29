/**
 * The "+" flow.
 *
 * Two steps, never more: pick what happened, then describe it. The form is
 * generated from the activity type's field spec, so "Planting" and "Payment"
 * ask completely different questions without either being a bespoke screen.
 *
 * Anything money-related shows the farmer's live balance and what the entry
 * will do to it before the user commits. The single most useful thing this
 * screen can show, and the reason a cooperative would trust it over a notebook.
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal } from './ui/Modal';
import { Icon, type IconName } from './ui/Icon';
import { Button, Callout, Field, Input, MoneyInput, Select, Textarea } from './ui/primitives';
import { useLookups, useStore } from '../state/store';
import { byCategory, CATEGORY_META } from '../domain/activityCatalog';
import {
  allowedTypes,
  ConfirmationRequired,
  createActivity,
  createActivityType,
  CUSTOM_FIELD_LIBRARY,
} from '../services/activityService';
import { financialsFor } from '../services/ledgerService';
import { db } from '../db/db';
import { grossValue, formatMoney } from '../domain/money';
import { today } from '../lib/date';
import { readFileDataURL } from '../lib/csv';
import { uid } from '../lib/id';
import type { ActivityCategory, ActivityType, Farmer, FieldSpec } from '../domain/types';
import { usePrefs } from '../i18n';
import { Checkbox } from './ui/primitives';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Preselect a farmer when opened from a profile page. */
  farmerId?: string;
  /** Skip the picker when a screen already knows what is being recorded. */
  typeId?: string;
  onDone?: () => void;
}

export function ActivityComposer({ open, onClose, farmerId, typeId, onDone }: Props) {
  const { user, activityTypes, can, refresh, toast, fail, confirm } = useStore();
  const { t, tActivity } = usePrefs();
  const [type, setType] = useState<ActivityType | null>(null);
  const [query, setQuery] = useState('');
  const [newTypeOpen, setNewTypeOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setType(null);
      setQuery('');
      return;
    }
    if (typeId) setType(activityTypes.find((t) => t.id === typeId) ?? null);
  }, [open, typeId, activityTypes]);

  const permitted = useMemo(() => allowedTypes(user, activityTypes), [user, activityTypes]);
  const locked = useMemo(
    () => new Set(activityTypes.filter((t) => !permitted.some((p) => p.id === t.id)).map((t) => t.id)),
    [activityTypes, permitted],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activityTypes;
    return activityTypes.filter(
      (at) =>
        at.label.toLowerCase().includes(q) ||
        tActivity(at.id, at.label).toLowerCase().includes(q) ||
        CATEGORY_META[at.category].label.toLowerCase().includes(q),
    );
  }, [activityTypes, query, tActivity]);

  if (!open) return null;

  if (!type) {
    return (
      <Modal
        open
        onClose={onClose}
        title={t('composer.pickTitle')}
        subtitle={t('composer.pickSub')}
        size="wide"
        flush
        dismissOnBackdrop
      >
        <div className="picker">
          <div className="picker__search">
            <div className="searchbox" style={{ maxWidth: 'none' }}>
              <span className="searchbox__icon">
                <Icon name="search" size={15} />
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('composer.searchTypes')}
                aria-label={t('composer.searchTypes')}
                autoFocus
              />
            </div>
          </div>

          <div className="picker__body">
            {byCategory(filtered).map(({ category, types }) => {
              const meta = CATEGORY_META[category];
              return (
                <section key={category}>
                  <div className="picker__cat">
                    <span
                      className="picktile__icon"
                      style={{ width: 26, height: 26, background: 'var(--c-cream-300)' }}
                    >
                      <Icon name={meta.icon as IconName} size={15} />
                    </span>
                    <div>
                      <div className="picker__catname">{t(`cat.${category}`)}</div>
                      <div className="picker__catblurb">{t(`cat.${category}.blurb`)}</div>
                    </div>
                  </div>

                  <div className="picker__grid">
                    {types.map((at) => {
                      const isLocked = locked.has(at.id);
                      const tone =
                        at.category === 'financial'
                          ? 'money'
                          : at.category === 'harvest'
                            ? 'harvest'
                            : at.category === 'farming'
                              ? 'farming'
                              : '';
                      return (
                        <button
                          key={at.id}
                          className={`picktile ${tone ? `picktile--${tone}` : ''} ${isLocked ? 'picktile--locked' : ''}`}
                          onClick={() => !isLocked && setType(at)}
                          disabled={isLocked}
                          title={isLocked ? t('composer.notYourRole') : at.description}
                        >
                          <span className="picktile__icon">
                            <Icon name={(at.icon as IconName) ?? 'dots'} size={16} />
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span className="picktile__label" style={{ display: 'block' }}>
                              {tActivity(at.id, at.label)}
                            </span>
                            {isLocked ? (
                              <span className="picktile__hint">
                                <Icon name="lock" size={9} style={{ display: 'inline' }} /> {t('composer.notYourRole')}
                              </span>
                            ) : at.postsLedger ? (
                              <span className="picktile__hint">{t('composer.postsLedger')}</span>
                            ) : at.custom ? (
                              <span className="picktile__hint">{t('composer.yourType')}</span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {filtered.length === 0 && (
              <p className="muted" style={{ textAlign: 'center', padding: 'var(--s-6)' }}>
                {t('composer.noMatch', { query })}
              </p>
            )}

            {/* Cooperatives do things this catalog has never heard of. Rather
                than force them into "Custom activity" every time, let an admin
                add a named type once and have it appear here from then on. */}
            {can('settings.manage') && (
              <button
                className="picktile"
                style={{ borderStyle: 'dashed', justifyContent: 'center' }}
                onClick={() => setNewTypeOpen(true)}
              >
                <span className="picktile__icon">
                  <Icon name="plus" size={16} />
                </span>
                <span>
                  <span className="picktile__label" style={{ display: 'block' }}>
                    {t('action.newActivityType')}
                  </span>
                  <span className="picktile__hint">{t('composer.newTypeHint')}</span>
                </span>
              </button>
            )}
          </div>
        </div>

        {newTypeOpen && (
          <NewActivityTypeModal
            onClose={() => setNewTypeOpen(false)}
            onCreated={(created) => {
              setNewTypeOpen(false);
              refresh();
              toast({ tone: 'success', title: t('composer.typeCreated', { label: created.label }) });
              setType(created);
            }}
          />
        )}
      </Modal>
    );
  }

  return (
    <ActivityForm
      type={type}
      farmerId={farmerId}
      onBack={typeId ? undefined : () => setType(null)}
      onClose={onClose}
      onSaved={() => {
        refresh();
        onDone?.();
        onClose();
      }}
      helpers={{ toast, fail, confirm, user }}
      createActivity={createActivity}
    />
  );
}

/* -------------------------------------------------------------- the form */

function ActivityForm({
  type,
  farmerId,
  onBack,
  onClose,
  onSaved,
  helpers,
}: {
  type: ActivityType;
  farmerId?: string;
  onBack?: () => void;
  onClose: () => void;
  onSaved: () => void;
  helpers: {
    user: ReturnType<typeof useStore>['user'];
    toast: ReturnType<typeof useStore>['toast'];
    fail: ReturnType<typeof useStore>['fail'];
    confirm: ReturnType<typeof useStore>['confirm'];
  };
  createActivity: typeof createActivity;
}) {
  const { crops } = useStore();
  const lookups = useLookups();
  const { t, tActivity, tCrop } = usePrefs();
  const { user, toast, fail, confirm } = helpers;

  const [farmers, setFarmers] = useState<Farmer[]>([]);
  const [selectedFarmer, setSelectedFarmer] = useState(farmerId ?? '');
  const [date, setDate] = useState(today());
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [attachment, setAttachment] = useState<{ name: string; dataUrl: string; mime: string; size: number } | null>(null);

  useEffect(() => {
    void db.farmers.toArray().then((rows) => setFarmers(rows.filter((f) => !f.archived).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))));
  }, []);

  /* Prefill the crop price so the field officer types one number, not three. */
  const farmer = farmers.find((f) => f.id === selectedFarmer);
  useEffect(() => {
    if (!farmer || !type.createsHarvest) return;
    const crop = crops.find((c) => c.id === farmer.primaryCropId);
    if (!crop) return;
    setValues((v) => ({
      ...v,
      cropId: v.cropId || crop.id,
      unit: v.unit || crop.defaultUnit,
      pricePerUnit: v.pricePerUnit || String(crop.defaultPricePerUnit),
      grade: v.grade || 'A',
    }));
  }, [farmer, crops, type.createsHarvest]);

  /* Show what the account looks like right now, before anything is posted. */
  useEffect(() => {
    if (!selectedFarmer || !type.postsLedger) {
      setBalance(null);
      return;
    }
    void financialsFor(selectedFarmer).then((f) => setBalance(f.balance));
  }, [selectedFarmer, type.postsLedger]);

  const set = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: '' } : e));
  };

  const quantity = Number(values.quantity ?? 0);
  const price = Number(values.pricePerUnit ?? 0);
  const deductions = Number(values.deductions ?? 0);
  const gross = Number.isFinite(quantity) && Number.isFinite(price) ? grossValue(quantity || 0, price || 0) : 0;
  const amount = Number(values.amount ?? 0);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    if (!selectedFarmer) {
      setErrors({ farmerId: 'Choose the farmer this belongs to.' });
      return;
    }

    setSaving(true);
    const payload = {
      farmerId: selectedFarmer,
      typeId: type.id,
      date,
      cropId: values.cropId || undefined,
      notes: notes.trim() || undefined,
      data: { ...values } as Record<string, string | number | undefined>,
      documentIds: [] as string[],
    };

    try {
      if (attachment) {
        const docId = uid('doc');
        await db.documents.put({
          id: docId,
          farmerId: selectedFarmer,
          name: attachment.name,
          mime: attachment.mime,
          size: attachment.size,
          dataUrl: attachment.dataUrl,
          uploadedBy: user.id,
          uploadedAt: new Date().toISOString(),
        });
        payload.documentIds = [docId];
      }

      try {
        await createActivity(user, payload);
      } catch (err) {
        // An over-balance payment is legal, but it must be a decision.
        if ((err as Error).name === 'ConfirmationRequired') {
          const detail = (err as ConfirmationRequired).detail;
          const answer = await confirm({
            title: 'Pay more than the balance?',
            message: (
              <>
                <p>{(err as Error).message}</p>
                <p style={{ marginTop: 'var(--s-3)' }}>
                  The extra <b>{formatMoney(detail.amount - detail.balance)}</b> will sit on the account as an advance
                  and be recovered from the next delivery.
                </p>
              </>
            ),
            confirmLabel: 'Yes, pay this amount',
            tone: 'danger',
          });
          if (!answer.ok) {
            setSaving(false);
            return;
          }
          await createActivity(user, { ...payload, confirmOverdraft: true });
        } else {
          throw err;
        }
      }

      toast({
        tone: 'success',
        title: `${type.label} recorded`,
        message: farmer ? `${farmer.firstName} ${farmer.lastName} · ${farmer.code}` : undefined,
      });
      onSaved();
    } catch (err) {
      const e2 = err as Error & { field?: string };
      if (e2.name === 'ValidationError' && e2.field) setErrors({ [e2.field]: e2.message });
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const cropOptions = crops.map((c) => ({ value: c.id, label: tCrop(c.id, c.name) }));
  const farmerOptions = farmers.map((f) => ({
    value: f.id,
    label: `${f.code}, ${f.firstName} ${f.lastName} · ${f.village}, ${f.district}`,
  }));

  const isMoney = Boolean(type.postsLedger && !type.createsHarvest);
  const projected =
    balance === null
      ? null
      : type.postsLedger === 'payment' || type.postsLedger === 'advance' || type.postsLedger === 'deduction' || type.postsLedger === 'loan'
        ? balance - (amount || 0)
        : type.postsLedger === 'adjustment'
          ? balance + (values.direction === 'credit' ? amount || 0 : -(amount || 0))
          : balance + (amount || 0);

  return (
    <Modal
      open
      onClose={onClose}
      title={tActivity(type.id, type.label)}
      subtitle={type.description ?? t(`cat.${type.category}.blurb`)}
      footer={
        <>
          {onBack && (
            <Button variant="ghost" icon="arrow-left" onClick={onBack}>
              {t('action.back')}
            </Button>
          )}
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="activity-form" loading={saving} icon="check">
            {t('action.save')}
          </Button>
        </>
      }
    >
      <form id="activity-form" onSubmit={submit} className="stack gap-4">
        <div className="formgrid">
          <Field label={t('field.farmer')} required error={errors.farmerId} full={!type.createsHarvest}>
            <Select
              options={farmerOptions}
              placeholder={`${t('field.farmer')}…`}
              value={selectedFarmer}
              onChange={(e) => {
                setSelectedFarmer(e.target.value);
                setErrors((x) => ({ ...x, farmerId: '' }));
              }}
              invalid={Boolean(errors.farmerId)}
              disabled={Boolean(farmerId)}
            />
          </Field>

          {type.createsHarvest && (
            <Field label={t('field.crop')} required>
              <Select
                options={cropOptions}
                placeholder={`${t('field.crop')}…`}
                value={values.cropId ?? ''}
                onChange={(e) => {
                  const crop = crops.find((c) => c.id === e.target.value);
                  set('cropId', e.target.value);
                  if (crop) {
                    set('unit', crop.defaultUnit);
                    set('pricePerUnit', String(crop.defaultPricePerUnit));
                  }
                }}
              />
            </Field>
          )}

          <Field label={t('field.date')} required error={errors.date} half>
            <Input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} invalid={Boolean(errors.date)} />
          </Field>

          {type.fields
            .filter((f) => f.key !== 'notes')
            .map((f) => (
            <DynamicField
              key={f.key}
              spec={f}
              value={values[f.key] ?? ''}
              computed={f.computed === 'grossValue' ? gross : undefined}
              error={errors[f.key]}
              cropOptions={cropOptions}
              onChange={(v) => set(f.key, v)}
              onFile={async (file) => {
                const dataUrl = await readFileDataURL(file);
                setAttachment({ name: file.name, dataUrl, mime: file.type, size: file.size });
              }}
              attachmentName={attachment?.name}
            />
          ))}
        </div>

        {/* Live arithmetic. Nothing here is stored, it is recalculated on the
            way in by the service, so the preview cannot disagree with the ledger. */}
        {type.createsHarvest && quantity > 0 && price > 0 && (
          <div className="calc">
            <div className="calc__row">
              <span>
                {quantity.toLocaleString()} {values.unit ?? 'KG'} × {formatMoney(price)}
              </span>
              <b className="num">{formatMoney(gross)}</b>
            </div>
            {deductions > 0 && (
              <div className="calc__row">
                <span>Deductions at intake</span>
                <b className="num neg">− {formatMoney(deductions)}</b>
              </div>
            )}
            <div className="calc__row calc__total">
              <span>Credited to farmer</span>
              <b className="num pos">{formatMoney(gross - (deductions || 0))}</b>
            </div>
          </div>
        )}

        {isMoney && balance !== null && (
          <div className="calc">
            <div className="calc__row">
              <span>Balance now</span>
              <b className={`num ${balance >= 0 ? 'pos' : 'neg'}`}>{formatMoney(balance)}</b>
            </div>
            <div className="calc__row">
              <span>This {type.label.toLowerCase()}</span>
              <b className="num">{amount ? formatMoney(amount) : '-'}</b>
            </div>
            <div className="calc__row calc__total">
              <span>Balance after</span>
              <b className={`num ${(projected ?? 0) >= 0 ? 'pos' : 'neg'}`}>{formatMoney(projected ?? 0)}</b>
            </div>
          </div>
        )}

        {isMoney && projected !== null && projected < 0 && (
          <Callout tone="warn" icon="alert">
            This leaves <b>{formatMoney(Math.abs(projected))}</b> owing from the farmer. It will be recovered from their
            next delivery.
          </Callout>
        )}

        <Field label={t('field.notes')} full>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {type.postsLedger && (
          <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            <Icon name="shield" size={12} style={{ display: 'inline', verticalAlign: -2 }} /> This creates a ledger
            transaction against {lookups.userName(user?.id)}. It can be voided later, never deleted.
          </p>
        )}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ one field */

function DynamicField({
  spec,
  value,
  computed,
  error,
  cropOptions,
  onChange,
  onFile,
  attachmentName,
}: {
  spec: FieldSpec;
  value: string;
  computed?: number;
  error?: string;
  cropOptions: { value: string; label: string }[];
  onChange: (v: string) => void;
  onFile: (f: File) => void;
  attachmentName?: string;
}) {
  const { tField } = usePrefs();
  const common = {
    label: tField(spec.key, spec.label),
    help: spec.help,
    error,
    required: spec.required,
    full: !spec.half,
  };

  if (spec.computed) {
    return (
      <Field {...common} suffix="RWF">
        <Input className="input input--money num" value={computed ? computed.toLocaleString() : '0'} readOnly disabled tabIndex={-1} />
      </Field>
    );
  }

  switch (spec.type) {
    case 'textarea':
      return (
        <Field {...common} full>
          <Textarea value={value} onChange={(e) => onChange(e.target.value)} invalid={Boolean(error)} />
        </Field>
      );

    case 'select':
      return (
        <Field {...common}>
          <Select
            options={spec.options ?? []}
            placeholder="Choose…"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            invalid={Boolean(error)}
          />
        </Field>
      );

    case 'crop':
      return (
        <Field {...common}>
          <Select options={cropOptions} placeholder="Choose a crop…" value={value} onChange={(e) => onChange(e.target.value)} />
        </Field>
      );

    case 'currency':
      return (
        <Field {...common} suffix="RWF">
          <MoneyInput
            value={value}
            min={spec.min}
            max={spec.max}
            onChange={(e) => onChange(e.target.value)}
            invalid={Boolean(error)}
            placeholder="0"
          />
        </Field>
      );

    case 'number':
      return (
        <Field {...common} suffix={spec.unit}>
          <Input
            type="number"
            inputMode="decimal"
            step="any"
            min={spec.min}
            max={spec.max}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            invalid={Boolean(error)}
            className={spec.unit ? 'input input--money num' : 'input'}
            placeholder="0"
          />
        </Field>
      );

    case 'date':
      return (
        <Field {...common}>
          <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} invalid={Boolean(error)} />
        </Field>
      );

    case 'file':
      return (
        <Field {...common} full help={attachmentName ? `Attached: ${attachmentName}` : spec.help}>
          <label
            className="btn btn--secondary"
            style={{ justifyContent: 'flex-start', cursor: 'pointer', width: 'fit-content' }}
          >
            <Icon name="upload" size={15} />
            {attachmentName ? 'Replace file' : 'Choose photo or document'}
            <input
              type="file"
              accept="image/*,application/pdf"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </label>
        </Field>
      );

    default:
      return (
        <Field {...common}>
          <Input value={value} onChange={(e) => onChange(e.target.value)} invalid={Boolean(error)} />
        </Field>
      );
  }
}


/* ------------------------------------------------- new activity type form */

function NewActivityTypeModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (t: ActivityType) => void;
}) {
  const { user, fail } = useStore();
  const { t } = usePrefs();
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<ActivityCategory>('other');
  const [description, setDescription] = useState('');
  const [fieldKeys, setFieldKeys] = useState<string[]>(['notes']);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (key: string) =>
    setFieldKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError('');
    try {
      const created = await createActivityType(user, { label, category, description, fieldKeys });
      onCreated(created);
    } catch (err) {
      setError((err as Error).message);
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('action.newActivityType')}
      subtitle={t('composer.newTypeSub')}
      size="narrow"
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="new-activity-type" loading={busy} icon="check">
            {t('action.createActivityType')}
          </Button>
        </>
      }
    >
      <form id="new-activity-type" onSubmit={submit} className="stack gap-4">
        <Field label={t('composer.typeName')} required error={error} help={t('composer.typeNameHelp')}>
          <Input
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setError('');
            }}
            placeholder="e.g. Mulching, Cooperative audit"
            autoFocus
            maxLength={48}
          />
        </Field>

        <Field label={t('field.category')} required help={t('composer.typeCategoryHelp')}>
          <Select
            options={(['farming', 'harvest', 'operations', 'logistics', 'other'] as ActivityCategory[]).map((c) => ({
              value: c,
              label: t(`cat.${c}`),
            }))}
            value={category}
            onChange={(e) => setCategory(e.target.value as ActivityCategory)}
          />
        </Field>

        <Field label={t('field.notes')} help={t('composer.typeDescHelp')}>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>

        <div className="field">
          <span className="field__label">{t('composer.typeFields')}</span>
          <span className="field__help" style={{ marginBottom: 'var(--s-2)' }}>
            {t('composer.typeFieldsHelp')}
          </span>
          <div className="stack gap-2">
            {CUSTOM_FIELD_LIBRARY.map((f) => (
              <button
                type="button"
                key={f.key}
                className="rolebtn"
                onClick={() => toggle(f.key)}
                aria-pressed={fieldKeys.includes(f.key)}
                style={{ padding: '8px 10px' }}
              >
                <Checkbox checked={fieldKeys.includes(f.key)} onChange={() => toggle(f.key)} label={f.label} />
                <span className="rolebtn__name">{f.label}</span>
              </button>
            ))}
          </div>
        </div>

        <Callout tone="info" icon="shield">
          {t('composer.typeNoMoney')}
        </Callout>
      </form>
    </Modal>
  );
}
