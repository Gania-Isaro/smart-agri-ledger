/**
 * The ledger, rendered the way a bookkeeper expects to read it: oldest first,
 * debit and credit in separate columns, and a running balance that is computed
 * down the page rather than stored anywhere.
 *
 * Voided rows stay visible, struck through, with their reversal underneath. A
 * ledger that hides its corrections is not a ledger.
 */

import { Icon } from './ui/Icon';
import { Button, EmptyState } from './ui/primitives';
import { useLookups } from '../state/store';
import { formatMoney } from '../domain/money';
import { LEDGER_TYPE_LABEL } from '../domain/status';
import { formatDate, formatDateTime } from '../lib/date';
import { exportCSV } from '../lib/csv';
import type { LedgerLine } from '../domain/types';

export function LedgerTable({
  lines,
  showFarmer = true,
  farmerNames,
  onVoid,
  emptyMessage = 'No transactions on this account yet.',
}: {
  lines: LedgerLine[];
  showFarmer?: boolean;
  /** Farmer id -> display label. Required when showFarmer is true. */
  farmerNames?: Map<string, string>;
  onVoid?: (tx: LedgerLine) => void;
  emptyMessage?: string;
}) {
  const lookups = useLookups();

  if (lines.length === 0) {
    return <EmptyState icon="book" title="Nothing posted yet" message={emptyMessage} />;
  }

  const closing = lines[lines.length - 1]?.balanceAfter ?? 0;

  const doExport = () =>
    exportCSV(
      `ledger-${new Date().toISOString().slice(0, 10)}.csv`,
      lines,
      [
        { key: 'date', header: 'Date', value: (l) => l.date },
        { key: 'code', header: 'Transaction', value: (l) => l.code },
        { key: 'type', header: 'Type', value: (l) => LEDGER_TYPE_LABEL[l.type] ?? l.type },
        { key: 'description', header: 'Description', value: (l) => l.description },
        { key: 'debit', header: 'Debit', value: (l) => (l.direction === 'debit' && !l.voided ? l.amount : '') },
        { key: 'credit', header: 'Credit', value: (l) => (l.direction === 'credit' && !l.voided ? l.amount : '') },
        { key: 'balance', header: 'Balance', value: (l) => l.balanceAfter },
        { key: 'voided', header: 'Voided', value: (l) => (l.voided ? 'yes' : '') },
        { key: 'by', header: 'Created by', value: (l) => lookups.userName(l.createdBy) },
      ],
    );

  return (
    <div className="panel">
      <div className="gridtools">
        <span className="eyebrow">Ledger</span>
        <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
          {lines.length} entries · oldest first
        </span>
        <span className="spacer" />
        <span style={{ fontSize: 'var(--fs-sm)' }}>
          Closing balance{' '}
          <b className={`num ${closing > 0 ? 'pos' : closing < 0 ? 'neg' : ''}`}>{formatMoney(closing)}</b>
        </span>
        <Button size="sm" icon="download" onClick={doExport}>
          Export
        </Button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="grid ledger" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th><span className="th">Date</span></th>
              <th><span className="th">Reference</span></th>
              {showFarmer && <th><span className="th">Farmer</span></th>}
              <th><span className="th">Description</span></th>
              <th className="num"><span className="th">Debit</span></th>
              <th className="num"><span className="th">Credit</span></th>
              <th className="num"><span className="th">Balance</span></th>
              <th><span className="th">By</span></th>
              {onVoid && <th aria-label="Actions"><span className="th" /></th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} data-voided={l.voided}>
                <td>
                  <span className="cell num" title={formatDateTime(l.createdAt)}>
                    {formatDate(l.date)}
                  </span>
                </td>
                <td>
                  <span className="cell grid__code" title={l.reversesId ? 'Reversal entry' : undefined}>
                    {l.code}
                    {l.reversesId && <Icon name="undo" size={11} />}
                  </span>
                </td>
                {showFarmer && (
                  <td>
                    <span className="cell truncate">{farmerNames?.get(l.farmerId) ?? l.farmerId}</span>
                  </td>
                )}
                <td>
                  <span className="cell truncate" title={l.description}>
                    <span className="chip" style={{ height: 19, fontSize: 10 }}>
                      {LEDGER_TYPE_LABEL[l.type] ?? l.type}
                    </span>
                    {l.description}
                  </span>
                </td>
                <td className="num debit">
                  <span className="cell num">{l.direction === 'debit' ? formatMoney(l.amount) : ''}</span>
                </td>
                <td className="num credit">
                  <span className="cell num">{l.direction === 'credit' ? formatMoney(l.amount) : ''}</span>
                </td>
                <td className="num">
                  <span className={`cell num strong ${l.balanceAfter < 0 ? 'neg' : ''}`}>{formatMoney(l.balanceAfter)}</span>
                </td>
                <td>
                  <span className="cell muted truncate">{lookups.userName(l.createdBy)}</span>
                </td>
                {onVoid && (
                  <td>
                    <span className="cell">
                      {!l.voided && !l.reversesId && (
                        <button
                          className="iconbtn"
                          style={{ width: 26, height: 26 }}
                          onClick={() => onVoid(l)}
                          aria-label={`Void ${l.code}`}
                          title="Void this transaction"
                        >
                          <Icon name="undo" size={14} />
                        </button>
                      )}
                      {l.voided && (
                        <span className="badge badge--slate" title={l.voidReason}>
                          <span className="badge__glyph">✕</span>
                          Voided
                        </span>
                      )}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={showFarmer ? 6 : 5}>
                <span className="cell strong">Closing balance</span>
              </td>
              <td className="num">
                <span className={`cell num strong ${closing < 0 ? 'neg' : 'pos'}`}>{formatMoney(closing)}</span>
              </td>
              <td colSpan={onVoid ? 2 : 1} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
