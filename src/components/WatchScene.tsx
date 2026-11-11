import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls } from '@react-three/drei';
import { buildWatch } from '@/lib/watch-model';
import type { WatchTone } from '@/lib/watches';

function Model({ tone, moving, modelScale }: { tone: WatchTone; moving: boolean; modelScale: number }) {
  const model = useMemo(() => buildWatch(tone), [tone]);
  const elapsed = useRef(0);
  useEffect(() => () => model.dispose(), [model]);
  useFrame((_, rawDelta) => {
    if (moving) elapsed.current += Math.min(rawDelta, .05);
    const t = elapsed.current;
    model.hands.forEach((hand, i) => { hand.rotation.z = -([-.88, .9, t * Math.PI / 30][i] ?? 0); });
    model.gears.forEach((gear, i) => { gear.rotation.z = t * .18 * (i % 2 ? -1 : 1); });
  });
  return <primitive object={model.group} rotation={[.1, -.32, -.12]} scale={modelScale} dispose={null} />;
}

export function WatchScene({ tone, moving = true, interactive = false, zoomable = interactive, resetKey = 0, zoom = 1, modelScale = 1 }: {
  tone: WatchTone; moving?: boolean; interactive?: boolean; zoomable?: boolean; resetKey?: number; zoom?: number; modelScale?: number;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const gesture = useRef({ x: 0, y: 0, dragged: false });
  useEffect(() => {
    setMounted(true);
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches); update(); query.addEventListener('change', update);
    const observer = new IntersectionObserver(entries => setVisible(entries.some(e => e.isIntersecting)), { rootMargin: '200px' });
    if (ref.current) observer.observe(ref.current);
    return () => { observer.disconnect(); query.removeEventListener('change', update); };
  }, []);
  return <div ref={ref} className={`watch-scene ${interactive ? 'watch-scene-interactive' : ''}`} aria-label={`${tone} watch 3D visualization`}
    onPointerDownCapture={event => { gesture.current = { x: event.clientX, y: event.clientY, dragged: false }; }}
    onPointerMoveCapture={event => { if (event.buttons && Math.hypot(event.clientX - gesture.current.x, event.clientY - gesture.current.y) > 5) gesture.current.dragged = true; }}
    onClickCapture={event => { if (gesture.current.dragged) { event.preventDefault(); event.stopPropagation(); } }}>
    {mounted && visible && <Canvas onCreated={({ gl }) => { gl.debug.checkShaderErrors = false; }} frameloop={moving && !reducedMotion ? 'always' : 'demand'} dpr={[1, 1.25]} camera={{ position: [0, 0, 8.6], fov: 42 }} gl={{ antialias: true, alpha: true }}>
      <ambientLight intensity={.8} />
      <directionalLight position={[3, 5, 6]} intensity={3} />
      <directionalLight position={[-4, -1, 3]} intensity={1.6} />
      <Environment resolution={128}>
        <Lightformer intensity={4} position={[0, 4, 5]} scale={[6, 3, 1]} />
        <Lightformer intensity={3} position={[-4, 0, 2]} rotation-y={Math.PI / 2} scale={[3, 8, 1]} />
        <Lightformer intensity={2} position={[4, -2, 2]} rotation-y={-Math.PI / 2} scale={[3, 6, 1]} />
      </Environment>
      <group scale={zoom}><Model key={tone} tone={tone} moving={moving && !reducedMotion} modelScale={modelScale} /></group>
      <Controls moving={moving && !reducedMotion} interactive={interactive} zoomable={zoomable} resetKey={resetKey} />
    </Canvas>}
  </div>;
}

function Controls({ moving, interactive, zoomable, resetKey }: { moving: boolean; interactive: boolean; zoomable: boolean; resetKey: number }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const [dragging, setDragging] = useState(false);
  useEffect(() => { controls.current?.reset(); }, [resetKey]);
  return <OrbitControls ref={controls} enablePan={false} enableZoom={zoomable} enableRotate={interactive} enableDamping dampingFactor={.1} autoRotate={moving && !dragging} autoRotateSpeed={.6} minDistance={5} maxDistance={12} target={[0, 0, 0]} onStart={() => setDragging(true)} onEnd={() => setDragging(false)} />;
}
