// 실수 프로필: 문체가 아니라 "어떤 실수가 얼마나 나오는가"의 프리셋. 숫자는 기본 대비 배율.

export const PROFILES = {
  default: { label: '일반', slip: 1, knowledge: 1, highRisk: true, spacing: 1, period: 1, translationese: 0 },
  work: { label: '업무 메시지', slip: 0.4, knowledge: 0.5, highRisk: false, spacing: 0.6, period: 0.8, translationese: 0 },
  mobile: { label: '모바일 채팅', slip: 1.6, knowledge: 1, highRisk: true, spacing: 1.4, period: 1.3, translationese: 0 },
  community: { label: '커뮤니티', slip: 1, knowledge: 1.5, highRisk: true, spacing: 1.3, period: 1.2, translationese: 0 },
  bookish: { label: '번역서 문체', slip: 0.5, knowledge: 0.5, highRisk: false, spacing: 0.5, period: 0, translationese: 1 },
};

// 레벨 1~10 → 어절 하나에 손 실수가 날 확률
const SLIP_BY_LEVEL = [0, 0.01, 0.02, 0.035, 0.05, 0.07, 0.09, 0.12, 0.15, 0.2];

// 오해 소지가 큰 오류는 이 레벨부터
export const HIGH_RISK_LEVEL = 7;

export function clampLevel(level) {
  const n = Math.round(Number(level));
  if (!Number.isFinite(n)) throw new Error(`레벨은 1~10 사이의 숫자여야 해요: ${level}`);
  return Math.min(10, Math.max(1, n));
}

export function ratesFor(level, p, { forceTranslationese = false } = {}) {
  const habit = 0.15 + level * 0.08; // 레벨 1: 23%, 5: 55%, 10: 95%
  const tw = forceTranslationese ? Math.max(1, p.translationese) : p.translationese;
  return {
    slip: Math.min(0.5, SLIP_BY_LEVEL[level - 1] * p.slip),
    // 오해 하나를 "갖고 있을" 확률. 사전 항목이 많으므로 낮게 잡는다 (L3 12%, L10 40%)
    knowledge: Math.min(1, level * 0.04 * p.knowledge),
    highRisk: level >= HIGH_RISK_LEVEL && p.highRisk,
    spacing: Math.min(1, habit * p.spacing),
    period: Math.min(1, habit * p.period),
    translationese: Math.min(1, level * 0.1 * tw),
  };
}
