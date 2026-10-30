import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { MidnightBackdrop } from "@/components/MidnightBackdrop";
import type { WatchTone } from "@/lib/watches";
import watchGold from "@/assets/watch-gold.webp";
import watchSteel from "@/assets/watch-steel.webp";
import watchRosegold from "@/assets/watch-rosegold.webp";
import watchBlack from "@/assets/watch-black.webp";
import tryonArm from "@/assets/tryon-arm.jpg";
import { tryOnImages } from "@/lib/try-on-images";
import { watches as watchList } from "@/lib/watches";
import { SiteFooter } from "@/components/SiteFooter";
import bigBLogoDark from "@/assets/big-b-logo-dark.png";

const VirtualTryOn = lazy(() =>
  import("@/components/VirtualTryOn").then((module) => ({ default: module.VirtualTryOn })),
);

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BIG-B — The Watch Collection" },
      {
        name: "description",
        content:
          "A black-and-gold scroll experience where a private jet flies through a collection of precision watches.",
      },
      { property: "og:title", content: "BIG-B — The Watch Collection" },
      {
        property: "og:description",
        content:
          "A black-and-gold scroll experience where a private jet flies through a collection of precision watches.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [tryOnTone, setTryOnTone] = useState<WatchTone | null>(null);
  const tryOnWatch = watchList.find(w => w.id === tryOnTone);

  useEffect(() => {
    const KEY = 'home-scroll-y';
    const saved = Number(sessionStorage.getItem(KEY) || 0);
    const timers: number[] = [];
    if (saved > 0) {
      // Restore after GSAP pins/ScrollTriggers have built the page height.
      [60, 200, 500, 900, 1400].forEach(ms => timers.push(window.setTimeout(() => window.scrollTo({ top: saved, behavior: 'auto' }), ms)));
    }
    // Freeze the saved spot once the user heads to a watch page, so the
    // route change's own scroll-to-top can't overwrite it.
    let leaving = false;
    let lastY = saved;
    const save = () => {
      if (leaving) return;
      // While a dialog locks scroll the page may report 0; keep last real value.
      if (document.body.hasAttribute('data-scroll-locked')) return;
      lastY = window.scrollY;
      sessionStorage.setItem(KEY, String(lastY));
    };
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href*="/watches/"]');
      if (a) { leaving = true; sessionStorage.setItem(KEY, String(lastY)); }
    };
    window.addEventListener('scroll', save, { passive: true });
    document.addEventListener('click', onClick, true);
    return () => { leaving = true; window.removeEventListener('scroll', save); document.removeEventListener('click', onClick, true); timers.forEach(clearTimeout); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let sceneStarted = false;
    const cleanups: Array<() => void> = [];

    const loadScene = async () => {
      const [THREE, { RoomEnvironment }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/environments/RoomEnvironment.js"),
      ]);
      if (disposed) return;
      const watches = Array.from(rootRef.current?.querySelectorAll<HTMLImageElement>(".watch-img") ?? []);
      cleanups.push(() => watches.forEach(watch => watch.style.removeProperty("--watch-proximity")));
      const root = rootRef.current;
      const TONES: Record<string, number> = { steel: 0xb9c6cf, black: 0x3a3f46, gold: 0xd9b45a, rosegold: 0xe0a48e };
      const basePaint = new THREE.Color(0x181a20);
      const toneColor = new THREE.Color();
      let tintMaterial: any = null;
      let activeTone = "";

      // Keep the jet's on-screen size constant: it must never look bigger later
      // in the scroll than at the start, so scale is pulled back as it nears the camera.
      const JET_SCALE = 2.2;
      const JET_REF_DISTANCE = 181;

      class Scene {
        views: Array<{ bottom: number; height: number; camera: any }>;
        renderer: any;
        scene: any;
        light: any;
        softLight: any;
        modelGroup: any;
        w = 0;
        h = 0;
        aircraftSamples: Array<InstanceType<typeof THREE.Vector3>> = [];
        projectedSample = new THREE.Vector3();

        constructor(model: any) {
          model.updateWorldMatrix(true, true);
          const bounds = new THREE.Box3().setFromObject(model);
          // Sample the fuselage from tail to nose, in the animated group's local space.
          for (let i = 0; i <= 12; i++) {
            this.aircraftSamples.push(new THREE.Vector3(0, 0, THREE.MathUtils.lerp(bounds.min.z, bounds.max.z, i / 12)));
          }
          this.views = [
            { bottom: 0, height: 1, camera: null },
            { bottom: 0, height: 0, camera: null },
          ];

          this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
          this.renderer.debug.checkShaderErrors = false;
          this.renderer.setSize(window.innerWidth, window.innerHeight);
          this.renderer.setPixelRatio(
            Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1.5 : 1.75),
          );
          this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
           this.renderer.toneMappingExposure = 1.35;
          document.body.appendChild(this.renderer.domElement);

          this.scene = new THREE.Scene();

          // Image-based lighting for realistic metal/paint reflections.
          const pmrem = new THREE.PMREMGenerator(this.renderer);
          const envScene = new RoomEnvironment();
          this.scene.environment = pmrem.fromScene(envScene, 0.04).texture;
          pmrem.dispose();

          for (let ii = 0; ii < this.views.length; ++ii) {
            const view = this.views[ii];
            if (!view) continue;
            const camera = new THREE.PerspectiveCamera(
              45,
              window.innerWidth / window.innerHeight,
              1,
              2000,
            );
            camera.position.fromArray([0, 0, 180]);
            camera.layers.disableAll();
            camera.layers.enable(ii);
            view.camera = camera;
            camera.lookAt(new THREE.Vector3(0, 5, 0));
          }

          this.light = new THREE.PointLight(0xffffff, 2);
          this.light.position.z = 150;
          this.light.position.x = 70;
          this.light.position.y = -20;
          this.scene.add(this.light);

           this.softLight = new THREE.AmbientLight(0xffffff, 0.65);
          this.scene.add(this.softLight);
           const fill = new THREE.DirectionalLight(0xdceafb, 2.7);
          fill.position.set(-60, 80, 40);
          this.scene.add(fill);
           const rim = new THREE.DirectionalLight(0xffebd1, 2);
          rim.position.set(30, 20, -90);
          this.scene.add(rim);
           const sideFill = new THREE.DirectionalLight(0xffffff, 1.4);
           sideFill.position.set(70, 30, 50);
           this.scene.add(sideFill);

          this.onResize();
          window.addEventListener("resize", this.onResize, false);

          cleanups.push(() => {
            window.removeEventListener("resize", this.onResize);
            this.renderer.domElement.remove();
            this.renderer.dispose();
          });

          this.modelGroup = model;
          this.scene.add(this.modelGroup);
        }

        render = () => {
          // Keep the jet's apparent size constant: pull the model back down as it
          // nears the camera so it never looks larger than it did at the start.
          const anchor = this.views[0]?.camera;
          if (anchor && this.modelGroup) {
            const distance = Math.max(60, anchor.position.distanceTo(this.modelGroup.position));
            const keepSize = THREE.MathUtils.clamp(distance / JET_REF_DISTANCE, 0.2, 1.35);
            this.modelGroup.scale.setScalar(JET_SCALE * keepSize);
          }
          for (let ii = 0; ii < this.views.length; ++ii) {
            const view = this.views[ii];
            if (!view) continue;
            const camera = view.camera;
            const bottom = Math.floor(this.h * view.bottom);
            const height = Math.floor(this.h * view.height);
            if (height <= 0) continue;

            this.renderer.setViewport(0, 0, this.w, this.h);
            this.renderer.setScissor(0, bottom, this.w, height);
            this.renderer.setScissorTest(true);

            camera.aspect = this.w / this.h;
            camera.updateProjectionMatrix();
            this.renderer.render(this.scene, camera);
          }
          const camera = this.views[0]?.camera;
          if (!camera || !this.modelGroup) return;
          this.modelGroup.updateWorldMatrix(true, false);
          const reach = Math.max(150, Math.min(this.w, this.h) * 0.28);
          const aircraftPixels = this.aircraftSamples.map(sample => {
            this.projectedSample.copy(sample).applyMatrix4(this.modelGroup.matrixWorld).project(camera);
            return {
              x: (this.projectedSample.x + 1) * this.w / 2,
              y: (1 - this.projectedSample.y) * this.h / 2,
              visible: this.projectedSample.z >= -1 && this.projectedSample.z <= 1,
            };
          });
          watches.forEach(watch => {
            const rect = watch.getBoundingClientRect();
            let distance = Infinity;
            if (rect.bottom > 0 && rect.top < this.h) {
              for (const point of aircraftPixels) {
                if (!point.visible || point.x < -reach || point.x > this.w + reach || point.y < -reach || point.y > this.h + reach) continue;
                const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
                const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
                distance = Math.min(distance, Math.hypot(dx, dy));
              }
            }
            const proximity = 1 - THREE.MathUtils.smoothstep(distance, 0, reach);
            watch.style.setProperty("--watch-proximity", proximity.toFixed(3));
            (watch as any)._prox = proximity;
          });
          // Spotlight + color sync: find the watch the jet is passing.
          let best: HTMLImageElement | null = null;
          let bestProx = 0;
          for (const watch of watches) {
            const p = (watch as any)._prox ?? 0;
            if (p > bestProx) { bestProx = p; best = watch; }
          }
          for (const watch of watches) {
            const own = (watch as any)._prox ?? 0;
            watch.style.setProperty("--watch-dim", (bestProx * (1 - own)).toFixed(3));
          }
          const nose = aircraftPixels[aircraftPixels.length - 1];
          if (root) {
            root.style.setProperty("--beam-strength", bestProx.toFixed(3));
            if (nose) {
              root.style.setProperty("--beam-x", `${nose.x.toFixed(0)}px`);
              root.style.setProperty("--beam-y", `${nose.y.toFixed(0)}px`);
            }
            if (best) {
              const r = best.getBoundingClientRect();
              root.style.setProperty("--spot-x", `${(r.left + r.width / 2).toFixed(0)}px`);
              root.style.setProperty("--spot-y", `${(r.top + r.height / 2).toFixed(0)}px`);
              const tone = best.dataset['tone'] ?? "";
              if (bestProx > 0.15 && tone !== activeTone) {
                activeTone = tone;
                root.dataset['tone'] = tone;
              }
            }
          }
          if (tintMaterial) {
            toneColor.set(TONES[activeTone] ?? 0xf0f3f3);
            const target = basePaint.clone().lerp(toneColor, bestProx * 0.3);
            tintMaterial.color.lerp(target, 0.08);
          }
        };

        onResize = () => {
          this.w = window.innerWidth;
          this.h = window.innerHeight;
          const aspect = this.w / this.h;
          for (let ii = 0; ii < this.views.length; ++ii) {
            const camera = this.views[ii]?.camera;
            if (!camera) continue;
            camera.aspect = aspect;
            // Pull the camera back on narrow (portrait) screens so the jet's
            // sideways flight path stays inside the visible frame.
            camera.position.z = 180 * Math.max(1, Math.min(1.7, 1.15 / Math.max(aspect, 0.4)));
            camera.updateProjectionMatrix();
          }
          this.renderer.setSize(this.w, this.h);
          this.render();
        };
      }

      async function setupAnimation(scene: any) {
        if (disposed) return;
        const { gsap } = await import("gsap");
        if (disposed) return;
        const plane = scene.modelGroup;
        const jetCanvas = scene.renderer.domElement;
        let timeline: ReturnType<typeof gsap.timeline>;

        const ctx = gsap.context(() => {
           gsap.to(".loading", { autoAlpha: 0, duration: 0.4 });

          const tau = Math.PI * 2;
          // On narrow screens the camera sees a thinner slice of the scene, so
          // shrink the jet's sideways travel to keep it inside the frame.
          const pathScale = () =>
            Math.min(1, Math.max(0.35, (window.innerWidth / window.innerHeight) / 1.3));
          gsap.set(plane.rotation, { y: tau * -0.25 });
            gsap.set(plane.position, { x: 18 * pathScale(), y: -8, z: 0 });
          scene.render();

          const sectionDuration = 1;


          // The jet keeps flying right up to the "See it on your wrist." heading,
          // then fades out. A plain toggle (not a scrubbed tween) so a fast flick
          // can't leave it showing over the try-on copy.
          timeline = gsap.timeline({
            onUpdate: scene.render,
            paused: true,
            defaults: { duration: sectionDuration, ease: "power2.inOut" },
          });

          let delay = 0;
          timeline.to(".scroll-cta", { duration: 0.25, opacity: 0 }, delay);
           timeline.to(plane.position, { x: () => -10 * pathScale(), ease: "power1.in" }, delay);

          delay += sectionDuration;
          timeline.to(plane.rotation, { x: tau * 0.25, y: 0, z: -tau * 0.05, ease: "power1.inOut" }, delay);
          timeline.to(plane.position, { x: () => -40 * pathScale(), y: 0, z: -60, ease: "power1.inOut" }, delay);

          delay += sectionDuration;
          timeline.to(plane.rotation, { x: tau * 0.25, y: 0, z: tau * 0.05, ease: "power3.inOut" }, delay);
          timeline.to(plane.position, { x: () => 40 * pathScale(), y: 0, z: -60, ease: "power2.inOut" }, delay);

          delay += sectionDuration;
          timeline.to(plane.rotation, { x: tau * 0.2, y: 0, z: -tau * 0.1, ease: "power3.inOut" }, delay);
          timeline.to(plane.position, { x: () => -40 * pathScale(), y: 0, z: -30, ease: "power2.inOut" }, delay);

          delay += sectionDuration;
          timeline.to(plane.rotation, { x: 0, z: 0, y: tau * 0.25 }, delay);
          timeline.to(plane.position, { x: 0, y: -10, z: 50 }, delay);

          delay += sectionDuration * 2;
          timeline.to(plane.rotation, { x: tau * 0.25, y: tau * 0.5, z: 0, ease: "power4.inOut" }, delay);
          timeline.to(plane.position, { z: 30, ease: "power4.inOut" }, delay);

          delay += sectionDuration;
          timeline.to(plane.rotation, { x: tau * 0.25, y: tau * 0.5, z: 0, ease: "power4.inOut" }, delay);
          timeline.to(plane.position, { z: 60, x: () => 30 * pathScale(), ease: "power4.inOut" }, delay);

          delay += sectionDuration;
          timeline.to(
            plane.rotation,
            { x: tau * 0.35, y: tau * 0.75, z: tau * 0.6, ease: "power4.inOut" },
            delay,
          );
          timeline.to(plane.position, { z: 35, x: () => 20 * pathScale(), y: 0, ease: "power4.inOut" }, delay);

          delay += sectionDuration;
          timeline.to(plane.rotation, { x: tau * 0.15, y: tau * 0.85, z: 0, ease: "power1.in" }, delay);
          timeline.to(plane.position, { z: -150, x: 0, y: 0, ease: "power1.inOut" }, delay);

          delay += sectionDuration;
          timeline.to(
            plane.rotation,
            { duration: sectionDuration, x: -tau * 0.05, y: tau, z: -tau * 0.1, ease: "none" },
            delay,
          );
          timeline.to(
            plane.position,
            { duration: sectionDuration, x: 0, y: 30, z: 320, ease: "power1.in" },
            delay,
          );
          timeline.to(scene.light.position, { duration: sectionDuration, x: 0, y: 0, z: 0 }, delay);
        });

        const content = root?.querySelector(".content");
        const showcase = root?.querySelector(".tryon-showcase");
        const title = root?.querySelector("#tryon-title");
        let frame = 0;
        let jetHidden = false;
        const updateFromScroll = () => {
          frame = 0;
          if (!content || !showcase || !title) return;
          const start = content.getBoundingClientRect().top + window.scrollY;
          const end = showcase.getBoundingClientRect().top + window.scrollY;
          const progress = THREE.MathUtils.clamp(
            (window.scrollY - start) / Math.max(1, end - start),
            0,
            1,
          );
          timeline.progress(progress);

          const shouldHideJet = title.getBoundingClientRect().top <= window.innerHeight * 0.72;
          if (shouldHideJet !== jetHidden) {
            jetHidden = shouldHideJet;
            gsap.to(jetCanvas, {
              autoAlpha: jetHidden ? 0 : 1,
              duration: 0.4,
              overwrite: "auto",
            });
          }
        };
        const scheduleUpdate = () => {
          if (!frame) frame = window.requestAnimationFrame(updateFromScroll);
        };
        window.addEventListener("scroll", scheduleUpdate, { passive: true });
        window.addEventListener("resize", scheduleUpdate);
        cleanups.push(() => {
          window.removeEventListener("scroll", scheduleUpdate);
          window.removeEventListener("resize", scheduleUpdate);
          if (frame) window.cancelAnimationFrame(frame);
          ctx.revert();
        });
        scheduleUpdate();
      }


      // Obsidian-black stealth paint with warm gold trim to match the site theme.
      const paint = new THREE.MeshPhysicalMaterial({ color: 0x14151a, metalness: 0.62, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.06, side: THREE.DoubleSide });
      tintMaterial = paint;
      const carbon = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0c, metalness: 0.6, roughness: 0.18, clearcoat: 1, side: THREE.DoubleSide });
      const champagne = new THREE.MeshPhysicalMaterial({ color: 0xd9b36c, metalness: 0.95, roughness: 0.16, side: THREE.DoubleSide });
      const glass = new THREE.MeshPhysicalMaterial({ color: 0x151b1d, metalness: 0.22, roughness: 0.08, clearcoat: 1, side: THREE.DoubleSide });
      const intake = new THREE.MeshStandardMaterial({ color: 0x090a0a, metalness: 0.85, roughness: 0.28, side: THREE.DoubleSide });
      const jet = new THREE.Group();
      const add = (geometry: any, material: any, position: [number, number, number], rotation: [number, number, number] = [0, 0, 0]) => {
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...position);
        mesh.rotation.set(...rotation);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        jet.add(mesh);
        return mesh;
      };
      // Stealth-style obsidian bizjet: dagger fuselage, swept wings, canted twin V-tails.
      const profile = [
        [0.03, -8.8], [0.34, -8.35], [0.62, -7.5], [0.86, -6.2], [1.0, -4.4],
        [1.06, -1.5], [1.06, 2.6], [0.98, 4.6], [0.8, 6.1], [0.52, 7.3], [0.22, 8.1], [0.02, 8.55],
      ].map(([radius, z]) => new THREE.Vector2(radius ?? 0, z ?? 0));
      const fuselage = new THREE.LatheGeometry(profile, 64);
      fuselage.rotateX(Math.PI / 2);
      fuselage.scale(1, .82, 1);
      add(fuselage, paint, [0, 0, 0]);
      const surface = (vertices: number[]) => {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
        geometry.computeVertexNormals();
        return geometry;
      };
      // Solid wings with real thickness, dihedral and a smooth belly fairing.
      const planform = (points: [number, number][], thickness: number) => {
        const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: .04, bevelSize: .06, bevelSegments: 2, steps: 1 });
        geometry.rotateX(Math.PI / 2);
        geometry.translate(0, thickness / 2, 0);
        return geometry;
      };
      const wingGeo = planform([[0, 2.4], [7.4, -3.6], [6.9, -4.6], [0, -2.4]], .14);
      add(wingGeo, paint, [0, 0, 0], [0, 0, .04]);
      const wingLeft = add(wingGeo, paint, [0, 0, 0], [0, 0, .04]);
      wingLeft.scale.x = -1;
      const fairing = add(new THREE.SphereGeometry(1, 24, 16), paint, [0, -.32, -.4]);
      fairing.scale.set(1.12, .5, 3.4);
      // Upturned champagne winglets at both tips.
      add(surface([
        -7.4, .22, -3.6, -7.55, 1.5, -4.4, -6.95, 1.5, -5.2,
        -7.4, .22, -3.6, -6.95, 1.5, -5.2, -6.8, .22, -4.4,
        7.4, .22, -3.6, 6.8, .22, -4.4, 6.95, 1.5, -5.2,
        7.4, .22, -3.6, 6.95, 1.5, -5.2, 7.55, 1.5, -4.4,
      ]), champagne, [0, 0, 0]);
      // Wingtip navigation lights: red port, green starboard.
      for (const [side, color] of [[-1, 0xff2a2a], [1, 0x2aff5a]] as const) {
        add(new THREE.SphereGeometry(.07, 10, 8), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2, roughness: .4 }), [side * 7.25, .45, -3.95]);
      }
      // Twin canted V-tail fins — stealth profile instead of a single T-tail.
      const finGeo = planform([[.35, -6.7], [3.2, -8.3], [3.05, -8.8], [.35, -8.1]], .1);
      finGeo.rotateZ(Math.PI / 2);
      for (const side of [-1, 1]) {
        add(finGeo, carbon, [side * .5, .3, 0], [0, 0, -side * .48]);
        add(new THREE.BoxGeometry(.12, .16, .62), champagne, [side * 1.9, 3.0, -8.4], [0, 0, -side * .48]);
      }
      // Beacon on the spine and a pitot probe on the nose.
      add(new THREE.SphereGeometry(.05, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 2, roughness: .4 }), [0, .85, -1.2]);
      add(new THREE.CylinderGeometry(.022, .022, .55, 10), carbon, [0, -.05, 8.7], [Math.PI / 2, 0, 0]);
      for (const side of [-1, 1]) {
        const engine = add(new THREE.CylinderGeometry(.42, .52, 3.3, 32), carbon, [side * 1.42, .3, -5.4], [Math.PI / 2, 0, 0]);
        engine.scale.x = .82;
        add(new THREE.CircleGeometry(.36, 32), intake, [side * 1.42, .3, -3.74], [0, Math.PI, 0]);
        // Pylon attaching the engine to the fuselage.
        add(new THREE.BoxGeometry(.42, .32, 1.6), paint, [side * 1.1, .45, -5.15]);
        // Tapered exhaust plug at the rear of each engine.
        const exhaust = add(new THREE.CylinderGeometry(.44, .16, .6, 24), intake, [side * 1.42, .3, -7.2], [Math.PI / 2, 0, 0]);
        exhaust.scale.x = .82;
        add(new THREE.TorusGeometry(.41, .04, 10, 32), champagne, [side * 1.42, .3, -3.71], [0, 0, 0]);
        for (const z of [-2.3, -1.35, -.4, .55, 1.5, 2.45, 3.4, 4.3]) {
          const window = add(new THREE.SphereGeometry(.14, 16, 12), glass, [side * 1.0, .3, z]);
          window.scale.set(.28, .7, 1.25);
        }
        const windshield = add(new THREE.SphereGeometry(.4, 18, 14), glass, [side * .55, .4, 6.3]);
        windshield.scale.set(.45, .58, 1.35);
        const stripe = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * .5, -.14, -7.4), new THREE.Vector3(side * 1.02, -.14, -4.2),
          new THREE.Vector3(side * 1.06, -.14, 3.6), new THREE.Vector3(side * .45, -.14, 7.2),
        ]), 72, .04, 6, false), champagne);
        jet.add(stripe);
        // Engine fan blades behind the intake lip.
        const fan = new THREE.Group();
        fan.position.set(side * 1.42, .3, -3.85);
        for (let b = 0; b < 14; b++) {
          const blade = new THREE.Mesh(new THREE.BoxGeometry(.05, .32, .02), champagne);
          blade.position.set(Math.cos(b / 14 * Math.PI * 2) * .17, Math.sin(b / 14 * Math.PI * 2) * .17, 0);
          blade.rotation.z = b / 14 * Math.PI * 2 + .4;
          fan.add(blade);
        }
        jet.add(fan);
        // Cabin door outline and gold cheatline under the windows.
        const cheat = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
          new THREE.Vector3(side * .7, .05, -6.4), new THREE.Vector3(side * 1.05, .05, -2.6),
          new THREE.Vector3(side * 1.06, .05, 4.4), new THREE.Vector3(side * .6, .1, 7.0),
        ]), 72, .022, 6, false), champagne);
        jet.add(cheat);
        // Main landing gear doors on the belly fairing.
        add(new THREE.BoxGeometry(.5, .04, 1.1), carbon, [side * .45, -.52, -.6]);
      }
      // White anti-collision strobe on the tail spine and a belly beacon.
      const strobe = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 3 });
      add(new THREE.SphereGeometry(.07, 10, 8), strobe, [0, .55, -8.5]);
      add(new THREE.SphereGeometry(.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xff2a2a, emissiveIntensity: 2 }), [0, -.6, .4]);
      // Cockpit window frame accent.
      const frame = add(new THREE.TorusGeometry(.62, .025, 8, 40, Math.PI), champagne, [0, .35, 6.55], [-.35, 0, 0]);
      frame.scale.set(1, .7, 1);
      // Wraparound cockpit windshield.
      const shield = add(new THREE.SphereGeometry(.78, 32, 16, -Math.PI * .42, Math.PI * .84, Math.PI * .22, Math.PI * .2), glass, [0, .12, 6.15], [-Math.PI / 2, 0, 0]);
      shield.scale.set(1, 1, .72);
      // Tail cone exhaust.
      add(new THREE.CylinderGeometry(.18, .06, .5, 20), intake, [0, 0, -8.7], [Math.PI / 2, 0, 0]);
      // Polished engine lips and fan spinners.
      for (const side of [-1, 1]) {
        add(new THREE.TorusGeometry(.4, .045, 10, 32), champagne, [side * 1.42, .3, -3.72]);
        add(new THREE.ConeGeometry(.14, .3, 20), champagne, [side * 1.42, .3, -3.85], [-Math.PI / 2, 0, 0]);
      }
      paint.color.set(0x181a20);
      paint.sheen = 1; paint.sheenColor = new THREE.Color(0xd9b36c); paint.sheenRoughness = .35;
      jet.scale.setScalar(JET_SCALE);
      const pathScale = () =>
        Math.min(1, Math.max(0.35, (window.innerWidth / window.innerHeight) / 1.3));
      jet.rotation.y = Math.PI * -0.5;
      jet.position.set(18 * pathScale(), -8, 0);
      const scene = new Scene(jet);
      scene.render();
      let animationStarted = false;
      const startAnimation = () => {
        if (animationStarted) return;
        animationStarted = true;
        window.removeEventListener("scroll", startAnimation);
        void setupAnimation(scene);
      };
      window.addEventListener("scroll", startAnimation, { once: true, passive: true });
      cleanups.push(() => window.removeEventListener("scroll", startAnimation));
      if (window.scrollY > 0) startAnimation();
    };

    const startScene = () => {
      if (sceneStarted || disposed) return;
      sceneStarted = true;
      window.removeEventListener("scroll", startScene);
      void loadScene();
    };

    window.addEventListener("scroll", startScene, { once: true, passive: true });

    return () => {
      disposed = true;
      window.removeEventListener("scroll", startScene);
      cleanups.forEach((fn) => fn());
    };
  }, []);

  const scrollToBottom = () => {
    document.querySelector(".tryon-showcase")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };

  const openFromImage = (e: React.MouseEvent) => {
    const img = (e.target as HTMLElement).closest<HTMLImageElement>(".watch-img");
    const tone = img?.dataset["tone"] as WatchTone | undefined;
    if (tone) void navigate({ to: "/shop/$watchId", params: { watchId: tone } });
  };

  return (
    <div ref={rootRef} className="plane-app" data-tone="steel" onClick={openFromImage}>
      <MidnightBackdrop />
      {tryOnWatch && (
        <Suspense fallback={null}>
          <VirtualTryOn watch={tryOnWatch} open onClose={() => setTryOnTone(null)} />
        </Suspense>
      )}
      <nav className="site-nav" aria-label="Main navigation">
        <a className="site-brand" href="#top" aria-label="BIG-B home"><img className="site-brand-logo" src={bigBLogoDark} alt="" /><span>BIG-B</span></a>
        <span className="site-nav-note">A study in time & motion</span>
      </nav>
      <div className="watch-spotlight" aria-hidden="true" />
      <div className="content">
        <div className="loading">Loading</div>
        <div className="trigger" />
        <div className="section hero-section" id="top">
          <p className="hero-kicker">Time, reimagined</p>
          <h1 aria-label="BIG-B"><span>BIG</span><span className="hero-brand-hyphen" aria-hidden="true" /><span>B</span></h1>
          <h3>The watch collection.</h3>
          <button className="hero-action" type="button" onClick={() => void navigate({ to: "/collection" })}>Discover the collection <span aria-hidden="true">↘</span></button>
          <div className="scroll-cta">Scroll</div>
        </div>
        <div className="section right">
            <h2>Sculpted in Surgical Steel</h2>
            <p>Brushed bevels · Seamless symmetry</p>
          <img src={watchSteel} data-tone="steel" alt="Luxury steel dive watch" className="watch-img" width={1024} height={1024} loading="lazy" />
        </div>
        <div className="ground-container">
          <div className="section right">
              <h2>Rose Gold Edition</h2>
              <p>Warm luster · Satin-finish bezel</p>
            <img src={watchRosegold} data-tone="rosegold" alt="Luxury rose gold watch" className="watch-img" width={1024} height={1024} loading="lazy" />
          </div>
          <div className="section">
            <h2>Black Skeleton</h2>
            <p>Skeleton-style dial · Analog automatic</p>
            <img src={watchBlack} data-tone="black" alt="Luxury black skeleton watch" className="watch-img" width={1024} height={1024} loading="lazy" />
          </div>
          <div className="section right">
              <h2>Gold Chronograph</h2>
              <p>Layered subdial chronograph · Polished gold links</p>
            <img src={watchGold} data-tone="gold" alt="Luxury gold chronograph watch" className="watch-img" width={1024} height={1024} loading="lazy" />
          </div>
        </div>

          <section className="tryon-showcase" aria-labelledby="tryon-title">
            <div className="tryon-copy">
              <p className="hero-kicker">New · Virtual try-on</p>
              <h2 id="tryon-title">See it on your wrist.</h2>
              <p className="tryon-text">Hold up your wrist to your camera and the watch fits itself in real time — sized, angled and lit like the real piece. Nothing is recorded; it all stays on your device.</p>
              <ol className="tryon-steps"><li><span>1</span>Pick a watch</li><li><span>2</span>Tap “Try on”</li><li><span>3</span>Raise your wrist</li></ol>
              <button type="button" onClick={() => setTryOnTone("gold")} className="hero-action">Try it on now <span aria-hidden="true">↗</span></button>
            </div>
            <div className="tryon-demo" aria-hidden="true">
              <div className="tryon-demo-frame">
                <div className="tryon-rotor">
                  <img src={tryonArm} alt="" className="tryon-arm" width={768} height={1024} loading="lazy" decoding="async" />
                  {[tryOnImages.steel, tryOnImages.gold, tryOnImages.rosegold, tryOnImages.black].map((src, i) => <img key={src} src={src} alt="" className="tryon-demo-watch" loading="lazy" decoding="async" style={{ animationDelay: `${i * 3}s` }} />)}
                </div>
                <div className="tryon-scan" />
                <span className="tryon-badge">● Fitted to your wrist</span>
              </div>
            </div>
          </section>
      </div>
      <SiteFooter />
    </div>
  );
}
