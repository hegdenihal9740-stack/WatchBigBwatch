import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { Suspense, useRef } from 'react';
import * as THREE from 'three';
import type { Finish } from './SkeletonWatch';
import { ARM_Z, PhotoWatch } from './PhotoWatch';
import type { WristPose } from '@/lib/wrist-pose';

export type TrackingTarget = { pose: WristPose | null; lastSeen: number };
export type AmbientSample = { r: number; g: number; b: number };

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

type SceneProps = { finish: Finish; target: React.RefObject<TrackingTarget>; ambient: React.RefObject<AmbientSample>; caseMm?: number };

function Rig({ finish, target, ambient, caseMm = 42 }: SceneProps) {
  const { size } = useThree();
  const root = useRef<THREE.Group>(null);
  const rz = useRef<THREE.Group>(null);
  const ry = useRef<THREE.Group>(null);
  const rx = useRef<THREE.Group>(null);
  const hemi = useRef<THREE.HemisphereLight>(null);
  const glint = useRef<THREE.PointLight>(null);
  const snap = useRef(0);
  const occlude = useRef(false);
  const back = useRef(false);
  const flipTimer = useRef(0);
  const last = useRef<WristPose | null>(null);
  const tint = useRef(new THREE.Color(1, 1, 1));

  useFrame(({ clock }, raw) => {
    const dt = Math.min(raw, .05);
    const t = clock.elapsedTime;
    const T = target.current;
    const live = !!T.pose && performance.now() - T.lastSeen < 650;
    if (T.pose) last.current = T.pose;
    snap.current += ((live ? 1 : 0) - snap.current) * (1 - Math.exp(-(live ? 7 : 2.5) * dt));
    const e = snap.current * snap.current * (3 - 2 * snap.current);
    occlude.current = e > .55;

    const w = size.width, h = size.height;
    const idleScale = Math.min(w, h) * .5 / 50;
    const idle = { x: 0, y: h * .12 + Math.sin(t * 1.3) * h * .012, s: idleScale, z: Math.sin(t * .45) * .03, y2: Math.sin(t * .6) * .1, x2: Math.sin(t * .8) * .04 };
    const p = last.current;
      // Decide palm vs back from the 3D palm normal (ML landmarks + handedness), debounced ~0.15 s.
    if (p?.palmFacing !== undefined && live) {
      if (p.palmFacing !== back.current) { flipTimer.current += dt; if (flipTimer.current > .15) { back.current = p.palmFacing; flipTimer.current = 0; } }
      else flipTimer.current = 0;
    }
    // 2D plane + full 360 deg roll around the arm: no pitch tilt, twist follows the hand all the way round.
    let twist = p ? wrapAngle(p.twist) : 0;
    // Keep the roll consistent with the palm/back decision so the right side always shows.
    if (p?.palmFacing !== undefined && live) {
      const showsBack = Math.cos(twist) < 0;
      if (showsBack !== back.current) twist = wrapAngle(twist + Math.PI);
    }
    const tr = p ? { x: p.x - w / 2, y: h / 2 - p.y, s: p.scale, z: wrapAngle(-p.roll), y2: 0, x2: twist } : idle;
    const dz = wrapAngle(tr.z - idle.z);
    const dx2 = wrapAngle(tr.x2 - idle.x2);
    // The strap always fits the measured wrist; case size only scales the dial (inside PhotoWatch).
    if (root.current) { root.current.position.set(idle.x + (tr.x - idle.x) * e, idle.y + (tr.y - idle.y) * e, 0); root.current.scale.setScalar(idle.s + (tr.s - idle.s) * e); }
    if (rz.current) rz.current.rotation.z = idle.z + dz * e;
    if (ry.current) ry.current.rotation.y = idle.y2 + (tr.y2 - idle.y2) * e;
    if (rx.current) {
      // Smooth the roll along the shortest path so turning never jumps.
      const target = idle.x2 + dx2 * e;
      const cur = rx.current.rotation.x;
      rx.current.rotation.x = cur + wrapAngle(target - cur) * (1 - Math.exp(-14 * dt));
    }
    if (e < .5) back.current = false;
    else if (p?.palmFacing === undefined) { const facing = Math.cos(rx.current?.rotation.x ?? 0); back.current = back.current ? facing < .3 : facing < -.3; }

    const a = ambient.current;
    tint.current.setRGB(Math.min(1, .15 + .85 * a.r), Math.min(1, .15 + .85 * a.g), Math.min(1, .15 + .85 * a.b));
    if (hemi.current) hemi.current.color.lerp(new THREE.Color(a.r, a.g, a.b), 1 - Math.exp(-2 * dt));
    if (glint.current) glint.current.position.set(Math.sin(t * .7) * w * .4, h * .35, 600 + Math.cos(t * .5) * 200);
  });

  return <>
    <hemisphereLight ref={hemi} intensity={1.3} groundColor="#2a2622" />
    <directionalLight position={[-400, 600, 800]} intensity={2.2} />
    <pointLight ref={glint} intensity={3} distance={0} decay={0} color="#fff6e8" />
    {/* Pitch pivots at the case on the skin (no sliding along the arm); twist pivots on the forearm axis. */}
    <group ref={root}><group ref={rz}><group ref={ry}><group position={[0, 0, ARM_Z]}><group ref={rx}>
      <group position={[0, 0, -ARM_Z]}>
        <PhotoWatch finish={finish} occlude={occlude} tint={tint} back={back} caseScale={caseMm / 42} />
      </group>
    </group></group></group></group></group>
  </>;
}

export function TryOnScene(props: SceneProps) {
  return <Canvas className="try-on-canvas" onCreated={({ gl }) => { gl.debug.checkShaderErrors = false; }} orthographic dpr={[1, 1.5]} camera={{ position: [0, 0, 3000], near: 1, far: 6000, zoom: 1 }} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping }}>
    <Suspense fallback={null}>
      <Environment resolution={256}>
        <Lightformer intensity={4} position={[0, 5, 2]} scale={[10, 3, 1]} />
        <Lightformer intensity={1.6} color="#ffffff" position={[-6, 1, 1]} rotation-y={Math.PI / 2} scale={[14, 1.2, 1]} />
        <Lightformer intensity={1.4} color="#f2f5ff" position={[6, 0, 0]} rotation-y={-Math.PI / 2} scale={[14, 1.2, 1]} />
        <Lightformer form="ring" intensity={2.4} position={[2, 2, 6]} scale={2.5} />
        <Lightformer intensity={.5} position={[0, -5, 0]} rotation-x={-Math.PI / 2} scale={[10, 10, 1]} color="#5a4a3a" />
      </Environment>
      <Rig {...props} />
    </Suspense>
  </Canvas>;
}
