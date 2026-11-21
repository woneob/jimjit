// 한글 음절 분해/조합. 외부 의존성 없이 유니코드 산식만 사용한다.
const BASE = 0xac00;
const LAST = 0xd7a3;

const CHO = Array.from('ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ');
const JUNG = Array.from('ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ');
const JONG = ['', ...Array.from('ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ')];

export function isSyllable(ch) {
  if (!ch) return false;
  const c = ch.codePointAt(0);
  return c >= BASE && c <= LAST;
}

export function decompose(ch) {
  const n = ch.codePointAt(0) - BASE;
  return {
    cho: CHO[Math.floor(n / 588)],
    jung: JUNG[Math.floor((n % 588) / 28)],
    jong: JONG[n % 28],
  };
}

export function compose({ cho, jung, jong }) {
  const c = CHO.indexOf(cho);
  const j = JUNG.indexOf(jung);
  const t = JONG.indexOf(jong);
  if (c < 0 || j < 0 || t < 0) return null;
  return String.fromCodePoint(BASE + (c * 21 + j) * 28 + t);
}
