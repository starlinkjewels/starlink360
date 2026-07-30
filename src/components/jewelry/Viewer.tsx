import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Environment, OrbitControls, PerspectiveCamera, ContactShadows } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Finish } from "@/data/finishes";
import type { Product } from "@/data/products";
import { FallbackModel, GLBModel, ObjectModel, type Fit } from "./Model";
import { LoadingOverlay } from "./LoadingOverlay";
import { StudioRig, type StudioApi } from "./StudioRig";
import { ENV_PRESET } from "./environment";

const FOV = 38;

/** Breathing room around the piece so it never touches the viewport edge. */
const FIT_MARGIN = 1.12;

/*
 * Three-quarter view direction, pre-normalised by hand.
 *
 * Constructing a THREE.Vector3 at module scope ran during this chunk's own
 * initialisation, which read a class out of the three.js chunk before that
 * chunk had finished declaring it. The bundler exposes the namespace as
 * getters, so the getter returned a binding still in its temporal dead zone and
 * the viewer died with "Cannot access 'a' before initialization".
 *
 * Nothing imported may be constructed or called at module scope for that
 * reason. Plain numbers cannot fail, and the vectors are built where they are
 * used. Values are (0.22, 0.18, 0.98) divided by its length, 1.0203921.
 */
const VIEW_DIR = [0.2156034, 0.1764028, 0.9604151] as const;

/** Rebuilt per call rather than shared — a module-scope instance is the hazard. */
const origin = () => new THREE.Vector3();

function Framing({
  fit,
  resetSignal,
  controlsRef,
}: {
  fit: Fit | null;
  resetSignal: number;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  // Re-fit whenever the canvas resizes — phone rotation, or a narrow portrait
  // window where the horizontal axis is the tight one.
  const size = useThree((s) => s.size);

  useEffect(() => {
    if (!fit) return;

    // camera.fov is the VERTICAL field of view. A wide necklace in a portrait
    // viewport is limited horizontally instead, so solve both and take the
    // tighter — otherwise the piece runs off the sides of a phone.
    const vFov = (camera.fov * Math.PI) / 180;
    const tanV = Math.tan(vFov / 2);
    const tanH = tanV * camera.aspect;

    // Distance to the piece's centre. The `+ radiusXZ` clears the half of the
    // footprint nearest the camera, which a centre-only fit would push
    // out of frame.
    const forHeight = fit.halfHeight / tanV + fit.radiusXZ;
    const forWidth = fit.radiusXZ / tanH + fit.radiusXZ;
    const dist = Math.max(forHeight, forWidth) * FIT_MARGIN;

    camera.position.set(...VIEW_DIR).multiplyScalar(dist);
    camera.near = Math.max(dist / 1000, 0.001);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();

    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(0, 0, 0);
      // Let people get right up to a stone, and pull back off the whole piece.
      controls.minDistance = fit.radius * 0.12;
      controls.maxDistance = dist * 5;
      controls.update();
    }
  }, [fit, resetSignal, camera, controlsRef, size.width, size.height]);

  return null;
}

interface Focus {
  point: THREE.Vector3;
  dist: number;
}

/**
 * Glides the orbit centre onto whatever the user tapped.
 *
 * OrbitControls always zooms and rotates about `target`. On a necklace that
 * target is the middle of the chain loop, so pinching to inspect the pendant
 * drives it straight out of frame. `zoomToCursor` fixes this for a mouse wheel
 * but three's touch handlers never set `performCursorZoom`, so it does nothing
 * for pinch — hence moving the target itself.
 */
function FocusRig({
  focus,
  controlsRef,
  onArrived,
}: {
  focus: Focus | null;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  onArrived: () => void;
}) {
  const camera = useThree((s) => s.camera);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!focus || !controls) return;

    // Frame-rate independent easing — same feel at 30fps and 120fps.
    const k = 1 - Math.pow(0.0015, Math.min(delta, 0.1));
    controls.target.lerp(focus.point, k);

    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() > 1e-12) {
      const want = focus.point.clone().addScaledVector(dir.normalize(), focus.dist);
      camera.position.lerp(want, k);
    }
    controls.update();

    // Done only once the centre has arrived AND the dolly has settled —
    // checking the target alone ends the animation early when the tap lands
    // near the existing centre, cancelling the zoom.
    const tol = Math.max(focus.dist, 1e-4) * 0.02;
    const centred = controls.target.distanceTo(focus.point) < tol;
    const dollied = Math.abs(camera.position.distanceTo(controls.target) - focus.dist) < tol;
    if (centred && dollied) onArrived();
  });

  return null;
}

export interface ViewerProps {
  product: Product;
  finish: Finish;
  autoRotate: boolean;
  /** Turntable speed multiplier, 1 = the original pace. */
  rotateSpeed?: number;
  resetSignal: number;
  /**
   * Set while the page is already showing its own loading state.
   *
   * Both this component and the page render a full-screen overlay, and a piece
   * arriving by link triggers both at once — the download progress from the
   * page, "setting the stones" from here — so the two stacked on top of each
   * other and printed doubled text over doubled progress bars. Whoever knows
   * more owns the stage; during a download that is the page.
   */
  hideLoader?: boolean;
  onLoadedChange: (loaded: boolean) => void;
  /** Filled with the capture API once a piece is framed; null while loading. */
  studioRef?: React.MutableRefObject<StudioApi | null>;
}

