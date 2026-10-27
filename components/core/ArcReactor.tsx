'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { STATE_SPEED, STATE_INTENSITY, type CoreLayerProps } from './utils';

export function ArcReactor({ state, color }: CoreLayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const ringsRef = useRef<Array<THREE.Mesh | null>>([]);
  const centerRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const segGroupRef = useRef<THREE.Group>(null);

  const threeColor = useMemo(() => new THREE.Color(color), [color]);
  const speed = STATE_SPEED[state];
  const intensity = STATE_INTENSITY[state];

  const ringDefs = useMemo(
    () => [
      { r: 0.55, tube: 0.006, opacity: 0.45, dir: 1, factor: 1.0 },
      { r: 0.66, tube: 0.005, opacity: 0.35, dir: -1, factor: 1.4 },
      { r: 0.78, tube: 0.007, opacity: 0.55, dir: 1, factor: 0.8 },
      { r: 0.88, tube: 0.005, opacity: 0.4, dir: -1, factor: 1.2 },
      { r: 0.96, tube: 0.008, opacity: 0.6, dir: 1, factor: 0.6 },
    ],
    [],
  );

  const segMarkers = useMemo(() => {
    const out: Array<[number, number, number]> = [];
    const n = 16;
    const r = 0.4;
    for (let i = 0; i < n; i++) {
      const theta = (i / n) * Math.PI * 2;
      out.push([Math.cos(theta) * r, Math.sin(theta) * r, 0]);
    }
    return out;
  }, []);

  useFrame((_, dt) => {
    if (groupRef.current) {
      groupRef.current.rotation.z += dt * 0.12 * speed;
    }
    ringsRef.current.forEach((mesh, i) => {
      if (!mesh) return;
      const def = ringDefs[i]!;
      mesh.rotation.z += dt * 0.25 * def.factor * def.dir * speed;
    });
    if (segGroupRef.current) {
      segGroupRef.current.rotation.z -= dt * 0.45 * speed;
    }
    if (centerRef.current) {
      const t = performance.now() * 0.001;
      const wave = 0.92 + Math.sin(t * 3.4 * speed) * 0.08;
      const mat = centerRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = wave;
      const s = 0.9 + intensity * 0.3 + wave * 0.08;
      centerRef.current.scale.setScalar(s);
    }
    if (haloRef.current) {
      const t = performance.now() * 0.001;
      const breath = 0.85 + Math.sin(t * 1.6 * speed) * 0.15;
      haloRef.current.scale.setScalar(1 + intensity * 0.15);
      const mat = haloRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.18 * intensity * breath;
    }
  });

  return (
    <group ref={groupRef}>
      {/* outer prominent ring */}
      <mesh>
        <torusGeometry args={[1.0, 0.022, 16, 200]} />
        <meshBasicMaterial
          color={threeColor}
          transparent
          opacity={0.85}
          toneMapped={false}
        />
      </mesh>

      {/* concentric rings */}
      {ringDefs.map((def, i) => (
        <mesh
          key={i}
          ref={(el) => {
            ringsRef.current[i] = el;
          }}
        >
          <torusGeometry args={[def.r, def.tube, 8, 128]} />
          <meshBasicMaterial
            color={threeColor}
            transparent
            opacity={def.opacity}
            toneMapped={false}
          />
        </mesh>
      ))}

      {/* 16 segment markers */}
      <group ref={segGroupRef}>
        {segMarkers.map((p, i) => (
          <mesh key={i} position={p} rotation={[0, 0, (i / 16) * Math.PI * 2]}>
            <boxGeometry args={[0.02, 0.06, 0.005]} />
            <meshBasicMaterial
              color={threeColor}
              transparent
              opacity={0.7}
              toneMapped={false}
            />
          </mesh>
        ))}
      </group>

      {/* center bright source */}
      <mesh ref={centerRef}>
        <icosahedronGeometry args={[0.13, 2]} />
        <meshBasicMaterial
          color={threeColor}
          transparent
          opacity={0.95}
          toneMapped={false}
        />
      </mesh>

      {/* additive inner halo */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[0.22, 24, 24]} />
        <meshBasicMaterial
          color={threeColor}
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
