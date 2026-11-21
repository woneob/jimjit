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
      --mis <id,…>       "모르는 것"을 이 오류들로만 고정 (예: 됬,할께)
  -r, --report           무엇을 어떻게 바꿨는지 stderr에 출력
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

function printReport(r) {
  const h = r.person.habits;
  const yn = (b) => (b ? 'O' : 'X');
  // 사람이 "모르는 것" 중 이 글에 실제로 드러난 것만 보여 준다
  const shown = [...new Set(r.changes.filter((c) => c.category === '몰라서 틀림').map((c) => c.rule.split(': ')[1]))];
  const lines = [
    `seed ${r.seed} · 레벨 ${r.level} · 프로필 ${PROFILES[r.profile].label}(${r.profile})`,
    `이 사람: 모르는 것 ${r.person.misconceptions.length}개 중 이 글에 드러난 것 [${shown.join(', ') || '없음'}] · 띄어쓰기 붙임 ${yn(h.spacing)} · 마침표 생략 ${yn(h.period)} · 번역투 ${yn(h.translationese)}`,
    `실수 ${r.stats.flaws}개 / 어절 ${r.stats.words}개 (${(r.stats.rate * 100).toFixed(1)}%)`,
    ...r.changes.map((c) => `  - ${c.category.padEnd(6)} ${c.rule}: ${c.from} → ${c.to}`),
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
    process.stdout.write(result.text.endsWith('\n') ? result.text : `${result.text}\n`);
  }
  if (opts.report) printReport(result);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
