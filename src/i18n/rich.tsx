/**
 * Translate a sentence that has highlighted parts inside it, such as a bold
 * amount. The sentence is translated whole, so Kinyarwanda can put the amount
 * wherever it reads naturally, then each {name} is swapped for its element.
 *
 *   txr('{amount} is still owed to this farmer.', { amount: <b>{formatMoney(x)}</b> })
 */

import { Fragment, type ReactNode } from 'react';
import { tx } from './tx';

export function txr(english: string, parts: Record<string, ReactNode>): ReactNode {
  const text = tx(english);
  const pieces = text.split(/(\{\w+\})/g);
  return (
    <>
      {pieces.map((piece, i) => {
        const m = /^\{(\w+)\}$/.exec(piece);
        return <Fragment key={i}>{m && m[1]! in parts ? parts[m[1]!] : piece}</Fragment>;
      })}
    </>
  );
}
