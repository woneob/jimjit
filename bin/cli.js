#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { text as readAll } from 'node:stream/consumers';
import { jimjit, PROFILES, MISCONCEPTIONS, RULES, HIGH_RISK_LEVEL } from '../src/index.js';

const HELP = `jimjit — 글에 사람의 실수(오타, 맞춤법 혼동, 습관)를 입힙니다

사용법
  jimjit "텍스트" [옵션]
  jimjit --file 글.txt [옵션]
  cat 글.txt | jimjit [옵션]

옵션
  -l, --level <1-10>     실수의 양 (기본 3). 1은 거의 티 안 나게, 10은 덕후 수준
  -p, --profile <이름>   실수 프로필 (기본 default). --list 로 목록 확인
  -s, --seed <값>        결과를 고정하는 번호. 주지 않으면 매번 달라지고,
                         같은 값을 주면 같은 결과가 다시 나옴 (--report에 표시)
  -k, --keep <단어,…>    실수를 넣지 않을 단어 (고유명사, 핵심 용어)
  -f, --file <경로>      UTF-8 텍스트 파일에서 읽기 (Windows에서는 이쪽을 권장)
      --only <규칙,…>    이 실수 규칙만 사용
      --without <규칙,…> 이 실수 규칙은 끔
      --with <규칙,…>    기본 꺼진 실수 규칙을 켬 (translationese)
      --mis <id,…>       "잘못 알고 있는 표현"을 이 오류들로만 고정 (예: 됬,할께)
  -r, --report           글쓴이 컨셉과 바꾼 내용을 stderr에 출력
      --json             결과 전체를 JSON으로 출력
      --list             프로필, 실수 규칙, 오류 id 목록
  -h, --help             도움말

실수 규칙: ${RULES.join(', ')}`;

function parse(argv) {
  const opts = { keep: [], text: [] };
  const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
  const alias = { l: 'level', p: 'profile', s: 'seed', k: 'keep', f: 'file', r: 'report', h: 'help' };
  const flags = new Set(['report', 'json', 'list', 'help']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('-') || a === '-') {
      opts.text.push(a);
      continue;
    }
    let [key, value] = a.replace(/^--?/, '').split(/=(.*)/s);
    key = alias[key] || key;
    if (flags.has(key)) {
      opts[key] = true;
      continue;
    }
    if (value === undefined) value = argv[++i];
    if (value === undefined) throw new Error(`--${key} 에 값이 필요해요`);
    if (key === 'keep') opts.keep.push(...list(value));
    else if (['only', 'without', 'with', 'mis'].includes(key)) opts[key] = list(value);
    else if (['level', 'profile', 'seed', 'file'].includes(key)) opts[key] = value;
    else throw new Error(`알 수 없는 옵션이에요: ${a}`);
  }
  return opts;
}

const readStdin = () => (process.stdin.isTTY ? null : readAll(process.stdin));

function printList() {
  console.log('프로필');
  for (const [k, p] of Object.entries(PROFILES)) console.log(`  ${k.padEnd(10)} ${p.label}`);
  console.log(`\n실수 규칙\n  ${RULES.join(', ')}  (translationese는 기본 꺼짐)`);
  console.log('\n오류 id (몰라서 틀림)');
  for (const m of MISCONCEPTIONS) console.log(`  ${m.id.padEnd(8)} ${m.kind}${m.risk === 'high' ? ` · 오해 소지 큼(레벨 ${HIGH_RISK_LEVEL}+)` : ''}`);
}

// 습관 → 리포트 문장. 자리마다 나타날 확률이 85~100%라 "자주"로 적는다
const HABIT_TEXT = {
  spacing: '띄어 써야 할 곳을 자주 붙여 쓰고, 가끔은 붙여 쓸 곳을 띄움',
  period: '문장 끝 마침표를 자주 생략함',
  translationese: '번역투 표현을 씀',
};

// 오류 id → "맞는 형태 → 틀린 형태". id는 대개 틀린 형태의 온전한 단어(어쨋든)라서,
// 사전의 쌍을 거꾸로 적용해 맞는 형태(어쨌든)를 만든다. 안 되면 첫 쌍을 그대로 보여 준다.
const MISCONCEPTION_BY_ID = new Map(MISCONCEPTIONS.map((m) => [m.id, m]));
function misconceptionLabel(id) {
  const m = MISCONCEPTION_BY_ID.get(id);
  if (m.example) return `${m.example[0]} → ${m.example[1]}`;
  const hit = m.pairs.find(([, wrong]) => id.includes(wrong.trim()));
  const [right, wrong] = hit ? [id.replace(hit[1].trim(), hit[0].trim()), id] : m.pairs[0];
  return `${right.trim()} → ${wrong.trim()}`;
}

// ── 상자 그리기 ──
// 터미널에서 한글·한자 같은 전각 문자는 두 칸을 차지한다. 칸 수로 맞춰야 오른쪽 테두리가 줄을 맞춘다.
const isWide = (cp) =>
  (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6);
const width = (s) => [...s].reduce((w, ch) => w + (isWide(ch.codePointAt(0)) ? 2 : 1), 0);
const padEnd = (s, w) => s + ' '.repeat(Math.max(0, w - width(s)));

