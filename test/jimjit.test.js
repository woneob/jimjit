import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jimjit, MISCONCEPTIONS } from '../src/index.js';
import { compose, decompose } from '../src/hangul.js';
import { segment } from '../src/protect.js';

const SAMPLE = `아 진짜 괜찮아? 어제 했던 얘기 말인데, 생각해 보니까 우리 생각이 좀 다르게 보인다.
그래도 할 수 있을 것 같아. 내일 다시 얘기해 보자. 오늘은 좀 더 생각해 볼게.
어이없는 일이 금세 지나갈 거라고 믿어. 며칠만 기다리면 됐다 싶을 거야.
없었던 일로 하자는 게 아니라, 싫어도 한 번은 짚고 넘어가야 한다는 뜻이야.`;

const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);

test('한글 음절 분해·조합이 모든 음절에서 원래대로 돌아온다', () => {
  for (let c = 0xac00; c <= 0xd7a3; c++) {
    const ch = String.fromCodePoint(c);
    assert.equal(compose(decompose(ch)), ch);
  }
});

test('같은 시드면 같은 결과', () => {
  const a = jimjit(SAMPLE, { level: 7, seed: 42 });
  const b = jimjit(SAMPLE, { level: 7, seed: 42 });
  assert.equal(a.text, b.text);
  assert.deepEqual(a.changes, b.changes);
});

test('리포트에 나온 시드를 문자열로 넣어도 같은 결과 (CLI 재현)', () => {
  const first = jimjit(SAMPLE, { level: 7 });
  const again = jimjit(SAMPLE, { level: 7, seed: String(first.seed) });
  assert.equal(again.text, first.text);
});

test('레벨 1에서는 손 실수가 나지 않는다', () => {
  for (const seed of SEEDS) {
    const r = jimjit(SAMPLE, { level: 1, seed });
    assert.equal(r.changes.filter((c) => c.category === '손 실수').length, 0);
  }
});

test('레벨이 높을수록 평균 실수가 많아진다', () => {
  const avg = (level) => SEEDS.reduce((s, seed) => s + jimjit(SAMPLE, { level, seed }).stats.flaws, 0) / SEEDS.length;
  const [l1, l4, l7, l10] = [1, 4, 7, 10].map(avg);
  assert.ok(l1 < l4 && l4 < l7 && l7 < l10, `평균 실수: ${[l1, l4, l7, l10].join(', ')}`);
});

test('코드, URL, 이메일, 지정한 단어는 건드리지 않는다', () => {
  const protectedParts = ['`했다 = 됐다`', 'https://예시.kr/했던-글', 'me@example.com', '디지털 멀미'];
  const text = `코드는 ${protectedParts[0]} 이렇게 됐어. 링크는 ${protectedParts[1]} 이고 메일은 ${protectedParts[2]} 이야. ${protectedParts[3]}라고 부르는데 진짜 괜찮아?`;
  for (const seed of SEEDS) {
    const r = jimjit(text, { level: 10, profile: 'mobile', seed, keep: ['디지털 멀미'], misconceptions: ['됬'] });
    for (const p of protectedParts) assert.ok(r.text.includes(p), `${p} 가 바뀜: ${r.text}`);
  }
});

test('숫자와 영문은 그대로 남는다', () => {
  const text = '3D 게임이나 VR처럼 화면을 보는 환경에서 10분만 지나도 어지러웠어. 2026년에 했던 실험이야.';
  for (const seed of SEEDS) {
    const r = jimjit(text, { level: 10, profile: 'mobile', seed });
    for (const t of ['3D', 'VR', '10', '2026']) assert.ok(r.text.includes(t));
  }
});

test('몰라서 틀린 것은 글 전체에 일관되게 나타난다', () => {
  const text = '그건 됐어. 이제 됐고, 정말 다 됐다.';
  for (const seed of SEEDS) {
    const r = jimjit(text, { level: 10, seed, only: ['knowledge'] });
    const wrong = (r.text.match(/됬/g) || []).length;
    assert.ok(wrong === 0 || wrong === 3, `일관되지 않음: ${r.text}`);
  }
});

