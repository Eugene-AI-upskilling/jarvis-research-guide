'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { STATE_SPEED, type CoreLayerProps } from './utils';

const RADIUS = 1.5;
const N_POINTS = 12;

export function WireSphere({ state, color }: CoreLayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const threeColor = useMemo(() => new THREE.Color(color), [color]);
  const speed = STATE_SPEED[state];

  const dataPoints = useMemo(() => {
    const pts: Array<[number, number, number]> = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N_POINTS; i++) {
      const y = 1 - (i / (N_POINTS - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = goldenAngle * i;
      pts.push([
        Math.cos(theta) * r * RADIUS,
        y * RADIUS,
        Math.sin(theta) * r * RADIUS,
      ]);
    }
    return pts;
  }, []);

  useFrame((_, dt) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y -= dt * 0.08 * speed;
    groupRef.current.rotation.x += dt * 0.025 * speed;
  });

  return (
    <group ref={groupRef}>
      {/* lat/lon wireframe sphere */}
      <mesh>
        <sphereGeometry args={[RADIUS, 18, 12]} />
        <meshBasicMaterial
          color={threeColor}
          wireframe
          transparent
          opacity={0.18}
          toneMapped={false}
        />
      </mesh>

      {/* subtle inner ghost shell */}
      <mesh>
        <icosahedronGeometry args={[RADIUS * 0.98, 1]} />
        <meshBasicMaterial
          color={threeColor}
          wireframe
          transparent
          opacity={0.08}
          toneMapped={false}
        />
      </mesh>

      {/* 12 data points */}
      {dataPoints.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.022, 8, 8]} />
          <meshBasicMaterial
            color={threeColor}
            transparent
            opacity={0.85}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}
