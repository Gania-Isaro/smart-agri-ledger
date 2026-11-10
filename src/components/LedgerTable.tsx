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
import { counts } from '../domain/ledger';
import { LEDGER_TYPE_LABEL } from '../domain/status';
import { formatDate, formatDateTime } from '../lib/date';
import { exportCSV } from '../lib/csv';
import type { LedgerLine } from '../domain/types';

import { tx as T } from '../i18n/tx';
export function LedgerTable({
  lines,
  showFarmer = true,
  farmerNames,
  onVoid,
  emptyMessage = T('No transactions on this account yet.'),
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
    return <EmptyState icon="book" title={T('Nothing posted yet')} message={emptyMessage} />;
  }

  const closing = lines[lines.length - 1]?.balanceAfter ?? 0;

  const doExport = () =>
    exportCSV(
      `ledger-${new Date().toISOString().slice(0, 10)}.csv`,
      lines,
      [
        { key: 'date', header: T('Date'), value: (l) => l.date },
        { key: 'code', header: T('Transaction'), value: (l) => l.code },
        { key: 'type', header: T('Type'), value: (l) => LEDGER_TYPE_LABEL[l.type] ?? l.type },
        { key: 'description', header: T('Description'), value: (l) => l.description },
        { key: 'debit', header: T('Debit'), value: (l) => (l.direction === 'debit' && counts(l) ? l.amount : '') },
        { key: 'credit', header: T('Credit'), value: (l) => (l.direction === 'credit' && counts(l) ? l.amount : '') },
        { key: 'balance', header: T('Balance'), value: (l) => l.balanceAfter },
        { key: 'voided', header: T('Voided'), value: (l) => (l.voided ? 'yes' : l.reversesId ? 'reversal' : '') },
        { key: 'by', header: T('Created by'), value: (l) => lookups.userName(l.createdBy) },
      ],
    );

  return (
    <div className="panel">
      <div className="gridtools">
        <span className="eyebrow">{T('Ledger')}</span>
        <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>
          {T('{count} entries · oldest first', { count: lines.length })}
        </span>
        <span className="spacer" />
        <span style={{ fontSize: 'var(--fs-sm)' }}>
          {T('Closing balance')}{' '}
          <b className={`num ${closing > 0 ? 'pos' : closing < 0 ? 'neg' : ''}`}>{formatMoney(closing)}</b>
        </span>
        <Button size="sm" icon="download" onClick={doExport}>
          {T('Export')}
        </Button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table className="grid ledger" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th><span className="th">{T('Date')}</span></th>
              <th><span className="th">{T('Reference')}</span></th>
              {showFarmer && <th><span className="th">{T('Worker')}</span></th>}
              <th><span className="th">{T('Description')}</span></th>
              <th className="num"><span className="th">{T('Debit')}</span></th>
              <th className="num"><span className="th">{T('Credit')}</span></th>
              <th className="num"><span className="th">{T('Balance')}</span></th>
              <th><span className="th">{T('By')}</span></th>
              {onVoid && <th aria-label={T('Actions')}><span className="th" /></th>}
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
                  <span className="cell grid__code" title={l.reversesId ? T('Reversal entry') : undefined}>
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
                          aria-label={T('Void {code}', { code: l.code })}
                          title={T('Void this transaction')}
                        >
                          <Icon name="undo" size={14} />
                        </button>
                      )}
                      {l.voided && (
                        <span className="badge badge--slate" title={l.voidReason}>
                          <span className="badge__glyph">✕</span>
                          {T('Voided')}
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
                <span className="cell strong">{T('Closing balance')}</span>
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