// 상자 안 여백: 좌우 칸 수, 구역마다 위아래 빈 줄
const PAD = 2;
const GAP = '   '; // 목록 항목 사이
// 상자 안쪽(여백 제외) 최대 폭. 터미널이 좁으면 거기에 맞춘다
const MAX_INNER = Math.max(36, Math.min(70, (process.stderr.columns || 80) - 2 - PAD * 2));

// 항목들을 GAP으로 이어 폭에 맞게 여러 줄로 나눈다
function wrapItems(items, max) {
  const lines = [];
  let cur = '';
  for (const it of items) {
    const next = cur ? cur + GAP + it : it;
    if (cur && width(next) > max) {
      lines.push(cur);
      cur = it;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

// 테두리는 흐리게 (회색). 터미널일 때만, NO_COLOR가 있으면 끈다 (https://no-color.org)
const COLOR = process.stderr.isTTY && !('NO_COLOR' in process.env);
const dim = (s) => (COLOR ? `\x1b[90m${s}\x1b[39m` : s);

// 비어 있음을 알리는 줄 (특별한 습관 없음, 저지른 실수가 없음). 흐리게 보여 준다
const empty = (text) => ({ text, empty: true });
const textOf = (l) => (typeof l === 'string' ? l : l.text);

// 상자 안쪽(여백 제외)에 필요한 폭: 가장 긴 줄, 또는 테두리에 박힌 제목
const innerWidth = (sections) =>
  Math.max(...sections.flatMap((s) => [...s.lines.map((l) => width(textOf(l))), s.title ? width(s.title) + 2 : 0]));

// sections: [{ title?, lines }] → 제목이 테두리에 박힌 상자. 구역 사이는 ├─┤ 로 나눈다
// inner를 주면 그 폭으로 그린다 (여러 상자의 너비를 맞출 때)
function box(sections, inner = innerWidth(sections)) {
  const full = inner + PAD * 2;
  // 제목은 흐리게 하지 않는다
  const rule = (l, r, title) =>
    title ? `${dim(`${l}─ `)}${title}${dim(` ${'─'.repeat(full - 3 - width(title))}${r}`)}` : dim(`${l}${'─'.repeat(full)}${r}`);
  const row = (l) => {
    const text = padEnd(textOf(l), inner);
    return `${dim('│')}${' '.repeat(PAD)}${l.empty ? dim(text) : text}${' '.repeat(PAD)}${dim('│')}`;
  };
  const out = [];
  sections.forEach((s, i) => {
    out.push(i === 0 ? rule('┌', '┐', s.title) : rule('├', '┤', s.title));
    out.push(row(''), ...s.lines.map(row), row(''));
  });
  out.push(rule('└', '┘'));
  return out;
}

function printReport(r) {
  // "잘못 알고 있는 표현" 중 이 글에 실제로 드러난 것
  const shown = new Set(r.changes.filter((c) => c.category === '몰라서 틀림').map((c) => c.rule.split(': ')[1]));
  const mis = r.person.misconceptions;
  const habits = Object.keys(HABIT_TEXT).filter((k) => r.person.habits[k]);
  const concept = [
    {
      title: mis.length ? `잘못 알고 있는 표현 ${mis.length}개${shown.size ? ' (* 이 글에 드러난 것)' : ''}` : '잘못 알고 있는 표현',
      lines: mis.length ? wrapItems(mis.map((id) => misconceptionLabel(id) + (shown.has(id) ? '*' : '')), MAX_INNER) : [empty('없음')],
    },
    { title: '성향', lines: habits.length ? habits.map((k) => HABIT_TEXT[k]) : [empty('특별한 습관 없음')] },
  ];
  const mistakes = [
    { lines: r.changes.length ? r.changes.map((c) => `[${c.category}] ${c.rule} (${c.from} → ${c.to})`) : [empty('저지른 실수가 없음')] },
  ];
  // 두 상자를 더 넓은 쪽 너비로 맞춘다
  const inner = Math.max(innerWidth(concept), innerWidth(mistakes));
  const lines = [
    '',
    `• Seed: ${r.seed}`,
    `• Level: ${r.level}`,
    `• Profile: ${r.profile}`,
    '',
    '글쓴이 컨셉',
    ...box(concept, inner),
    '',
    `실수 ${r.stats.flaws}개`,
    ...box(mistakes, inner),
  ];
  process.stderr.write(lines.join('\n') + '\n');
}

async function main() {
  const opts = parse(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  if (opts.list) return printList();

  let text = opts.file ? readFileSync(opts.file, 'utf8') : opts.text.length ? opts.text.join(' ') : await readStdin();
  if (text == null || text === '') {
    console.error('입력할 글이 없어요. jimjit --help 를 확인해 주세요.');
    process.exit(1);
  }
  text = text.replace(/^\uFEFF/, '');

  const result = jimjit(text, {
    level: opts.level,
    profile: opts.profile,
    seed: opts.seed,
    keep: opts.keep,
    only: opts.only,
    without: opts.without,
    with: opts.with,
    misconceptions: opts.mis,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    // 머리말은 리포트와 함께 stderr로 보낸다. stdout에는 결과 글만 남아야 파이프·파일 저장이 깨끗하다
    if (opts.report) process.stderr.write('\nresult:\n');
    process.stdout.write(result.text.endsWith('\n') ? result.text : `${result.text}\n`);
  }
  if (opts.report) printReport(result);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
