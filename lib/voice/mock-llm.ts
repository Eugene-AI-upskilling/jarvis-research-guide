/** Local rule-based responder used when the Claude router is unavailable. */

const REFLEX_RULES: Array<{ test: (q: string) => boolean; reply: () => string }> = [
  {
    test: (q) => /시간|몇\s*시/.test(q),
    reply: () => {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `현재 시각은 ${hh}시 ${mm}분입니다.`;
    },
  },
  {
    test: (q) => /안녕|hello|hi/i.test(q),
    reply: () => '안녕하세요 고객님. 무엇을 도와드릴까요?',
  },
  {
    test: (q) => /고마|감사|땡큐|thanks/i.test(q),
    reply: () => '천만에요, 고객님.',
  },
  {
    test: (q) => /이름|누구/.test(q),
    reply: () => '저는 자비스입니다. 고객님 전용 어시스턴트로 동작 중입니다.',
  },
  {
    test: (q) => /상태|시스템|컨디션/.test(q),
    reply: () => '음성 입출력은 정상이지만, 클라우드 응답 라우터에 연결되지 않아 제한 모드로 동작 중입니다.',
  },
];

export async function mockRespond(userText: string): Promise<string> {
  await delay(700 + Math.random() * 600);
  const trimmed = userText.trim();
  if (!trimmed) return '말씀을 알아듣지 못했습니다, 고객님.';

  const rule = REFLEX_RULES.find((r) => r.test(trimmed));
  if (rule) return rule.reply();

  return `죄송합니다 고객님, 지금은 제한 모드라 "${trimmed}"에 대한 답을 제대로 드리기 어렵습니다.`;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
