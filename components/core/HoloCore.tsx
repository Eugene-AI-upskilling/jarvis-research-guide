'use client';

import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { ArcReactor } from './ArcReactor';
import { WireSphere } from './WireSphere';
import { OrbitRings } from './OrbitRings';
import { ParticleAura } from './ParticleAura';
import { DustField } from './DustField';
import { PostFX } from './PostFX';
import type { JarvisState } from '@/store/jarvis-store';

interface HoloCoreProps {
  color: string;
  state: JarvisState;
  /** Home Hero: pull the camera back for room and add the dense dust field. */
  rich?: boolean;
}

export function HoloCore({ color, state, rich = false }: HoloCoreProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, rich ? 6.4 : 4.4], fov: 45, near: 0.01, far: 50 }}
      gl={{
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
        stencil: false,
        depth: true,
      }}
      dpr={[1, 2]}
      style={{
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        background: 'transparent',
      }}
    >
      <ambientLight intensity={0.18} />
      <pointLight position={[0, 0, 0]} intensity={2.2} color={color} />
      <Suspense fallback={null}>
        <ArcReactor state={state} color={color} />
        <WireSphere state={state} color={color} />
        <OrbitRings state={state} color={color} />
        <ParticleAura state={state} color={color} />
        {rich && <DustField state={state} color={color} />}
        <PostFX state={state} />
      </Suspense>
    </Canvas>
  );
}
