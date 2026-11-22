// jimjit: 글(A1)에 사람의 실수를 입혀 A2로. 문장·어휘·내용은 그대로 두고 결만 흐트러뜨린다.
//
// 실수의 세 종류
//   손 실수     — 무작위. 어절마다 확률적으로 (쌍자음 놓침, ㅐ/ㅔ 혼동, 겹받침 줄임 …)
//   몰라서 틀림 — 사람 단위로 "잘못 알고 있는 표현"을 정하고 글 전체에 일관되게 (됬, 할께, 틀리다 …)
//   습관        — 사람 단위로 정하고 대부분의 자리에 (띄어쓰기, 마침표 생략, 번역투)

import { isSyllable, decompose, compose } from './hangul.js';
import { createRandom } from './random.js';
import { segment, alternation } from './protect.js';
import { PROFILES, HIGH_RISK_LEVEL, clampLevel, ratesFor } from './profiles.js';
import { MISCONCEPTIONS } from './data/knowledge.js';
import { SPACING, SPACING_RULES, SPLIT_RULES, TRANSLATIONESE, HABIT_CONSISTENCY } from './data/habits.js';
import {
  SHIFT_RELEASE, SHIFT_RELEASE_JONG, AE_E, VOWEL_NEIGHBORS, COMPLEX_JONG, LIAISON_JONG, NO_LIAISON, LOANWORD_HINTS,
  SLIP_WEIGHTS, BLOCKED_OUTPUTS,
} from './data/slips.js';

const isLoanword = (word) => LOANWORD_HINTS.some((h) => word.includes(h));

const createsBlocked = (from, to) => BLOCKED_OUTPUTS.some((b) => to.includes(b) && !from.includes(b));

export { PROFILES, MISCONCEPTIONS, HIGH_RISK_LEVEL };
export const RULES = ['slips', 'knowledge', 'spacing', 'period', 'translationese'];

