import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree, useFrame, type ThreeEvent } from "@react-three/fiber";
import { Environment, OrbitControls, PerspectiveCamera, ContactShadows } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { Finish } from "@/data/finishes";
import type { Product } from "@/data/products";
import { FallbackModel, GLBModel, ObjectModel, type Fit } from "./Model";
import { LoadingOverlay } from "./LoadingOverlay";

const FOV = 38;

/** Breathing room around the piece so it never touches the viewport edge. */
const FIT_MARGIN = 1.12;

/** Three-quarter view direction; length is normalised, distance comes from the fit. */
const VIEW_DIR = new THREE.Vector3(0.22, 0.18, 0.98).normalize();

const ORIGIN = new THREE.Vector3();

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

    camera.position.copy(VIEW_DIR).multiplyScalar(dist);
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
  resetSignal: number;
  onLoadedChange: (loaded: boolean) => void;
}

export default function Viewer({
  product,
  finish,
  autoRotate,
  resetSignal,
  onLoadedChange,
}: ViewerProps) {
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
      const current = e.camera.position.distanceTo(controlsRef.current?.target ?? ORIGIN);
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
      // Khronos PBR Neutral, not ACES. ACES is a film curve: it desaturates as
      // it approaches white, which is exactly where a diamond's fire lives, so
      // it washes the rainbow out of the dispersion the gem material generates.
      // Neutral is purpose-built for product rendering and holds hue into the
      // highlights. It also rolls off less, so the exposure comes down to suit.
      toneMapping: THREE.NeutralToneMapping,
      toneMappingExposure: 1.15,
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

        {/* Lighting is environment-first, the way product photography works:
            the studio HDRI does the modelling, and these few sources only add
            definition. The previous rig pushed ~14 units of direct light on top
            of the map, which blew the metal toward white and erased the shading
            gradient that describes the form. */}

        {/* Key — also the shadow caster. */}
        <spotLight
          position={[2.8, 6, 3.5]}
          intensity={2.2}
          angle={0.38}
          penumbra={0.55}
          castShadow
          shadow-mapSize={[1024, 1024]}
          color="#fff6ee"
        />
        {/* Cool fill, so the shadow side keeps some shape. */}
        <directionalLight intensity={0.45} position={[-4, 2, -1]} color="#b8ccff" />
        {/* Warm rim, to separate the silhouette from the background. */}
        <directionalLight intensity={0.4} position={[0.5, 1.5, -4]} color="#ffd8a0" />

        {/* Scintillation accents.
            A diamond sparkles because its facets sweep past several distinct,
            hard highlights as the piece turns. One broad light gives an even
            sheen, which reads as glass; small separated points produce the
            flashing. Kept dim — they are for the stones, not the metal. */}
        <pointLight
          position={[2.4, 1.7, 2.5]}
          intensity={2.2}
          distance={14}
          decay={2}
          color="#ffffff"
        />
        <pointLight
          position={[-2.7, 1.0, 1.9]}
          intensity={1.6}
          distance={14}
          decay={2}
          color="#eaf1ff"
        />
        <pointLight
          position={[0.5, -1.9, 2.7]}
          intensity={1.2}
          distance={14}
          decay={2}
          color="#fff1de"
        />

        {/* A polished metal is mostly a mirror, so its look IS the environment.
            An empty warehouse is broadly uniform, which reflects as flat, even
            yellow — the "painted" look. A studio HDRI has bright panels against
            dark surrounds, and that contrast is what reads as metal. Paired
            with the measured F0 colours in finishes.ts. */}
        <Environment preset="studio" environmentIntensity={1.15} />

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
        <FocusRig focus={focus} controlsRef={controlsRef} onArrived={clearFocus} />
        <OrbitControls
          ref={controlsRef}
          enableDamping
          dampingFactor={0.06}
          enablePan
          autoRotate={autoRotate}
          autoRotateSpeed={2.4}
          zoomToCursor
          makeDefault
        />
      </Canvas>

      {!fit && <LoadingOverlay />}
    </div>
  );
}
