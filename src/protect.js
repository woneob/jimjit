// 실수를 넣으면 안 되는 구간을 떼어 둔다: 코드, URL, 이메일, 마크다운 링크, 사용자가 지정한 단어.

const BUILTIN = [
  '```[\\s\\S]*?```', // 코드 블록
  '`[^`\\n]+`', // 인라인 코드
  'https?:\\/\\/[^\\s)>\\]]+', // URL
  'www\\.[^\\s)>\\]]+',
  '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+', // 이메일
  '\\[[^\\]\\n]*\\]\\([^)\\n]*\\)', // 마크다운 링크
];

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 문자열 목록 → 정규식 대안 패턴. 긴 것부터 두어야 "할 수 있"이 "수 있"보다 먼저 잡힌다.
export const alternation = (strings) => [...strings].sort((a, b) => b.length - a.length).map(escape).join('|');

// → [{ text, protected }]
export function segment(text, keep = []) {
  const words = alternation(keep.map((w) => w.trim()).filter(Boolean));
  const re = new RegExp([...(words ? [words] : []), ...BUILTIN].join('|'), 'g');
  const out = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), protected: false });
    out.push({ text: m[0], protected: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), protected: false });
  return out;
}
