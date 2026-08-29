/**
 * DataGrid, the spreadsheet.
 *
 * Aims to feel like Excel where that helps (click a cell and type, arrow keys,
 * frozen columns, sticky header) and deliberately unlike Excel where Excel is
 * confusing (no formula bar, no infinite empty rows, no silent type coercion).
 *
 * On narrow screens the whole thing becomes a list of cards instead: squeezing
 * fourteen columns onto a phone would technically be responsive and practically
 * useless, and a field officer standing in a field is the person most likely to
 * be holding one.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from '../ui/Icon';
import { Button, Checkbox, EmptyState, Popover, TableSkeleton } from '../ui/primitives';
import { exportCSV, type Cell, type Column as CSVColumn } from '../../lib/csv';
import { useT } from '../../i18n';

export type EditorType = 'text' | 'number' | 'currency' | 'date' | 'select';

export interface EditSpec<T> {
  type: EditorType;
  options?: { value: string; label: string }[];
  /** Current value as an editable primitive. */
  value: (row: T) => string | number;
  /** Persist. Throwing shows the error and reverts the cell. */
  commit: (row: T, next: string) => Promise<void>;
  canEdit?: (row: T) => boolean;
  min?: number;
  max?: number;
}

export interface ColumnDef<T> {
  key: string;
  header: string;
  width?: number;
  minWidth?: number;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  searchValue?: (row: T) => string;
  exportValue?: (row: T) => Cell;
  edit?: EditSpec<T>;
  /** Hidden by default but offered in the column menu. */
  optional?: boolean;
  /** How this column appears in the mobile card. */
  mobile?: 'title' | 'subtitle' | 'badge' | 'cell' | 'hide';
}

export interface BulkAction {
  label: string;
  icon?: IconName;
  run: (ids: string[]) => void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
}

interface Props<T> {
  rows: T[];
  columns: ColumnDef<T>[];
  rowId: (row: T) => string;
  loading?: boolean;
  /** Free-text search box contents, owned by the screen so filters can share it. */
  search?: string;
  onRowClick?: (row: T) => void;
  bulkActions?: BulkAction[];
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: ReactNode;
  toolbar?: ReactNode;
  exportName?: string;
  pageSize?: number;
  /** Persist column layout and sort under this key. */
  storageKey?: string;
  onError?: (e: unknown) => void;
  selectable?: boolean;
}

type SortState = { key: string; dir: 'asc' | 'desc' } | null;

