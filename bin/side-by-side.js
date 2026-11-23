// 원본·결과 좌우 비교표. diffLines로 줄을 짝짓고, 짝지은 줄은 diffChars로 바뀐 글자를 표시한다
import { diffLines, diffChars } from 'diff';

// 터미널 칸 수: 전각(한글·한자) 2칸, 조합용 자모 0칸
const isWide = (cp) =>
  (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
  (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff);
const isZero = (cp) => (cp >= 0x1160 && cp <= 0x11ff) || (cp >= 0x0300 && cp <= 0x036f) || cp === 0x200b || cp === 0x200d;
export const charWidth = (ch) => {
  const cp = ch.codePointAt(0);
  return isZero(cp) ? 0 : isWide(cp) ? 2 : 1;
};
export const width = (s) => [...s].reduce((w, ch) => w + charWidth(ch), 0);
export const padEnd = (s, w) => s + ' '.repeat(Math.max(0, w - width(s)));

// diff 조각 → 줄 배열 (끝 빈 줄 제외, CR 제거, 탭은 공백)
const toLines = (value) => {
  const lines = value.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines.map((l) => l.replace(/\r$/, '').replace(/\t/g, '    '));
};

// → [{ type: eq|mod|del|add, left, right }], left/right = { no, segs: [{ text, hl }] } | null
export function pairRows(before, after) {
  const rows = [];
  let ln = 1;
  let rn = 1;
  const side = (no, text) => ({ no, segs: [{ text, hl: false }] });
  const parts = diffLines(before, after);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.added && !p.removed) {
      for (const l of toLines(p.value)) rows.push({ type: 'eq', left: side(ln++, l), right: side(rn++, l) });
      continue;
    }
    // 지운 조각 바로 뒤에 더한 조각이 오면 한 줄씩 짝지어 고친 줄(mod)로 본다
    const del = p.removed ? toLines(p.value) : [];
    const add = p.added ? toLines(p.value) : p.removed && parts[i + 1]?.added ? toLines(parts[++i].value) : [];
    for (let k = 0; k < Math.max(del.length, add.length); k++) {
      const a = del[k];
      const b = add[k];
      if (a !== undefined && b !== undefined) {
        const chars = diffChars(a, b);
        rows.push({
          type: 'mod',
          left: { no: ln++, segs: chars.filter((c) => !c.added).map((c) => ({ text: c.value, hl: c.removed })) },
          right: { no: rn++, segs: chars.filter((c) => !c.removed).map((c) => ({ text: c.value, hl: c.added })) },
        });
      } else if (a !== undefined) rows.push({ type: 'del', left: side(ln++, a), right: null });
      else rows.push({ type: 'add', left: null, right: side(rn++, b) });
    }
  }
  return rows;
}

// segs를 w칸 폭의 화면 줄들로 자른다
function wrap(segs, w) {
  const out = [[]];
  let used = 0;
  for (const { text, hl } of segs) {
    for (const ch of text) {
      const cw = charWidth(ch);
      if (used + cw > w && used > 0) {
        out.push([]);
        used = 0;
      }
      const line = out.at(-1);
      const last = line.at(-1);
      if (last && last.hl === hl) last.text += ch;
      else line.push({ text: ch, hl });
      used += cw;
    }
  }
  return out;
}

const SGR = {
  dim: [90, 39],
  del: [31, 39], // 줄: 빨간 글자
  add: [32, 39], // 줄: 초록 글자
  delHl: ['97;41', '39;49'], // 바뀐 글자: 빨간 바탕
  addHl: ['30;42', '39;49'], // 바뀐 글자: 초록 바탕
};

// 터미널 폭 → 컬럼 하나의 폭 (가운데 " │ " 제외)
export const columnWidth = (columns = 80) => Math.floor((Math.max(columns, 40) - 3) / 2);

/**
 * 원본과 결과를 좌우로 나란히 그린 줄 배열.
 * @param {object} o
 * @param {number} [o.columns=80] 전체 폭
 * @param {boolean} [o.color=false] ANSI 색 사용 여부 (끄면 -/+ 표시로만 구분)
 * @param {[string, string]} [o.titles] 두 컬럼의 제목
 */
export function sideBySide(before, after, { columns = 80, color = false, titles = ['원본', '결과'] } = {}) {
  const paint = (s, key) => (color && s ? `\x1b[${SGR[key][0]}m${s}\x1b[${SGR[key][1]}m` : s);
  const rows = pairRows(before, after);
  const SEP = ' │ ';
  const half = columnWidth(columns);
  const numW = String(Math.max(1, rows.length)).length;
  const gutterW = numW + 3; // "번호 ± "
  const textW = Math.max(8, half - gutterW);

  const renderCell = (cell, kind, first, line) => {
    if (!cell) return ' '.repeat(gutterW + textW);
    const mark = kind === 'eq' ? ' ' : kind === 'left' ? '-' : '+';
    const gutter = first ? `${String(cell.no).padStart(numW)} ${mark} ` : ' '.repeat(gutterW);
    const base = kind === 'eq' ? null : kind === 'left' ? 'del' : 'add';
    const body = (line || [])
      .map((s) => (s.hl ? paint(s.text, `${base}Hl`) : base ? paint(s.text, base) : s.text))
      .join('');
    const used = width((line || []).map((s) => s.text).join(''));
    return paint(gutter, 'dim') + body + ' '.repeat(Math.max(0, textW - used));
  };

  const out = [];
  // 제목은 컬럼 가운데
  const colW = gutterW + textW;
  const title = (t) => padEnd(' '.repeat(Math.max(0, Math.floor((colW - width(t)) / 2))) + t, colW);
  out.push(paint(`${'─'.repeat(colW)}─┬─${'─'.repeat(colW)}`, 'dim'));
  out.push(`${title(titles[0])}${paint(SEP, 'dim')}${title(titles[1])}`.trimEnd());
  out.push(paint(`${'─'.repeat(gutterW + textW)}─┼─${'─'.repeat(gutterW + textW)}`, 'dim'));

  for (const r of rows) {
    const L = r.left ? wrap(r.left.segs, textW) : [];
    const R = r.right ? wrap(r.right.segs, textW) : [];
    const lk = r.type === 'eq' ? 'eq' : 'left';
    const rk = r.type === 'eq' ? 'eq' : 'right';
    for (let k = 0; k < Math.max(L.length, R.length); k++) {
      const left = renderCell(k < L.length ? r.left : null, lk, k === 0, L[k]);
      const right = renderCell(k < R.length ? r.right : null, rk, k === 0, R[k]);
      out.push(`${left}${paint(SEP, 'dim')}${right}`.trimEnd());
    }
  }
  out.push(paint(`${'─'.repeat(colW)}─┴─${'─'.repeat(colW)}`, 'dim'));
  return out;
}
