// A plain 1D barcode (Code 128, set B) drawn as SVG bars — printed on the pre-bill so the cashier can scan the check
// number in collect mode. Deliberately not a QR: the QR on the receipt is the e-receipt link, and the two must not be
// confused. Pure encoder (`code128B`) + a small component; no library.
import React from 'react';

// Code 128 bar/space widths (modules) for symbols 0–106 (103–105 are the start codes, 106 is stop).
const P = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
  + '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
  + '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
  + '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
  + '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
  + '114131 311141 411131 211412 211214 211232 2331112').split(' ');
const START_B = 104, STOP = 106;

/** Code 128-B modules as a string of 1 (bar) and 0 (space), quiet zones excluded. Printable ASCII 32–126 only. */
export function code128B(text: string): string {
  const codes = [START_B];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error('Code 128-B: printable ASCII only');
    codes.push(c - 32);
  }
  const check = codes.reduce((sum, c, i) => sum + c * (i === 0 ? 1 : i), 0) % 103;
  codes.push(check, STOP);
  let out = '';
  for (const c of codes) [...P[c]].forEach((w, i) => { out += (i % 2 === 0 ? '1' : '0').repeat(Number(w)); });
  return out;
}

export function Barcode128({ value, height = 44, module = 1.6, className, fb }: { value: string; height?: number; module?: number; className?: string; fb?: string }) {
  const bits = code128B(value);
  const quiet = 10;
  const w = (bits.length + quiet * 2) * module;
  const bars: React.ReactNode[] = [];
  for (let i = 0; i < bits.length; ) {
    if (bits[i] !== '1') { i++; continue; }
    let j = i;
    while (bits[j] === '1') j++;
    bars.push(<rect key={i} x={(i + quiet) * module} y={0} width={(j - i) * module} height={height} />);
    i = j;
  }
  return (
    <svg viewBox={`0 0 ${w} ${height}`} width={w} height={height} className={className} role="img" aria-label={value} data-fb={fb} data-code={value} data-modules={bits} style={{ display: 'block' }}>
      <rect x={0} y={0} width={w} height={height} fill="#fff" />
      <g fill="#000">{bars}</g>
    </svg>
  );
}
