'use client';

import { useMemo } from 'react';
import { Vector2 } from 'three';
import {
  EffectComposer,
  Bloom,
  ChromaticAberration,
  Noise,
  Scanline,
} from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import type { JarvisState } from '@/store/jarvis-store';

export function PostFX({ state }: { state: JarvisState }) {
  const isError = state === 'ERROR';
  const isHigh = state === 'LISTENING' || state === 'SPEAKING';

  const caOffset = useMemo(
    () => new Vector2(isError ? 0.0035 : 0.001, isError ? 0.0035 : 0.001),
    [isError],
  );

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        intensity={isError ? 1.6 : isHigh ? 1.25 : 0.95}
        luminanceThreshold={0.18}
        luminanceSmoothing={0.6}
        radius={0.7}
        mipmapBlur
      />
      <ChromaticAberration
        offset={caOffset}
        radialModulation={false}
        modulationOffset={0}
      />
      <Noise
        opacity={0.06}
        premultiply
        blendFunction={BlendFunction.OVERLAY}
      />
      <Scanline
        density={1.6}
        opacity={0.07}
        blendFunction={BlendFunction.OVERLAY}
      />
    </EffectComposer>
  );
}