export function DataGrid<T>({
  rows,
  columns,
  rowId,
  loading,
  search = '',
  onRowClick,
  bulkActions = [],
  emptyTitle = 'Nothing here yet',
  emptyMessage,
  emptyAction,
  toolbar,
  exportName = 'export',
  pageSize: initialPageSize = 25,
  storageKey,
  onError,
  selectable = true,
}: Props<T>) {
  const [sort, setSort] = useState<SortState>(() => readStored(storageKey, 'sort', null));
  const [hidden, setHidden] = useState<string[]>(() =>
    readStored(storageKey, 'hidden', columns.filter((c) => c.optional).map((c) => c.key)),
  );
  const [widths, setWidths] = useState<Record<string, number>>(() => readStored(storageKey, 'widths', {}));
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<{ row: number; col: number } | null>(null);
  const [editing, setEditing] = useState<{ row: number; col: number; value: string } | null>(null);
  const [scrolled, setScrolled] = useState(false);

  const t = useT();
  const colsBtn = useRef<HTMLButtonElement>(null);
  const [colsOpen, setColsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const visible = useMemo(() => columns.filter((c) => !hidden.includes(c.key)), [columns, hidden]);

  useEffect(() => {
    if (storageKey) writeStored(storageKey, 'sort', sort);
  }, [sort, storageKey]);
  useEffect(() => {
    if (storageKey) writeStored(storageKey, 'hidden', hidden);
  }, [hidden, storageKey]);
  useEffect(() => {
    if (storageKey) writeStored(storageKey, 'widths', widths);
  }, [widths, storageKey]);

  /* ---------------------------------------------------------- filtering */

  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    const terms = q.split(/\s+/);
    return rows.filter((row) => {
      const hay = columns
        .map((c) => (c.searchValue ? c.searchValue(row) : ''))
        .join(' ')
        .toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [rows, search, columns]);

  const sorted = useMemo(() => {
    if (!sort) return searched;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return searched;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...searched].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av === bv) return 0;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }, [searched, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = useMemo(
    () => sorted.slice(safePage * pageSize, safePage * pageSize + pageSize),
    [sorted, safePage, pageSize],
  );

  useEffect(() => {
    setPage(0);
  }, [search, pageSize, rows.length]);

  /* ---------------------------------------------------------- selection */

  const pageIds = useMemo(() => pageRows.map(rowId), [pageRows, rowId]);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const someOnPage = pageIds.some((id) => selected.has(id));

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPage) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }, [allOnPage, pageIds]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /* ------------------------------------------------------------ editing */

  const startEdit = useCallback(
    (r: number, c: number) => {
      const row = pageRows[r];
      const col = visible[c];
      if (!row || !col?.edit) return;
      if (col.edit.canEdit && !col.edit.canEdit(row)) return;
      setEditing({ row: r, col: c, value: String(col.edit.value(row) ?? '') });
    },
    [pageRows, visible],
  );

  const commitEdit = useCallback(async () => {
    if (!editing) return;
    const row = pageRows[editing.row];
    const col = visible[editing.col];
    setEditing(null);
    if (!row || !col?.edit) return;
    const before = String(col.edit.value(row) ?? '');
    if (before === editing.value) return;
    try {
      await col.edit.commit(row, editing.value);
    } catch (e) {
      onError?.(e);
    }
  }, [editing, pageRows, visible, onError]);

  /* --------------------------------------------------- keyboard on grid */

  const onGridKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (editing) return;
      if (!active) return;
      const maxRow = pageRows.length - 1;
      const maxCol = visible.length - 1;
      const move = (dr: number, dc: number) => {
        e.preventDefault();
        setActive({
          row: Math.max(0, Math.min(maxRow, active.row + dr)),
          col: Math.max(0, Math.min(maxCol, active.col + dc)),
        });
      };
      switch (e.key) {
        case 'ArrowDown': return move(1, 0);
        case 'ArrowUp': return move(-1, 0);
        case 'ArrowRight': return move(0, 1);
        case 'ArrowLeft': return move(0, -1);
        case 'Home': e.preventDefault(); return setActive({ ...active, col: 0 });
        case 'End': e.preventDefault(); return setActive({ ...active, col: maxCol });
        case 'Enter':
        case 'F2':
          e.preventDefault();
          return startEdit(active.row, active.col);
        case ' ': {
          if (!selectable) return;
          e.preventDefault();
          const row = pageRows[active.row];
          if (row) toggleOne(rowId(row));
          return;
        }
        default:
          // Typing a printable character starts editing, as a spreadsheet does.
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const col = visible[active.col];
            const row = pageRows[active.row];
            if (col?.edit && row && (!col.edit.canEdit || col.edit.canEdit(row))) {
              e.preventDefault();
              setEditing({ row: active.row, col: active.col, value: e.key });
            }
          }
      }
    },
    [active, editing, pageRows, visible, startEdit, toggleOne, rowId, selectable],
  );

  /* ------------------------------------------------------------- resize */

  const startResize = useCallback(
    (key: string, startX: number, startWidth: number) => {
      const onMove = (ev: MouseEvent) => {
        const next = Math.max(70, startWidth + (ev.clientX - startX));
        setWidths((w) => ({ ...w, [key]: next }));
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [],
  );

  /* -------------------------------------------------------------- export */

  const doExport = useCallback(
    (which: 'all' | 'selected') => {
      const source = which === 'selected' ? sorted.filter((r) => selected.has(rowId(r))) : sorted;
      const cols: CSVColumn<T>[] = visible.map((c) => ({
        key: c.key,
        header: c.header,
        value: (row: T) => (c.exportValue ? c.exportValue(row) : c.searchValue ? c.searchValue(row) : ''),
      }));
      const stamp = new Date().toISOString().slice(0, 10);
      exportCSV(`${exportName}-${stamp}.csv`, source, cols);
    },
    [sorted, selected, rowId, visible, exportName],
  );

  /* --------------------------------------------------------------- view */

  if (loading) {
    return (
      <div className="gridwrap">
        <TableSkeleton cols={Math.min(visible.length, 7)} />
      </div>
    );
  }

  const selectedIds = [...selected];

  return (
    <div className="gridwrap">
      {(toolbar || bulkActions.length > 0) && (
        <div className="gridtools">
          {toolbar}
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
            {sorted.length.toLocaleString()} {sorted.length === 1 ? t('misc.row') : t('misc.rows')}
            {sorted.length !== rows.length && ` of ${rows.length.toLocaleString()}`}
          </span>
          <button
            className="iconbtn"
            ref={colsBtn}
            aria-label={t('action.columns')}
            title={t('action.columns')}
            aria-expanded={colsOpen}
            onClick={() => setColsOpen((v) => !v)}
          >
            <Icon name="columns" size={18} />
          </button>
          <button className="iconbtn" aria-label={t('action.exportCsv')} title={t('action.exportCsv')} onClick={() => doExport('all')}>
            <Icon name="download" size={18} />
          </button>
        </div>
      )}

      {colsOpen && (
        <Popover anchorRef={colsBtn} onClose={() => setColsOpen(false)} align="right" width={240}>
          <div className="menu">
            <div className="menu__label">{t('action.columns')}</div>
            {columns.map((c) => (
              <button
                key={c.key}
                className="menu__item"
                onClick={() =>
                  setHidden((h) => (h.includes(c.key) ? h.filter((k) => k !== c.key) : [...h, c.key]))
                }
              >
                <Checkbox
                  checked={!hidden.includes(c.key)}
                  onChange={() => undefined}
                  label={c.header}
                />
                {c.header}
              </button>
            ))}
            <div className="menu__sep" />
            <button className="menu__item" onClick={() => setHidden([])}>
              <Icon name="eye" size={15} /> {t('action.showAllColumns')}
            </button>
          </div>
        </Popover>
      )}

      {selectedIds.length > 0 && (
        <div className="selbar">
          <span className="selbar__count">
            {selectedIds.length} {t('misc.selected')}
          </span>
          {bulkActions.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant={a.tone === 'danger' ? 'danger' : 'secondary'}
              icon={a.icon}
              disabled={a.disabled}
              onClick={() => a.run(selectedIds)}
            >
              {a.label}
            </Button>
          ))}
          <Button size="sm" variant="secondary" icon="download" onClick={() => doExport('selected')}>
            Export selected
          </Button>
          <span className="spacer" />
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())} style={{ color: '#fff' }}>
            Clear
          </Button>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          icon="search"
          title={search ? t('misc.noResults') : emptyTitle}
          message={search ? t('misc.noResultsHelp') : emptyMessage}
          action={emptyAction}
        />
      ) : (
        <>
          {/* ---- desktop: the sheet ---- */}
          <div
            className={`gridscroll ${scrolled ? 'gridscroll--scrolled' : ''} grid-desktop`}
            ref={scrollRef}
            onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 2)}
          >
            <table
              className="grid"
              ref={tableRef}
              onKeyDown={onGridKey}
              tabIndex={0}
              role="grid"
              aria-rowcount={sorted.length}
            >
              <thead>
                <tr>
                  {selectable && (
                    <th className="sticky-0" scope="col">
                      <div className="th" style={{ justifyContent: 'center', padding: 0 }}>
                        <Checkbox
                          checked={allOnPage}
                          indeterminate={!allOnPage && someOnPage}
                          onChange={toggleAll}
                          label="Select all rows on this page"
                        />
                      </div>
                    </th>
                  )}
                  {visible.map((c, i) => {
                    const isSorted = sort?.key === c.key;
                    const width = widths[c.key] ?? c.width;
                    return (
                      <th
                        key={c.key}
                        scope="col"
                        className={`${c.align === 'right' ? 'num' : ''} ${i === 0 && selectable ? 'sticky-1' : ''}`}
                        /* No inline `position` here: every header cell is already
                           sticky (see .grid thead th), which both pins it to the
                           top and gives the resize handle a positioned ancestor.
                           Forcing `relative` would silently unstick the frozen
                           first column and shift it out of line with its body. */
                        style={{ width, minWidth: c.minWidth ?? width }}
                        aria-sort={isSorted ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        {c.sortValue ? (
                          <button
                            className="th"
                            onClick={() =>
                              setSort((s) =>
                                s?.key === c.key
                                  ? s.dir === 'asc'
                                    ? { key: c.key, dir: 'desc' }
                                    : null
                                  : { key: c.key, dir: 'asc' },
                              )
                            }
                            title={`Sort by ${c.header}`}
                          >
                            {c.header}
                            <Icon
                              name={isSorted ? (sort!.dir === 'asc' ? 'sort-up' : 'sort-down') : 'sort'}
                              size={12}
                              className={`th__sort ${isSorted ? 'th__sort--on' : ''}`}
                            />
                          </button>
                        ) : (
                          <span className="th">{c.header}</span>
                        )}
                        <span
                          role="separator"
                          aria-label={`Resize ${c.header}`}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            const th = (e.target as HTMLElement).closest('th')!;
                            startResize(c.key, e.clientX, th.getBoundingClientRect().width);
                          }}
                          style={{
                            position: 'absolute',
                            right: -3,
                            top: 0,
                            width: 7,
                            height: '100%',
                            cursor: 'col-resize',
                            zIndex: 3,
                          }}
                        />
                      </th>
                    );
                  })}
                </tr>
              </thead>

              <tbody>
                {pageRows.map((row, r) => {
                  const id = rowId(row);
                  const isSelected = selected.has(id);
                  return (
                    <tr key={id} data-selected={isSelected}>
                      {selectable && (
                        <td className="sticky-0">
                          <div className="cell" style={{ justifyContent: 'center', padding: 0 }}>
                            <Checkbox checked={isSelected} onChange={() => toggleOne(id)} label={`Select row ${r + 1}`} />
                          </div>
                        </td>
                      )}
                      {visible.map((c, ci) => {
                        const editable = Boolean(c.edit && (!c.edit.canEdit || c.edit.canEdit(row)));
                        const isEditing = editing?.row === r && editing.col === ci;
                        const isActive = active?.row === r && active.col === ci;
                        return (
                          <td
                            key={c.key}
                            className={[
                              c.align === 'right' ? 'num' : '',
                              ci === 0 && selectable ? 'sticky-1' : '',
                              isActive ? 'cell--active' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            style={{ width: widths[c.key] ?? c.width }}
                            onClick={() => {
                              setActive({ row: r, col: ci });
                              if (!editable && onRowClick && ci === 0) onRowClick(row);
                            }}
                            onDoubleClick={() => (editable ? startEdit(r, ci) : onRowClick?.(row))}
                          >
                            {isEditing ? (
                              <EditorCell
                                spec={c.edit!}
                                value={editing.value}
                                onChange={(v) => setEditing({ ...editing, value: v })}
                                onCommit={commitEdit}
                                onCancel={() => setEditing(null)}
                              />
                            ) : (
                              <div className={`cell ${editable ? 'cell--editable' : ''}`}>{c.render(row)}</div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ---- mobile: cards ---- */}
          <div className="grid-mobile">
            <div className="cardlist" style={{ padding: 'var(--s-3)' }}>
              {pageRows.map((row) => {
                const id = rowId(row);
                const title = visible.find((c) => c.mobile === 'title') ?? visible[0]!;
                const subtitle = visible.find((c) => c.mobile === 'subtitle');
                const badge = visible.find((c) => c.mobile === 'badge');
                const cells = visible.filter((c) => c.mobile === 'cell');
                return (
                  <div
                    key={id}
                    className="rowcard"
                    onClick={() => onRowClick?.(row)}
                    role={onRowClick ? 'button' : undefined}
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (onRowClick && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }}
                  >
                    <div className="rowcard__top">
                      <div className="grow" style={{ minWidth: 0 }}>
                        <div className="rowcard__name">{title.render(row)}</div>
                        {subtitle && <div className="rowcard__meta">{subtitle.render(row)}</div>}
                      </div>
                      <div className="row gap-2">
                        {badge && badge.render(row)}
                        {selectable && (
                          <Checkbox checked={selected.has(id)} onChange={() => toggleOne(id)} label="Select" />
                        )}
                      </div>
                    </div>
                    {cells.length > 0 && (
                      <div className="rowcard__grid">
                        {cells.map((c) => (
                          <div className="rowcard__cell" key={c.key}>
                            <span>{c.header}</span>
                            <b>{c.render(row)}</b>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="gridfoot">
            <div className="row gap-3 wrap">
              <span>
                Showing {safePage * pageSize + 1}-{Math.min((safePage + 1) * pageSize, sorted.length)} of{' '}
                {sorted.length.toLocaleString()}
              </span>
              <label className="row gap-2">
                <span className="sr-only">Rows per page</span>
                <select
                  className="select"
                  style={{ height: 26, minHeight: 26, padding: '0 24px 0 8px', fontSize: 'var(--fs-xs)' }}
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  aria-label="Rows per page"
                >
                  {[25, 50, 100, 250].map((n) => (
                    <option key={n} value={n}>
                      {n} {t('misc.perPage')}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {pageCount > 1 && (
              <div className="pager">
                <button onClick={() => setPage(0)} disabled={safePage === 0} aria-label="First page">
                  <Icon name="chevron-left" size={13} />
                </button>
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0} aria-label={t('misc.prev')}>
                  {t('misc.prev')}
                </button>
                {pageWindow(safePage, pageCount).map((p, i) =>
                  p === -1 ? (
                    <span key={`gap-${i}`} style={{ padding: '0 4px' }} aria-hidden="true">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      aria-current={p === safePage ? 'page' : undefined}
                    >
                      {p + 1}
                    </button>
                  ),
                )}
                <button
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  disabled={safePage >= pageCount - 1}
                  aria-label={t('misc.next')}
                >
                  {t('misc.next')}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- editor cell */

function EditorCell<T>({
  spec,
  value,
  onChange,
  onCommit,
  onCancel,
}: {
  spec: EditSpec<T>;
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | HTMLSelectElement>(null);

  useEffect(() => {
    ref.current?.focus();
    if (ref.current instanceof HTMLInputElement) ref.current.select();
  }, []);

  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCommit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  if (spec.type === 'select') {
    return (
      <select
        ref={ref as React.RefObject<HTMLSelectElement>}
        className="cell__input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={keys}
      >
        {(spec.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  const numeric = spec.type === 'number' || spec.type === 'currency';
  return (
    <input
      ref={ref as React.RefObject<HTMLInputElement>}
      className={`cell__input ${numeric ? 'num' : ''}`}
      type={spec.type === 'date' ? 'date' : numeric ? 'number' : 'text'}
      inputMode={numeric ? 'decimal' : undefined}
      min={spec.min}
      max={spec.max}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={keys}
    />
  );
}

/* ------------------------------------------------------------------ utils */

function pageWindow(current: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const out: number[] = [0];
  const from = Math.max(1, current - 1);
  const to = Math.min(total - 2, current + 1);
  if (from > 1) out.push(-1);
  for (let i = from; i <= to; i++) out.push(i);
  if (to < total - 2) out.push(-1);
  out.push(total - 1);
  return out;
}

function readStored<T>(key: string | undefined, part: string, fallback: T): T {
  if (!key) return fallback;
  try {
    const raw = localStorage.getItem(`grid:${key}:${part}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, part: string, value: unknown) {
  try {
    localStorage.setItem(`grid:${key}:${part}`, JSON.stringify(value));
  } catch {
    /* private browsing, quota. The grid still works, it just forgets. */
  }
}
