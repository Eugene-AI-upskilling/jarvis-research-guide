/** Question menu shown to visitors. Edit freely before the presentation. */
export interface PresetGroup {
  key: string;
  title: string;
  questions: string[];
}

export const PRESET_GROUPS: PresetGroup[] = [
  {
    key: 'market',
    title: '시장이 떨어질 때',
    questions: [
      '주가는 왜 떨어지나요?',
      '오늘 코스피는 왜 움직였나요?',
      '금리가 오르면 주가는 왜 떨어지나요?',
      '환율이 오르면 주식시장은 어떻게 되나요?',
    ],
  },
  {
    key: 'stock',
    title: '내 종목이 떨어질 때',
    questions: [
      '보유 종목이 급락했어요. 무엇부터 확인해야 하나요?',
      '실적이 좋은데도 주가가 떨어지는 이유는?',
      '공매도는 주가를 떨어뜨리나요?',
      '손절과 추가 매수는 어떻게 판단하나요?',
    ],
  },
  {
    key: 'basic',
    title: '알아두면 좋은 개념',
    questions: [
      'PER과 PBR은 무엇인가요?',
      '분산투자는 왜 필요한가요?',
      '증권사 리포트는 어떻게 읽나요?',
      '변동성 지수(VIX)는 무엇인가요?',
    ],
  },
];

/** Shown in the header and spoken greeting. */
export const ORG_NAME = process.env.NEXT_PUBLIC_ORG_NAME || '리서치센터';

export const DISCLAIMER =
  '본 화면은 투자 이해를 돕기 위한 일반 정보이며 특정 종목의 매수·매도 권유가 아닙니다. 투자 판단의 책임은 투자자 본인에게 있습니다.';
