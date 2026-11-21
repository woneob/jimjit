// 실수를 넣으면 안 되는 구간을 떼어 둔다: 코드, HTML, URL, 이메일, 파일 경로, 마크다운 링크, 사용자가 지정한 단어.

// 파일 경로 조각. 공백에서 끝나고, 끝에 붙은 문장부호(. , ; : ! ? ) ])는 경로에서 뺀다.
const PATH_BODY = String.raw`[^\s"'<>|]`;
const PATH_END = String.raw`[^\s"'<>|.,;:!?)\]]`;
const PATH_TAIL = `(?:${PATH_BODY}*${PATH_END})?`;
// 경로는 단어 첫머리에서만 시작한다 (글 처음, 공백, 여는 괄호·따옴표 뒤)
const WORD_START = String.raw`(?<![^\s(\[{"'])`;
// 영문 확장자. 뒤에 한글 조사가 붙어도 된다 (보고서.docx를)
const EXT = String.raw`\.[A-Za-z][A-Za-z0-9]{0,7}(?![A-Za-z0-9])`;
const NAME = String.raw`[\w가-힣-]+`;

// 마크다운 코드는 CommonMark 규칙을 따른다. 줄 첫머리는 (?<![^\n]) 로 본다 (글 처음이거나 바로 앞이 줄바꿈).
// 앞에 있는 패턴이 같은 자리에서 먼저 잡힌다.
const BUILTIN = [
  // 펜스 코드 블록: ``` 또는 ~~~ 3개 이상. 같은 문자로 같은 길이 이상의 닫는 펜스까지, 닫지 않았으면 글 끝까지
  String.raw`(?<![^\n]) {0,3}(?<fb>${'`'}{3,})[^${'`'}\n]*(?:\n[\s\S]*?)?(?:\n {0,3}\k<fb>${'`'}*[ \t]*(?![^\n])|$)`,
  String.raw`(?<![^\n]) {0,3}(?<ft>~{3,})[^\n]*(?:\n[\s\S]*?)?(?:\n {0,3}\k<ft>~*[ \t]*(?![^\n])|$)`,
  // 들여쓰기 코드 블록: 빈 줄(또는 글 처음) 다음, 공백 4칸이나 탭으로 시작하는 줄들
  String.raw`(?<=^|\n[ \t]*\n)(?: {4}|\t)[^\n]*(?:\n(?:[ \t]*\n)*(?: {4}|\t)[^\n]*)*`,
  // 인라인 코드: 같은 개수의 백틱으로 닫는다 (``a ` b`` 도 하나). 빈 줄은 넘지 않는다
  String.raw`(?<ib>${'`'}+)(?!${'`'})(?:[^\n]|\n(?![ \t]*\n))*?(?<!${'`'})\k<ib>(?!${'`'})`,
  // HTML: 주석, 안쪽까지 통째로 지킬 요소, 태그 자체 (태그 사이의 본문은 글이므로 지키지 않는다)
  String.raw`<!--[\s\S]*?-->`,
  String.raw`<(?<rb>pre|PRE|code|CODE|script|SCRIPT|style|STYLE)\b[^>]*>[\s\S]*?</\k<rb>\s*>`,
  String.raw`</?[A-Za-z][\w:-]*(?:\s[^<>]*)?/?>`,
  String.raw`https?:\/\/[^\s)>\]]+`, // URL
  String.raw`www\.[^\s)>\]]+`,
  String.raw`[\w.+-]+@[\w-]+(?:\.[\w-]+)+`, // 이메일
  String.raw`\[[^\]\n]*\]\([^)\n]*\)`, // 마크다운 링크
  // 파일 경로
  String.raw`${WORD_START}[A-Za-z]:[\\/]${PATH_TAIL}`, // C:\문서\a.txt, D:/work
  String.raw`${WORD_START}\\\\${PATH_BODY}*${PATH_END}`, // \\서버\공유
  String.raw`${WORD_START}/[^\s/"'<>|]+/${PATH_TAIL}`, // /usr/local, /etc/hosts (/가 두 번 이상)
  String.raw`${WORD_START}(?:\.{1,2}|~)[\\/]${PATH_TAIL}`, // ./src, ../문서, ~/메모.md, .\bin
  String.raw`${WORD_START}${NAME}(?:[\\/.]${NAME})*${EXT}`, // src/index.js, 문서\계획.docx, 보고서.docx
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