test('ㄹ 받침 뒤의 게만 께로 바꾼다', () => {
  const r = jimjit('내가 할게요. 먹을게. 이렇게 하면 돼.', { seed: 1, only: ['knowledge'], misconceptions: ['할께'] });
  assert.equal(r.text, '내가 할께요. 먹을께. 이렇게 하면 돼.');
});

test('사전: id가 겹치지 않고, 모든 짝이 맞는 형태 → 틀린 형태로 바뀐다', () => {
  const ids = MISCONCEPTIONS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length, '중복 id');
  for (const m of MISCONCEPTIONS) {
    for (const [right, wrong] of m.pairs || []) {
      assert.notEqual(right, wrong, m.id);
      const r = jimjit(right, { seed: 1, only: ['knowledge'], misconceptions: [m.id] });
      assert.equal(r.text, wrong, `${m.id}: ${right} → ${r.text}`);
    }
  }
});

test('-려고/-려면 앞 받침 없는 글자에만 ㄹ을 덧붙인다', () => {
  // 먹으려고 → 먹을려고 도 실제로 흔한 오류다
  const r = jimjit('가려고 했는데 보려면 먹으려고 했고 생각해 보려는 중.', { seed: 1, only: ['knowledge'], misconceptions: ['할려고'] });
  assert.equal(r.text, '갈려고 했는데 볼려면 먹을려고 했고 생각해 보려는 중.');
});

test('ㄹ 받침 뒤의 걸만 껄로 바꾼다', () => {
  const r = jimjit('그럴걸. 먹을걸요. 그 걸 봐.', { seed: 1, only: ['knowledge'], misconceptions: ['할껄'] });
  assert.equal(r.text, '그럴껄. 먹을껄요. 그 걸 봐.');
});

test('낱말 속에 우연히 든 형태는 건드리지 않는다', () => {
  const text = '가능한 한계를 넘었다. 기대가 컸다. 지난주에 하나가 보였다.';
  const ids = ['가능한 빨리', '댓가'];
  const r = jimjit(text, { seed: 1, only: ['knowledge', 'spacing'], misconceptions: ids, level: 10, profile: 'mobile' });
  assert.ok(r.text.includes('가능한 한계') && r.text.includes('기대가') && r.text.includes('하나가 보였다'), r.text);
});

test('오해 소지가 큰 오류는 레벨 7 미만에서 저절로 나오지 않는다', () => {
  const high = new Set(MISCONCEPTIONS.filter((m) => m.risk === 'high').map((m) => m.id));
  for (const seed of SEEDS) {
    const r = jimjit(SAMPLE, { level: 6, seed });
    assert.ok(!r.person.misconceptions.some((id) => high.has(id)));
  }
});

test('손 실수는 문장 첫 단어를 건드리지 않는다', () => {
  const text = '했어요 그거. 괜찮아 진짜. 없어요 정말.\n싫어해 아마.';
  const firsts = ['했어요', '괜찮아', '없어요', '싫어해'];
  for (const seed of SEEDS) {
    const r = jimjit(text, { level: 10, profile: 'mobile', seed, only: ['slips'] });
    for (const w of firsts) assert.ok(r.text.includes(w), `${w} 가 바뀜: ${r.text}`);
  }
});

test('한 단어에 실수는 하나만', () => {
  for (const seed of SEEDS) {
    const r = jimjit(SAMPLE, { level: 10, profile: 'mobile', seed });
    const touched = r.changes.filter((c) => c.category === '손 실수').map((c) => c.from);
    // 마침표 생략은 문장부호라 단어의 실수로 치지 않는다
    const knowledgeTo = r.changes.filter((c) => c.category !== '손 실수' && c.rule !== '마침표 생략').map((c) => c.to);
    for (const w of touched) assert.ok(!knowledgeTo.some((t) => w.includes(t)), `겹친 실수: ${w}`);
  }
});

