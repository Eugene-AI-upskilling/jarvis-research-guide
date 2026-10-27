import type Anthropic from '@anthropic-ai/sdk';

export type RouterTool =
  | 'respond_directly'
  | 'execute_code_task'
  | 'research_web'
  | 'local_helper'
  | 'open_webpage';

export const ROUTER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'respond_directly',
    description:
      '인사, 잡담, 의견 교환, 자비스 페르소나에 관한 질문 (예: "너는 누구야", "기분 어때") 등 외부 데이터 없이 답할 수 있는 발화에만 사용. **사실 정보·날씨·시세·뉴스·최근 소식은 절대 이 도구로 답하지 말 것** — 그런 질문은 research_web으로 가야 함. JARVIS 페르소나로 한국어 1~2문장의 자연스러운 음성 응답.',
    input_schema: {
      type: 'object',
      properties: {
        reply: {
          type: 'string',
          description:
            '고객님께 음성으로 들려줄 한국어 응답 (1~2문장, 마크다운/이모지 금지).',
        },
      },
      required: ['reply'],
    },
  },

  {
    name: 'research_web',
    description:
      '투자·시장·경제에 관한 모든 질문에 사용 (화면에 조사 카드를 띄움). 개념 설명 질문도 포함. 웹 검색이 필요한 모든 요청에 사용. **다음 모두 포함**: 날씨/기온/강수/미세먼지(예: "오늘 추워?", "지금 비와?", "날씨 어때"), 주가/시세/환율/코인 가격, 뉴스/최근 소식, 회사·인물·제품 조사, 시점이 포함된 사실 질문(예: "오늘 ___", "최근 ___", "지금 ___"). **모르는 사실은 직접 답하지 말고 무조건 이 도구로 검색**. Claude의 web_search 도구로 실제 검색 수행.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            '조사할 질문을 앞 대화 없이도 이해되는 완전한 한 문장으로 (예: 앞에서 반도체 얘기를 하다 "그럼 삼성전자는?" → "삼성전자 주가는 최근 왜 움직였나요?"). 한국어.',
        },
        ack_reply: {
          type: 'string',
          description:
            '조사하는 동안 들려줄 아주 짧은 대답 (15자 안팎, 사람처럼). 예: "네, 삼성전자 찾아볼게요." / "잠시만요, 확인해 볼게요."',
        },
      },
      required: ['query', 'ack_reply'],
    },
  },

  {
    name: 'local_helper',
    description:
      '외부 정보 일절 필요 없고 로컬에서 즉시 처리되는 4가지 요청에만 사용. **action별 사용 조건**: time = 순수 시각 질문 ("지금 몇 시", "몇 시야") — 날씨/날 추이 질문은 X. date = 순수 날짜 질문 ("오늘 며칠?", "내일 날짜") — "오늘 추워?" 같은 날씨는 X. calc = 산수 계산. memo = 메모 저장. **"오늘 비와?", "지금 추워?", "오늘 날씨" 같이 날씨/실시간 정보가 필요한 질문은 절대 이 도구 X — research_web으로 가야 함.**',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['time', 'date', 'calc', 'memo'],
          description:
            '수행할 작업 종류. time=현재 시간, date=오늘 날짜, calc=수식 계산, memo=메모 추가.',
        },
        payload: {
          type: 'string',
          description:
            'action에 필요한 입력. time/date는 빈 문자열, calc는 수식 문자열(예 "23 * 7"), memo는 메모 본문.',
        },
      },
      required: ['action', 'payload'],
    },
  },
];
