'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { STATE_SPEED, STATE_INTENSITY, type CoreLayerProps } from './utils';

/**
 * Dense star-dust around the core (Insight Lab home Hero only).
 * Two populations: a loose outer shell and an equatorial band that orbits faster.
 * Each mote twinkles on its own phase; the whole field slowly rotates and reacts to state
 * (THINKING spirals inward, SPEAKING breathes outward, LISTENING ripples, ERROR scatters).
 */
const SHELL = 520;
const BAND = 380;
const N = SHELL + BAND;

export function DustField({ state, color }: CoreLayerProps) {
  const ref = useRef<THREE.Points>(null);
  const spin = useRef(0);
  const base = useMemo(() => new THREE.Color(color), [color]);
  const speed = STATE_SPEED[state];
  const intensity = STATE_INTENSITY[state];

  const { positions, colors, home, seeds } = useMemo(() => {
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const h = new Float32Array(N * 3); // shell: r, theta, phi · band: r, angle, height
    const s = new Float32Array(N * 3); // twinkle phase, twinkle freq, drift
    for (let i = 0; i < N; i++) {
      const ix = i * 3;
      if (i < SHELL) {
        h[ix] = 1.85 + Math.random() * 0.75;
        h[ix + 1] = Math.random() * Math.PI * 2;
        h[ix + 2] = Math.acos(2 * Math.random() - 1);
      } else {
        h[ix] = 1.75 + Math.pow(Math.random(), 1.6) * 0.8;
        h[ix + 1] = Math.random() * Math.PI * 2;
        h[ix + 2] = (Math.random() - 0.5) * 0.18;
      }
      s[ix] = Math.random() * Math.PI * 2;
      s[ix + 1] = 0.6 + Math.random() * 2.2;
      s[ix + 2] = 0.4 + Math.random() * 0.9;
    }
    return { positions: pos, colors: col, home: h, seeds: s };
  }, []);

  useFrame((_, dt) => {
    const points = ref.current;
    if (!points) return;
    const t = performance.now() * 0.001;
    spin.current += dt * 0.08 * speed;
    const p = points.geometry.attributes.position as THREE.BufferAttribute;
    const c = points.geometry.attributes.color as THREE.BufferAttribute;
    const pa = p.array as Float32Array;
    const ca = c.array as Float32Array;

    let radial = 1;
    if (state === 'THINKING') radial = 0.9 + Math.sin(t * 2.2) * 0.05;
    else if (state === 'SPEAKING') radial = 1.04 + Math.sin(t * 3.2) * 0.04;
    else if (state === 'ERROR') radial = 1.12;

    for (let i = 0; i < N; i++) {
      const ix = i * 3;
      const r0 = home[ix]!;
      const a0 = home[ix + 1]!;
      const b0 = home[ix + 2]!;
      const ph = seeds[ix]!;
      const fq = seeds[ix + 1]!;
      const dr = seeds[ix + 2]!;
      let r = r0 * radial;
      if (state === 'LISTENING') r += Math.sin(t * 5 - r0 * 6) * 0.05; // ripple travelling outward
      let x: number, y: number, z: number;
      if (i < SHELL) {
        const th = a0 + spin.current * dr + Math.sin(t * 0.3 + ph) * 0.05;
        x = Math.sin(b0) * Math.cos(th) * r;
        y = Math.cos(b0) * r + Math.sin(t * 0.5 * dr + ph) * 0.04;
        z = Math.sin(b0) * Math.sin(th) * r;
      } else {
        const ang = a0 + spin.current * (2.4 + dr) * (state === 'THINKING' ? 1.8 : 1);
        x = Math.cos(ang) * r;
        z = Math.sin(ang) * r;
        y = b0 + Math.sin(ang * 3 + ph) * 0.03;
        // tilt the band a little so it reads as an orbit, not a line
        const tilt = 0.32;
        const yy = y * Math.cos(tilt) - z * Math.sin(tilt);
        z = y * Math.sin(tilt) + z * Math.cos(tilt);
        y = yy;
      }
      pa[ix] = x;
      pa[ix + 1] = y;
      pa[ix + 2] = z;
      const tw = 0.25 + 0.75 * Math.pow(Math.abs(Math.sin(t * fq * (0.6 + speed * 0.4) + ph)), 3);
      const k = tw * (0.55 + intensity * 0.6);
      ca[ix] = base.r * k;
      ca[ix + 1] = base.g * k;
      ca[ix + 2] = base.b * k;
    }
    p.needsUpdate = true;
    c.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        vertexColors
        size={0.035}
        sizeAttenuation
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}