// 후보 무게 합이 이 값 이상이면 "틀리기 쉬운 단어"로 보고 레벨 확률을 그대로 쓴다
const SLIP_PRONE = 1.5;
const SENTENCE_START =/(^|[.!?\n])[\s"'“‘(\[\-*>#]*$/;
// 문장 첫 단어인지 보려고 앞 글자를 이만큼 들고 다닌다 (SENTENCE_START가 보는 범위보다 넉넉히)
const TAIL = 12;
const pushTail = (tail, s) => (tail + s).slice(-TAIL);

// ── 실수를 넣은 자리는 잠가서, 한 자리에 실수가 겹치지 않게 한다 ──
function lockPass(pieces, regex, decide) {
  const out = [];
  for (const p of pieces) {
    if (p.locked) {
      out.push(p);
      continue;
    }
    let last = 0;
    for (const m of p.text.matchAll(regex)) {
      const to = decide(m);
      if (to == null || to === m[0]) continue;
      if (m.index > last) out.push({ text: p.text.slice(last, m.index), locked: false });
      out.push({ text: to, locked: true });
      last = m.index + m[0].length;
    }
    if (last < p.text.length) out.push({ text: p.text.slice(last), locked: false });
  }
  return out;
}

// [원래, 바꿀 형태] 목록 → { regex, replace }. 데이터가 고정이라 모듈을 읽을 때 한 번만 만든다.
function pairsRegex(pairs) {
  const map = new Map(pairs);
  return { regex: new RegExp(alternation(map.keys()), 'g'), replace: (m) => map.get(m[0]) };
}
const SPACING_PASS = pairsRegex(SPACING);
const TRANSLATIONESE_PASS = pairsRegex(TRANSLATIONESE);
const KNOWLEDGE_PASS = new Map(MISCONCEPTIONS.map((m) => [m, m.rule ?? pairsRegex(m.pairs)]));

// ── 손 실수 후보 ──
// 자리마다의 후보와 그 결과(to). weight는 자리의 무게(첫 글자는 덜 틀린다)이고, 종류의 무게는 slipPass에서 쓴다.
function slipCandidates(word) {
  const chars = Array.from(word);
  const loanword = isLoanword(word);
  const out = [];
  const push = (rule, weight, at, ...repl) => {
    const to = [...chars.slice(0, at), ...repl, ...chars.slice(at + repl.length)].join('');
    if (!createsBlocked(word, to)) out.push({ rule, weight, to });
  };
  for (let i = 0; i < chars.length; i++) {
    if (!isSyllable(chars[i])) continue;
    const d = decompose(chars[i]);
    const pos = i === 0 ? 0.3 : 1;
    const add = (rule, nd) => {
      const ch = compose(nd);
      if (ch && ch !== chars[i]) push(rule, pos, i, ch);
    };
    if (SHIFT_RELEASE[d.cho]) add('쌍자음 놓침', { ...d, cho: SHIFT_RELEASE[d.cho] });
    if (SHIFT_RELEASE_JONG[d.jong]) add('쌍자음 놓침', { ...d, jong: SHIFT_RELEASE_JONG[d.jong] });
    if (AE_E[d.jung]) add('ㅐ/ㅔ 혼동', { ...d, jung: AE_E[d.jung] });
    if (COMPLEX_JONG[d.jong]) add('겹받침 줄임', { ...d, jong: COMPLEX_JONG[d.jong] });
    if (!loanword) for (const v of VOWEL_NEIGHBORS[d.jung] || []) add('인접 모음', { ...d, jung: v });

    const next = chars[i + 1];
    if (next && isSyllable(next) && LIAISON_JONG.has(d.jong) && !NO_LIAISON[d.jong]?.includes(next)) {
      const nd = decompose(next);
      if (nd.cho === 'ㅇ') {
        const a = compose({ ...d, jong: '' });
        const b = compose({ ...nd, cho: d.jong });
        if (a && b) push('연음', pos, i, a, b);
      }
    }
  }
  return out;
}

// 종류별로 묶는다. 종류의 무게 = 종류 무게 × 그 종류에서 가장 무거운 자리
function groupByRule(cands) {
  const groups = new Map();
  for (const c of cands) {
    if (!groups.has(c.rule)) groups.set(c.rule, []);
    groups.get(c.rule).push(c);
  }
  return [...groups].map(([rule, items]) => ({
    rule,
    items,
    weight: SLIP_WEIGHTS[rule] * Math.max(...items.map((c) => c.weight)),
  }));
}

function slipPass(pieces, ctx) {
  let tail = ctx.tail;
  return pieces.map((p) => {
    if (p.locked) {
      tail = pushTail(tail, p.text);
      return p;
    }
    const text = p.text.replace(/[가-힣]+/g, (word, offset) => {
      ctx.wordNo++;
      const before = pushTail(tail, p.text.slice(0, offset));
      if (word.length < 2) return word;
      if (SENTENCE_START.test(before)) return word; // 문장 첫 단어는 보호
      if (ctx.wordNo - ctx.lastSlip < 2) return word; // 붙어 있는 두 어절에 연달아 내지 않음
      const cands = slipCandidates(word);
      if (!cands.length) return word;
      const groups = groupByRule(cands);
      // 틀리기 쉬운 글자(쌍자음, ㅐ/ㅔ, 겹받침)가 있는 단어일수록 잘 틀린다
      const proneness = Math.min(1, groups.reduce((s, g) => s + g.weight, 0) / SLIP_PRONE);
      if (!ctx.random.chance(ctx.rates.slip * proneness)) return word;
      const { rule, to } = ctx.random.weighted(ctx.random.weighted(groups).items);
      ctx.lastSlip = ctx.wordNo;
      ctx.changes.push({ category: '손 실수', rule, from: word, to });
      return to;
    });
    tail = pushTail(tail, p.text);
    return { text, locked: false };
  });
}

// 줄 끝 마침표 생략. 말줄임표(...)는 그대로 둔다.
function periodPass(s, segEndIsLineEnd, ctx) {
  return s.replace(/([가-힣])\.(?=[ \t]*(\n|$))/g, (m, ch, nl) => {
    if (nl === '' && !segEndIsLineEnd) return m;
    if (!ctx.random.chance(HABIT_CONSISTENCY.period)) return m;
    ctx.changes.push({ category: '습관', rule: '마침표 생략', from: m, to: ch });
    return ch;
  });
}

function resolveEnabled({ only, without = [], with: withRules = [] }, profile) {
  const on = new Set(only?.length ? only : RULES.filter((r) => r !== 'translationese' || profile.translationese > 0));
  for (const r of withRules) on.add(r);
  for (const r of without) on.delete(r);
  for (const r of on) if (!RULES.includes(r)) throw new Error(`알 수 없는 실수 규칙이에요: ${r} (가능: ${RULES.join(', ')})`);
  return on;
}

/**
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.level=3]          1~10. 클수록 실수가 많고 종류도 넓어진다
 * @param {string} [options.profile='default'] default | work | mobile | community | bookish
 * @param {number|string} [options.seed]       결과를 고정하는 값. 없으면 매번 달라지고, 같으면 같은 결과
 * @param {string[]} [options.keep]            실수를 넣지 않을 단어 (고유명사, 핵심 용어)
 * @param {string[]} [options.only]            이 실수 규칙만 사용
 * @param {string[]} [options.without]         이 실수 규칙은 끔
 * @param {string[]} [options.with]            기본 꺼진 실수 규칙을 켬 (translationese)
 * @param {string[]} [options.misconceptions]  "잘못 알고 있는 표현"을 이 오류 id들로만 정한다 (확률로 고르지 않음)
 */
export function jimjit(text, options = {}) {
  const level = clampLevel(options.level ?? 3);
  const profileName = options.profile ?? 'default';
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`알 수 없는 프로필이에요: ${profileName} (가능: ${Object.keys(PROFILES).join(', ')})`);

  const seed = options.seed ?? Math.floor(Math.random() * 2 ** 31);
  const random = createRandom(seed);
  const enabled = resolveEnabled(options, profile);
  const rates = ratesFor(level, profile, { forceTranslationese: (options.with || []).includes('translationese') });

  // ── 이 글을 쓴 "사람"을 먼저 정한다: 무엇을 모르고, 어떤 습관이 있나 ──
  // misconceptions를 주면 "잘못 알고 있는 표현"은 정확히 그 목록이다 (확률로 더 고르지 않는다)
  const forced = options.misconceptions?.length ? new Set(options.misconceptions) : null;
  for (const id of forced || []) {
    if (!MISCONCEPTIONS.some((m) => m.id === id)) throw new Error(`알 수 없는 오류 id예요: ${id}`);
  }
  const misconceptions = MISCONCEPTIONS.filter((m) => {
    if (forced) return forced.has(m.id);
    if (!enabled.has('knowledge')) return false;
    if (m.risk === 'high' && !rates.highRisk) return false;
    return random.chance(rates.knowledge);
  });
  const habits = {
    spacing: enabled.has('spacing') && random.chance(rates.spacing),
    period: enabled.has('period') && random.chance(rates.period),
    translationese: enabled.has('translationese') && random.chance(rates.translationese),
  };

  const ctx = { random, rates, changes: [], tail: '', wordNo: 0, lastSlip: -10 };
  // 바꾸기 단계: 앞 단계가 바꾼 자리는 잠기므로 순서가 곧 우선순위다. p는 자리마다 실제로 나타날 확률.
  const passes = [
    ...misconceptions.map((m) => ({ ...KNOWLEDGE_PASS.get(m), category: '몰라서 틀림', rule: `${m.kind}: ${m.id}` })),
    ...(habits.translationese ? [{ ...TRANSLATIONESE_PASS, category: '습관', rule: '번역투' }] : []),
    ...(habits.spacing
      ? [
          ...[SPACING_PASS, ...SPACING_RULES].map((r) => ({ ...r, category: '습관', rule: '띄어 쓸 곳을 붙임', p: HABIT_CONSISTENCY.spacing })),
          ...SPLIT_RULES.map((r) => ({ ...r, category: '습관', rule: '붙여 쓸 곳을 띄움', p: HABIT_CONSISTENCY.split })),
        ]
      : []),
  ];

  const segs = segment(text, options.keep);
  let out = '';
  segs.forEach((seg, i) => {
    if (seg.protected) {
      out += seg.text;
      ctx.tail = pushTail(ctx.tail, seg.text);
      return;
    }
    let s = seg.text;
    const segEndIsLineEnd = i === segs.length - 1 || segs[i + 1].text.startsWith('\n');
    if (habits.period) s = periodPass(s, segEndIsLineEnd, ctx);

    let pieces = [{ text: s, locked: false }];
    for (const { regex, replace, category, rule, p } of passes) {
      pieces = lockPass(pieces, regex, (m) => {
        if (p != null && !random.chance(p)) return null;
        const to = replace(m);
        if (to != null) ctx.changes.push({ category, rule, from: m[0], to });
        return to;
      });
    }
    if (enabled.has('slips')) pieces = slipPass(pieces, ctx);

    const segOut = pieces.map((p) => p.text).join('');
    out += segOut;
    ctx.tail = pushTail(ctx.tail, segOut);
  });

  const words = (text.match(/[가-힣]+/g) || []).length;
  return {
    text: out,
    changes: ctx.changes,
    person: { misconceptions: misconceptions.map((m) => m.id), habits },
    stats: { words, flaws: ctx.changes.length, rate: words ? ctx.changes.length / words : 0 },
    seed,
    level,
    profile: profileName,
  };
}

export default jimjit;
