import type { JarvisState } from '@/store/jarvis-store';

export const STATE_SPEED: Record<JarvisState, number> = {
  BOOTING: 0.6,
  STANDBY: 1,
  LISTENING: 2.2,
  THINKING: 1.6,
  SPEAKING: 1.4,
  ERROR: 3.5,
};

export const STATE_INTENSITY: Record<JarvisState, number> = {
  BOOTING: 0.3,
  STANDBY: 0.55,
  LISTENING: 0.8,
  THINKING: 0.95,
  SPEAKING: 0.85,
  ERROR: 1.0,
};

export interface CoreLayerProps {
  state: JarvisState;
  color: string;
}