export default function Viewer({
  product,
  finish,
  autoRotate,
  rotateSpeed = 1,
  resetSignal,
  hideLoader = false,
  onLoadedChange,
  studioRef,
}: ViewerProps) {
  const localStudio = useRef<StudioApi | null>(null);
  const studio = studioRef ?? localStudio;
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [source, setSource] = useState<"checking" | "glb" | "fallback" | "object">("checking");

  // Verify the GLB exists before handing it to the loader, so a missing asset
  // degrades to the studio stand-in instead of throwing.
  useEffect(() => {
    let cancelled = false;
    setSource("checking");
    setFit(null);
    onLoadedChange(false);
    if (product.object) {
      setSource("object");
      return;
    }
    fetch(product.glbUrl, { method: "HEAD" })
      .then((res) => {
        const type = res.headers.get("content-type") ?? "";
        const ok = res.ok && !type.includes("text/html");
        if (!cancelled) setSource(ok ? "glb" : "fallback");
      })
      .catch(() => {
        if (!cancelled) setSource("fallback");
      });
    return () => {
      cancelled = true;
    };
  }, [product.glbUrl, product.object, onLoadedChange]);

  const handleFit = useCallback(
    (f: Fit) => {
      setFit(f);
      onLoadedChange(true);
    },
    [onLoadedChange],
  );

  // "Reset view" pulls back to the whole piece, so drop any focus with it.
  useEffect(() => setFocus(null), [resetSignal]);

  const downAt = useRef<{ x: number; y: number } | null>(null);
  const onPointerDownCapture = useCallback((e: React.PointerEvent) => {
    downAt.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleModelTap = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!fit) return;
      // Ignore the click that ends an orbit drag — only a near-stationary
      // press counts as "look at this".
      const from = downAt.current;
      const moved = from
        ? Math.hypot(e.nativeEvent.clientX - from.x, e.nativeEvent.clientY - from.y)
        : 0;
      if (moved > 8) return;

      e.stopPropagation();
      const current = e.camera.position.distanceTo(controlsRef.current?.target ?? origin());
      setFocus({
        point: e.point.clone(),
        // Close enough to read a setting, but never pull back out if they've
        // already pinched in tighter than that.
        dist: Math.min(current, fit.radius * 0.55),
      });
    },
    [fit],
  );

  const clearFocus = useCallback(() => setFocus(null), []);

  const glConfig = useMemo(
    () => ({
      antialias: true,
      alpha: true,
      // Required to read pixels back after a render. Without it the buffer is
      // already cleared by the time an export tries to grab the frame.
      preserveDrawingBuffer: true,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: 1.4,
      outputColorSpace: THREE.SRGBColorSpace,
    }),
    [],
  );

  return (
    <div className="absolute inset-0" onPointerDownCapture={onPointerDownCapture}>
      <Canvas
        dpr={[1, 2]}
        gl={glConfig}
        style={{ background: "transparent" }}
        shadows={{ type: THREE.PCFShadowMap }}
      >
        <PerspectiveCamera makeDefault fov={FOV} position={[0, 0, 5]} />

        {/* Jeweler's lamp — tight key from upper front-right */}
        <spotLight
          position={[2.8, 6, 3.5]}
          intensity={5.5}
          angle={0.38}
          penumbra={0.55}
          castShadow
          shadow-mapSize={[1024, 1024]}
          color="#fff6ee"
        />
        {/* Cool fill from the left */}
        <directionalLight intensity={1.4} position={[-4, 2, -1]} color="#b8ccff" />
        {/* Warm rim from behind — outlines the silhouette */}
        <directionalLight intensity={1.1} position={[0.5, 1.5, -4]} color="#ffd8a0" />
        {/* Subtle ambient so shadow areas aren't pure black */}
        <ambientLight intensity={0.12} />
        {/* Close point light to ignite gem facets */}
        <pointLight position={[0, 2.5, 1.2]} intensity={1.6} color="#fff4e0" distance={10} />

        {/* Same preset the gems refract through — see environment.ts. */}
        <Environment preset={ENV_PRESET} />

        <Suspense fallback={null}>
          {/* Tap anywhere on the piece to orbit and zoom around that spot. */}
          <group onClick={handleModelTap}>
            {source === "glb" && (
              <GLBModel key={product.id} url={product.glbUrl} finish={finish} onFit={handleFit} />
            )}
            {source === "fallback" && <FallbackModel finish={finish} onFit={handleFit} />}
            {source === "object" && product.object && (
              <ObjectModel
                key={product.id}
                object={product.object}
                finish={finish}
                onFit={handleFit}
              />
            )}
          </group>
        </Suspense>

        {fit && (
          // Sit the shadow just under the piece rather than under its
          // bounding sphere, so a wide, flat necklace isn't floating.
          <ContactShadows
            position={[0, -fit.halfHeight * 1.08, 0]}
            opacity={0.42}
            scale={fit.radiusXZ * 6}
            blur={2.6}
            far={fit.radius * 4}
          />
        )}

        <Framing fit={fit} resetSignal={resetSignal} controlsRef={controlsRef} />
        <StudioRig fit={fit} apiRef={studio} controlsRef={controlsRef} />
        <FocusRig focus={focus} controlsRef={controlsRef} onArrived={clearFocus} />
        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.06}
          enablePan
          autoRotate={autoRotate}
          autoRotateSpeed={2.4 * rotateSpeed}
          zoomToCursor
          makeDefault
        />
      </Canvas>

      {!fit && !hideLoader && <LoadingOverlay />}
    </div>
  );
}