test('번역투는 기본으로 꺼져 있고 켜면 나타난다', () => {
  const text = '이 결과는 의미 있어 보인다.';
  for (const seed of SEEDS) assert.ok(!jimjit(text, { level: 10, seed }).text.includes('보여진다'));
  assert.ok(jimjit(text, { level: 10, seed: 1, only: ['translationese'], with: ['translationese'] }).text.includes('보여진다'));
});

test('오타가 우연히 비속어를 만들지 않는다', () => {
  const text = '그 부분은 반대 방향의 불일치도 있어서 불일치라고 불러.';
  for (let seed = 1; seed <= 300; seed++) {
    assert.ok(!jimjit(text, { level: 10, profile: 'mobile', seed, only: ['slips'] }).text.includes('불알'));
  }
});

test('외래어에는 인접 모음 오타를, 같이·굳이에는 연음 오타를 내지 않는다', () => {
  const text = '어제 워크숍 끝나고 같이 커피 마셨는데 굳이 스케줄을 다시 잡자고 했어.';
  for (let seed = 1; seed <= 300; seed++) {
    const r = jimjit(text, { level: 10, profile: 'mobile', seed, only: ['slips'] });
    for (const c of r.changes) {
      assert.ok(!(c.rule === '인접 모음' && /워크숍|커피|스케줄/.test(c.from)), `${c.from}→${c.to}`);
      assert.ok(!(c.rule === '연음' && /같이|굳이/.test(c.from)), `${c.from}→${c.to}`);
    }
  }
});

test('인접 모음 오타는 손 실수 가운데 소수다', () => {
  let vowel = 0;
  let all = 0;
  for (let seed = 1; seed <= 200; seed++) {
    for (const c of jimjit(SAMPLE, { level: 10, seed, only: ['slips'] }).changes) {
      all++;
      if (c.rule === '인접 모음') vowel++;
    }
  }
  assert.ok(vowel / all < 0.2, `인접 모음 비율 ${(vowel / all).toFixed(2)}`);
});

test('보호 구간 분리', () => {
  const segs = segment('a `b` c https://x.y d', []);
  assert.deepEqual(segs.map((s) => s.protected), [false, true, false, true, false]);
});

test('마크다운 코드 블록과 인라인 코드는 보호한다', () => {
  const prot = (text) => segment(text, []).filter((s) => s.protected).map((s) => s.text);
  // 펜스: ``` / ~~~, 정보 문자열, 더 긴 닫는 펜스, 닫지 않은 펜스
  assert.deepEqual(prot('가\n```js\n괜찮아\n```\n나'), ['```js\n괜찮아\n```']);
  assert.deepEqual(prot('가\n~~~\n괜찮아\n~~~~\n나'), ['~~~\n괜찮아\n~~~~']);
  assert.deepEqual(prot('가\n````\n```\n괜찮아\n````'), ['````\n```\n괜찮아\n````']);
  assert.deepEqual(prot('가\n```\n괜찮아 끝까지'), ['```\n괜찮아 끝까지']);
  // 들여쓰기: 빈 줄 다음만, 중간 빈 줄 포함
  assert.deepEqual(prot('가\n\n    괜찮아\n\n\t진짜\n나'), ['    괜찮아\n\n\t진짜']);
  assert.deepEqual(prot('가\n    문단 이어짐'), []);
  // 인라인: 백틱 개수 맞추기, 빈 줄은 넘지 않음
  assert.deepEqual(prot('a ``b ` c`` d'), ['``b ` c``']);
  assert.deepEqual(prot('a `b\n\nc` d'), []);
});

