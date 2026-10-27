'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { STATE_SPEED, STATE_INTENSITY, type CoreLayerProps } from './utils';

const N = 200;
const BASE_R_MIN = 1.7;
const BASE_R_MAX = 2.2;

export function ParticleAura({ state, color }: CoreLayerProps) {
  const ref = useRef<THREE.Points>(null);
  const threeColor = useMemo(() => new THREE.Color(color), [color]);
  const speed = STATE_SPEED[state];
  const intensity = STATE_INTENSITY[state];

  const { positions, basePositions, seeds } = useMemo(() => {
    const pos = new Float32Array(N * 3);
    const base = new Float32Array(N * 3);
    const seed = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r = BASE_R_MIN + Math.random() * (BASE_R_MAX - BASE_R_MIN);
      const phi = Math.acos(2 * Math.random() - 1);
      const theta = Math.random() * Math.PI * 2;
      const x = Math.sin(phi) * Math.cos(theta) * r;
      const y = Math.sin(phi) * Math.sin(theta) * r;
      const z = Math.cos(phi) * r;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      base[i * 3] = x;
      base[i * 3 + 1] = y;
      base[i * 3 + 2] = z;
      seed[i * 3] = Math.random() * 6.28;
      seed[i * 3 + 1] = 0.6 + Math.random() * 1.4;
      seed[i * 3 + 2] = Math.random() * 6.28;
    }
    return { positions: pos, basePositions: base, seeds: seed };
  }, []);

  useFrame(() => {
    const points = ref.current;
    if (!points) return;
    const attr = points.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const t = performance.now() * 0.001;

    let pull = 0;
    let swirl = 0;
    if (state === 'THINKING') {
      pull = (Math.sin(t * 1.6) + 1) * 0.18; // 0..0.36
      swirl = 0.6;
    } else if (state === 'LISTENING') {
      pull = 0.05;
      swirl = 0.15;
    } else if (state === 'SPEAKING') {
      pull = 0.08 + Math.sin(t * 4) * 0.04;
      swirl = 0.25;
    } else if (state === 'ERROR') {
      pull = -0.1; // push outward
      swirl = 1.2;
    }

    for (let i = 0; i < N; i++) {
      const ix = i * 3;
      const bx = basePositions[ix]!;
      const by = basePositions[ix + 1]!;
      const bz = basePositions[ix + 2]!;
      const phase = seeds[ix]!;
      const freq = seeds[ix + 1]!;
      const phase2 = seeds[ix + 2]!;

      // brownian wobble
      const wobble = Math.sin(t * freq * speed + phase) * 0.06;
      const wobble2 = Math.cos(t * freq * 1.13 * speed + phase2) * 0.06;

      // radial pull factor (pull toward center, or push outward if negative)
      const factor = 1 - pull;

      // swirl in-place (rotate the base point around z by a small angle)
      let cx = bx;
      let cy = by;
      if (swirl !== 0) {
        const a = swirl * Math.sin(t * 0.6 * speed + phase) * 0.3;
        const cs = Math.cos(a);
        const sn = Math.sin(a);
        cx = bx * cs - by * sn;
        cy = bx * sn + by * cs;
      }

      arr[ix] = cx * factor + wobble;
      arr[ix + 1] = cy * factor + wobble2;
      arr[ix + 2] = bz * factor + wobble * 0.5;
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color={threeColor}
        size={0.04}
        sizeAttenuation
        transparent
        opacity={0.55 + intensity * 0.4}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}
