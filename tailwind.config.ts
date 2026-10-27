import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        holo: {
          primary: '#00D4FF',
          bright: '#66E5FF',
          deep: '#0088CC',
          gold: '#F5C518',
          red: '#FF3B3B',
          bg: '#000814',
          'bg-alt': '#001428',
          text: '#E0F7FF',
          'text-dim': '#6FB3D2',
        },
      },
      fontFamily: {
        display: ['var(--font-orbitron)', 'system-ui', 'sans-serif'],
        body: ['var(--font-rajdhani)', 'Pretendard', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
        kr: ['Pretendard', 'system-ui', 'sans-serif'],
      },
      letterSpacing: {
        holo: '0.05em',
        'holo-wide': '0.18em',
        'holo-wider': '0.32em',
      },
    },
  },
  plugins: [],
};

export default config;
