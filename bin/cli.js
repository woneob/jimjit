#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { text as readAll } from 'node:stream/consumers';
import { jimjit, PROFILES, MISCONCEPTIONS, RULES, HIGH_RISK_LEVEL } from '../src/index.js';
import { sideBySide, columnWidth, width, padEnd } from './side-by-side.js';

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
  -r, --report           글쓴이 컨셉, 바꾼 내용, 원본·결과 비교표를 stderr에 출력
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

// ── 리포트 표 ──
// 폭은 글자 수가 아니라 칸 수(width)로 맞춘다. 한글은 두 칸

const PAD = 2; // 칸 안 좌우 여백
const GAP = '   '; // 목록 항목 사이

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

// 띄어쓰기 단위로 줄바꿈. 폭보다 긴 낱말은 글자 단위로 끊는다
function wrapText(text, max) {
  const lines = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (width(next) <= max) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = '';
    for (const ch of word) {
      if (width(cur + ch) > max) {
        lines.push(cur);
        cur = '';
      }
      cur += ch;
    }
  }
  lines.push(cur);
  return lines;
}

// 테두리는 흐리게 (회색). 터미널일 때만, NO_COLOR가 있으면 끈다 (https://no-color.org)
const COLOR = process.stderr.isTTY && !('NO_COLOR' in process.env);
const dim = (s) => (COLOR ? `\x1b[90m${s}\x1b[39m` : s);
const cyan = (s) => (COLOR ? `\x1b[36m${s}\x1b[39m` : s);
const yellow = (s) => (COLOR ? `\x1b[33m${s}\x1b[39m` : s);
const white = (s) => (COLOR ? `\x1b[97m${s}\x1b[39m` : s);

// 컬럼의 한 줄: 글, 흐린 글(empty), 가로줄(RULE)
const RULE = { rule: true };
const text = (t, note) => ({ text: t, note });
const empty = (t) => ({ text: t, empty: true });

// [{ title, note?, lines }] → 컬럼 줄 배열 (제목 / 가로줄 / 내용 / 빈 줄, 구역 사이 가로줄)
function column(sections, inner) {
  const out = [];
  sections.forEach((s, i) => {
    if (i > 0) out.push(RULE);
    // note는 한 줄에 들어갈 때만
    const title = wrapText(s.title, inner);
    const last = title.pop();
    out.push(...title.map((t) => text(t)));
    out.push(text(last, s.note && width(last + s.note) <= inner ? s.note : ''), RULE);
    for (const l of s.lines) {
      if (typeof l === 'string') out.push(...wrapText(l, inner).map((t) => text(t)));
      else out.push(...wrapText(l.text, inner).map(empty));
    }
    out.push(text(''));
  });
  return out;
}

// 두 컬럼을 한 표로 그린다. colW를 비교표와 같게 주면 가운데 세로줄이 맞는다
function table(left, right, colW) {
  const inner = colW - PAD * 2;
  const cell = (c) => {
    if (!c || c.rule) return ' '.repeat(colW);
    const note = c.note || '';
    const fill = ' '.repeat(Math.max(0, inner - width(c.text + note)));
    const body = c.empty ? dim(c.text) : c.text;
    return ' '.repeat(PAD) + body + (note && dim(note)) + fill + ' '.repeat(PAD);
  };
  const line = '─'.repeat(colW);
  const out = [dim(`┌${line}┬${line}┐`)];
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const l = left[i];
    const r = right[i];
    const lr = l?.rule;
    const rr = r?.rule;
    const mid = lr && rr ? '┼' : lr ? '┤' : rr ? '├' : '│';
    out.push(
      (lr ? dim(`├${line}`) : dim('│') + cell(l)) + dim(mid) + (rr ? dim(`${line}┤`) : cell(r) + dim('│')),
    );
  }
  out.push(dim(`└${line}┴${line}┘`));
  return out;
}

// 시드·레벨·프로필 → 글쓴이 컨셉 | 실수 표 → 원본·결과 비교표
function printReport(original, r) {
  // 파이프면 폭을 알 수 없어 80칸
  const columns = process.stderr.columns || 80;
  const colW = columnWidth(columns);
  const inner = colW - PAD * 2;
  // "잘못 알고 있는 표현" 중 이 글에 실제로 드러난 것
  const shown = new Set(r.changes.filter((c) => c.category === '몰라서 틀림').map((c) => c.rule.split(': ')[1]));
  const mis = r.person.misconceptions;
  const habits = Object.keys(HABIT_TEXT).filter((k) => r.person.habits[k]);
  const left = column(
    [
      {
        title: `잘못 알고 있는 표현 (${mis.length}개)`,
        note: shown.size ? '  * 이 글에 드러난 것' : '',
        lines: mis.length ? wrapItems(mis.map((id) => misconceptionLabel(id) + (shown.has(id) ? '*' : '')), inner) : [empty('없음')],
      },
      { title: `성향 (${habits.length}개)`, lines: habits.length ? habits.map((k) => HABIT_TEXT[k]) : [empty('특별한 습관 없음')] },
    ],
    inner,
  );
  const right = column(
    [
      {
        title: `실수 (${r.stats.flaws}개)`,
        lines: r.changes.length ? r.changes.map((c) => `[${c.category}] ${c.rule} (${c.from} → ${c.to})`) : [empty('저지른 실수가 없음')],
      },
    ],
    inner,
  );
  const lines = [
    '',
    `• Seed: ${cyan(r.seed)}`,
    `• Level: ${yellow(r.level)}`,
    `• Profile: ${white(r.profile)}`,
    '',
    ...table(left, right, colW),
    '',
    ...sideBySide(original, r.text, { columns, color: COLOR }),
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
  if (opts.report) printReport(text, result);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