test('HTML 태그와 파일 경로는 보호한다', () => {
  const prot = (text) => segment(text, []).filter((s) => s.protected).map((s) => s.text);
  // HTML: 태그·주석은 지키고, 태그 사이 본문은 글로 둔다. pre/code/script/style은 안쪽까지
  assert.deepEqual(prot('<span title="괜찮아">괜찮아</span>'), ['<span title="괜찮아">', '</span>']);
  assert.deepEqual(prot('가 <!-- 괜찮아 --> 나 <pre>괜찮아\n진짜</pre>'), ['<!-- 괜찮아 -->', '<pre>괜찮아\n진짜</pre>']);
  assert.deepEqual(prot('3 < 5 이고 괜찮아 > 진짜'), []);
  // 경로
  assert.deepEqual(prot('C:\\문서\\괜찮아.txt 를 열어요.'), ['C:\\문서\\괜찮아.txt']);
  assert.deepEqual(prot('\\\\서버\\공유\\파일.hwp 에'), ['\\\\서버\\공유\\파일.hwp']);
  assert.deepEqual(prot('/etc/hosts, ./src/a.js, ../문서/계획.md, ~/메모.md'), ['/etc/hosts', './src/a.js', '../문서/계획.md', '~/메모.md']);
  assert.deepEqual(prot('src/index.js 와 문서\\계획.docx, 보고서.docx를 보냈다.'), ['src/index.js', '문서\\계획.docx', '보고서.docx']);
  assert.deepEqual(prot('(C:\\a\\b.txt) 끝'), ['C:\\a\\b.txt']);
  // 경로가 아닌 것
  assert.deepEqual(prot('A/B 테스트, 그리고/또는, 1/2, 3.5배, 했다.그리고'), []);
});

test('코드 안의 글은 레벨 10에서도 바뀌지 않는다', () => {
  const codes = ['```\n괜찮아 진짜 할 수 있어 됐다\n```', '~~~\n괜찮아 진짜 할 수 있어 됐다\n~~~', '    괜찮아 진짜 할 수 있어 됐다', '`괜찮아 진짜 할 수 있어`'];
  const text = `설명입니다.\n\n${codes.join('\n\n')}\n\n괜찮아 진짜 할 수 있어.`;
  for (let seed = 1; seed <= 100; seed++) {
    const out = jimjit(text, { level: 10, seed }).text;
    for (const c of codes) assert.ok(out.includes(c), `seed ${seed}: ${c}`);
  }
});

test('띄어쓰기 습관: 패턴으로 붙이고, 낱말 안을 띄운다', () => {
  const pick = (text, rule) => {
    const seen = new Set();
    for (let seed = 1; seed <= 200; seed++) {
      for (const c of jimjit(text, { level: 10, seed, only: ['spacing'] }).changes) if (c.rule.startsWith(rule)) seen.add(`${c.from}→${c.to}`);
    }
    return seen;
  };
  const joined = pick('먹을 수 있다. 본 적 있어. 써 줘. 두 시간 걸려. 보내 드릴게요.', '띄어 쓸 곳을 붙임');
  for (const s of ['을 수→을수', '본 적→본적', '써 줘→써줘', '두 시간→두시간', '내 드릴→내드릴']) assert.ok(joined.has(s), s);
  const split = pick('공부하다. 학교에서 왔다.', '붙여 쓸 곳을 띄움');
  for (const s of ['공부하다→공부 하다', '학교에서→학교 에서']) assert.ok(split.has(s), s);
  // 붙이거나 띄우면 안 되는 것
  // only: spacing 이라 바뀐 것은 모두 띄어쓰기 실수다
  const none = pick('이가 보인다. 친구와 봤다. 한 지역. 내 주머니. 하늘. 올해. 대해서. 어떡해.', '');
  assert.equal(none.size, 0, [...none].join(', '));
});

test('잘못된 옵션은 알기 쉬운 오류를 낸다', () => {
  assert.throws(() => jimjit('가', { profile: 'nope' }), /프로필/);
  assert.throws(() => jimjit('가', { only: ['nope'] }), /규칙/);
  assert.throws(() => jimjit('가', { misconceptions: ['nope'] }), /오류 id/);
  assert.throws(() => jimjit('가', { level: 'abc' }), /레벨/);
});
