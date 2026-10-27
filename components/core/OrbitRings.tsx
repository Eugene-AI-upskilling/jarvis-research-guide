'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { STATE_SPEED, type CoreLayerProps } from './utils';

const ORBIT_R = 1.25;
const TUBE = 0.007;

export function OrbitRings({ state, color }: CoreLayerProps) {
  const xRef = useRef<THREE.Group>(null);
  const yRef = useRef<THREE.Group>(null);
  const zRef = useRef<THREE.Group>(null);
  const threeColor = useMemo(() => new THREE.Color(color), [color]);
  const speed = STATE_SPEED[state];

  useFrame((_, dt) => {
    if (xRef.current) xRef.current.rotation.x += dt * 0.55 * speed;
    if (yRef.current) yRef.current.rotation.y += dt * 0.42 * speed;
    if (zRef.current) zRef.current.rotation.z += dt * 0.32 * speed;
  });

  return (
    <>
      {/* X-axis ring */}
      <group ref={xRef}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[ORBIT_R, TUBE, 6, 96]} />
          <meshBasicMaterial
            color={threeColor}
            transparent
            opacity={0.5}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[ORBIT_R, 0, 0]}>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshBasicMaterial
            color={threeColor}
            transparent
            opacity={1}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* Y-axis ring */}
      <group ref={yRef}>
        <mesh>
          <torusGeometry args={[ORBIT_R, TUBE, 6, 96]} />
          <meshBasicMaterial
            color={threeColor}
            transparent
            opacity={0.5}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, ORBIT_R, 0]}>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshBasicMaterial
            color={threeColor}
            transparent
            opacity={1}
            toneMapped={false}
          />
        </mesh>
      </group>

      {/* Z-axis ring */}
      <group ref={zRef}>
        <mesh rotation={[0, Math.PI / 2, 0]}>
          <torusGeometry args={[ORBIT_R, TUBE, 6, 96]} />
          <meshBasicMaterial
            color={threeColor}
            transparent
            opacity={0.5}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, 0, ORBIT_R]}>
          <sphereGeometry args={[0.04, 12, 12]} />
          <meshBasicMaterial
            color={threeColor}
            transparent
            opacity={1}
            toneMapped={false}
          />
        </mesh>
      </group>
    </>
  );
}
