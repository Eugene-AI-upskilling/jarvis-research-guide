# 자비스 — AI 리서치 가이드 (홈페이지 팝업용)

홈페이지의 카드를 누르면 자비스가 팝업으로 떠서, 일반 고객의 질문("주가는 왜 떨어지나요?" 등)을
**말로 설명하고 화면에 자료 카드(핵심 정리 · 원인→결과 흐름 · 수치 · 차트 · 출처)를 띄웁니다.**
음성으로 이어서 대화할 수 있고, 웹캠 손 제스처(FACE MODE)도 지원합니다.

- 동작 시연: 서버를 띄운 뒤 `/demo.html` 을 열고 카드를 눌러 보세요.

## 1. 구조

```
[여러분 홈페이지]  ──(embed.js)──▶  팝업(iframe) = 자비스 웹앱  ──▶  /api/brief, /api/chat  ──▶  Anthropic API (+웹 검색)
```

자비스는 **서버가 필요한 Next.js 앱**입니다 (Anthropic API 키를 서버에서만 사용).
홈페이지와 별도 주소(예: `https://jarvis.example.com`)로 배포하고, 홈페이지에는 스크립트 한 줄만 추가합니다.

## 2. 설치 · 실행

Node.js 20 이상이 필요합니다.

```bash
npm install
cp .env.local.example .env.local   # 값 채우기 (아래 표)
npm run dev                        # 개발: http://localhost:3000
npm run build && npm start         # 운영
```

| 환경 변수 | 설명 |
|---|---|
| `ANTHROPIC_API_KEY` | **필수.** 회사 계정으로 발급. 사용료는 이 키로 청구됩니다. |
| `NEXT_PUBLIC_ORG_NAME` | 화면 상단 기관명 |
| `EMBED_ALLOWED_ORIGINS` | 자비스를 팝업으로 띄울 수 있는 홈페이지 주소. **이 값에 없는 사이트는 팝업이 막힙니다.** |
| `RATE_LIMIT_PER_10MIN` | 방문자(IP)당 10분에 새 조사 횟수 (기본 20) |
| `DAILY_RESEARCH_LIMIT` | 하루 전체 새 조사 상한 (기본 500) — 비용 폭주 방지 |
| `CACHE_TTL_HOURS` | 같은 질문의 답을 다시 쓰는 시간 (기본 6) |

## 3. 홈페이지에 붙이기

```html
<!-- 1) 페이지 아무 곳에 한 줄 -->
<script src="https://jarvis.example.com/embed.js" defer></script>

<!-- 2) 자비스를 띄울 카드에 질문만 붙이기 -->
<div class="card" data-jarvis-question="주가는 왜 떨어지나요?">…기존 카드 내용…</div>
```

- 카드(또는 버튼·링크) 어디든 `data-jarvis-question="질문"` 을 붙이면, 누를 때 그 질문으로 팝업이 열립니다.
- 직접 호출: `window.Jarvis.open('오늘 코스피는 왜 움직였나요?')`, 닫기: `window.Jarvis.close()`
- 팝업이 열린 상태에서 다른 카드를 누르면 같은 팝업에서 이어서 대화합니다.
- 바깥 클릭 · ESC · 팝업 안 「닫기」로 닫힙니다.

## 4. 배포

- **https 필수** — 마이크(음성 대화)·카메라(FACE MODE)는 https 에서만 동작합니다.
- 일반 Node 서버(`npm start`) 또는 Docker 에 올리는 것을 권장합니다. 응답을 스트리밍하고 한 번에 최대 20초 정도 걸립니다.
- Vercel 도 가능하지만, 함수 실행 시간 제한(요금제별)과 서버 인스턴스마다 따로인 횟수 제한·답변 저장을 감안하세요.
- 답변 저장: 서버 디스크 `data/brief-cache.json` (쓸 수 없는 환경이면 메모리에만 저장).

## 5. 비용 감각

- 새 질문 1회 ≈ 웹 검색 여러 번 + AI 호출 2회 → **약 100~200원**
- 같은 질문(저장된 답, `CACHE_TTL_HOURS` 안) → 거의 0원
- 홈페이지 카드 질문은 처음 한 번만 돈이 들고 이후엔 저장된 답이 나갑니다.

## 6. 내용 · 준법

- 시스템 지시로 **특정 종목 매수·매도 권유, 목표가, 수익 보장 표현을 하지 않고**, 확인되지 않은 숫자는 쓰지 않도록 했습니다.
- 모든 카드 하단에 "투자 권유 아님" 문구가 표시됩니다 (`lib/brief/presets.ts` 의 `DISCLAIMER`).
- AI 답변은 틀릴 수 있습니다. **공개 전 회사 준법감시 검토를 받으세요.**

## 7. 고칠 곳 빠른 안내

| 바꾸고 싶은 것 | 파일 |
|---|---|
| 기본 질문 메뉴 · 면책 문구 | `lib/brief/presets.ts` |
| 카드 내용 지시(차트·말투·금지 표현) | `app/api/brief/route.ts` 의 `systemPrompt`, `quickAnswer` |
| 인사·잡담 말투 | `lib/ai/system-prompt.ts` |
| 카드 화면 | `components/brief/BriefCard.tsx`, `BriefChart.tsx` |
| 팝업 크기 · 동작 | `public/embed.js` |
| 손 제스처 | `components/hud/HandTracker.tsx` |
| 비용 보호(횟수 제한) | `lib/server/guard.ts` |
