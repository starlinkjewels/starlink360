import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useThree, useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  Environment,
  OrbitControls,
  OrthographicCamera,
  PerspectiveCamera,
  ContactShadows,
  MeshReflectorMaterial,
  GizmoHelper,
  GizmoViewport,
  Grid,
} from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { acceleratePicking } from "./pickBvh";
import type { Finish } from "@/data/finishes";
import type { Product } from "@/data/products";
import { FallbackModel, GLBModel, ObjectModel, type Fit } from "./Model";
import { DimensionOverlay } from "./DimensionOverlay";
import { DEFAULT_DIMENSIONS, mmPerUnit, summariseGems, type DimensionSettings } from "./dimensions";
import { LoadingOverlay } from "./LoadingOverlay";
import { StudioRig, type StudioApi } from "./StudioRig";
import type { StoneGroup } from "./stones";
import type { GemOptics } from "./GemRefraction";
import type { Stamp } from "./stamps";
import {
  applyClick,
  attachHighlight,
  HOVER_COLOR,
  SELECT_COLOR,
  solidAt,
  solidId,
  type Part,
  type PartKind,
} from "./selection";
import {
  DEFAULT_POST,
  composerKey,
  createSceneRenderer,
  usesComposer,
  type PostSettings,
  type SceneRenderer,
} from "./bloom";
import {
  DEFAULT_CAMERA,
  applyAspect,
  cameraPosition,
  frameFit,
  type CameraSettings,
} from "./camera";
import { DEFAULT_LIGHTING, environmentById, type LightingSettings } from "./lighting";
import { DEFAULT_GROUND, groundDimensions, groundY, type GroundSettings } from "./ground";
import { DEFAULT_LIGHTS, casterOf, type LightDef } from "./lights";
import {
  objectPoseAt,
  poseAt,
  posePosition,
  type AnimationPreset,
  type ObjectMove,
} from "./animation";
import { DEFAULT_SHADOWS, shadowFrustum, type ShadowSettings } from "./shadows";
import { isReasonablySized, type ProngHeights } from "./prongs";

/** Rebuilt per call rather than shared — a module-scope instance is the hazard. */
const origin = () => new THREE.Vector3();

function Framing({
  fit,
  settings,
  resetSignal,
  controlsRef,
  onMoved,
}: {
  fit: Fit | null;
  settings: CameraSettings;
  resetSignal: number;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  /** Reports where the camera actually is, so the panel can show real numbers. */
  onMoved?: (position: [number, number, number]) => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  // Re-fit whenever the canvas resizes — phone rotation, or a narrow portrait
  // window where the horizontal axis is the tight one.
  const size = useThree((s) => s.size);

  useEffect(() => {
    if (!fit) return;

    // Same call the export path makes, so the download matches the viewport.
    const aspect = size.width / Math.max(size.height, 1);
    const framing = frameFit(fit, settings, aspect);

    /*
     * A pinned position wins over the framing. Both go through one helper so
     * the viewport and an export cannot disagree — the failure being a download
     * taken from the framed angle while the screen shows the pinned one.
     */
    camera.position.set(...cameraPosition(settings, framing.distance));
    camera.near = framing.near;
    camera.far = framing.far;
    applyAspect(camera, aspect, framing.orthoHalfHeight);

    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(0, 0, 0);
      // Let people get right up to a stone, and pull back off the whole piece.
      controls.minDistance = fit.radius * 0.12;
      controls.maxDistance = framing.distance * 5;
      controls.update();
    }
  }, [fit, settings, resetSignal, camera, controlsRef, size.width, size.height]);

  /*
   * Published on a change, not every frame.
   *
   * Orbiting moves the camera continuously, and a state update per frame would
   * re-render the whole panel sixty times a second. A hundredth of a unit is
   * finer than the field displays, so nothing visible is lost by ignoring
   * smaller moves.
   */
  const last = useRef<[number, number, number]>([NaN, NaN, NaN]);
  useFrame(() => {
    if (!onMoved) return;
    const p = camera.position;
    const [x, y, z] = last.current;
    if (Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01 && Math.abs(p.z - z) < 0.01) return;
    last.current = [p.x, p.y, p.z];
    onMoved([p.x, p.y, p.z]);
  });

  return null;
}

/**
 * The surface the piece stands on.
 *
 * Split out so the mirror's material only exists while it is switched on:
 * `MeshReflectorMaterial` allocates its reflection buffers on mount and renders
 * the scene into them every frame, so leaving one mounted-but-unused would keep
 * paying for a feature nobody enabled.
 */
function Ground({ fit, settings }: { fit: Fit; settings: GroundSettings }) {
  const { ground } = groundY(fit.halfHeight, fit.radius);
  const dim = groundDimensions(settings, fit.radiusXZ);

  return (
    <mesh position={[0, ground, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      {settings.shape === "circle" ? (
        <circleGeometry args={[dim.radius, dim.segments]} />
      ) : (
        <planeGeometry args={[dim.width, dim.length]} />
      )}

      {/*
        Transparent is not "off": the plane still exists and still receives the
        shadow, it just is not drawn. That is the cyclorama trick — a piece
        floating on a gradient with a real shadow beneath it — and it is
        impossible to express by switching the ground off, which loses the
        shadow with it. A reflector cannot be transparent, so it wins.
      */}
      {settings.kind === "transparent" && settings.style !== "mirror" ? (
        <shadowMaterial opacity={1 - settings.roughness * 0.5} />
      ) : settings.style === "mirror" ? (
        <MeshReflectorMaterial
          resolution={settings.resolution}
          blur={[settings.blurX, settings.blurY]}
          mixBlur={settings.mixBlur}
          mixStrength={settings.mixStrength}
          mixContrast={settings.mixContrast}
          mirror={settings.mirror}
          depthScale={settings.depthScale}
          minDepthThreshold={settings.minDepthThreshold}
          maxDepthThreshold={settings.maxDepthThreshold}
          depthToBlurRatioBias={settings.depthToBlurRatioBias}
          distortion={settings.distortion}
          color={settings.color}
          roughness={settings.roughness}
          metalness={0.6}
          // Lifts the mirror plane off the shadow it reflects, which otherwise
          // shows up as a dark band exactly under the piece.
          reflectorOffset={Math.max(fit.radius, 1e-3) * 0.002}
        />
      ) : (
        <meshStandardMaterial color={settings.color} roughness={settings.roughness} metalness={0} />
      )}
    </mesh>
  );
}

/**
 * Takes over drawing while bloom is on.
 *
 * `useFrame` at priority 1 stops R3F rendering the scene itself, so the
 * composer becomes the only thing that draws — otherwise both run and the
 * composed frame is immediately overwritten by a plain one.
 *
 * The renderer is handed upward as well, because exports call it directly. Any
 * other arrangement gives bloom on screen and none in the download.
 */
/** Keeps the renderer's exposure in sync with the Environment panel's slider. */
function ExposureSync({ exposure }: { exposure: number }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.toneMappingExposure = exposure;
  }, [gl, exposure]);
  return null;
}

function BloomRig({
  settings,
  onRenderer,
}: {
  settings: PostSettings;
  onRenderer: (r: SceneRenderer | null) => void;
}) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const rendererRef = useRef<SceneRenderer | null>(null);

  useEffect(() => {
    const renderer = createSceneRenderer(gl, scene, camera, settings);
    rendererRef.current = renderer;
    onRenderer(renderer);
    return () => {
      rendererRef.current = null;
      onRenderer(null);
      renderer.dispose();
    };
    /*
     * Rebuilt when the camera object changes — swapping projection replaces it,
     * and a composer bound to the old one renders nothing — and when the SHAPE
     * of the chain changes. Which passes exist, SSR's bouncing targets and
     * bloom's buffer size are all baked in at construction, so updating them in
     * place does nothing at all: the control moves and the render does not.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, composerKey(settings)]);

  // Cheap updates: the passes take new numbers without being rebuilt.
  useEffect(() => rendererRef.current?.update(settings), [settings]);
  useEffect(() => rendererRef.current?.setSize(size.width, size.height), [size.width, size.height]);

  useFrame(() => rendererRef.current?.render(), 1);
  return null;
}

/**
 * Tints what is selected, and what is under the cursor.
 *
 * Renders nothing of its own — it parents overlay meshes onto the parts and
 * takes them off again, so the tint follows the piece through every rotation
 * and re-fit without a matrix to keep in sync. See `attachHighlight`.
 */
function SelectionHighlight({
  parts,
  selected,
  hovered,
}: {
  parts: Part[];
  selected: ReadonlySet<string>;
  hovered: string | null;
}) {
  useEffect(() => attachHighlight(parts, selected, SELECT_COLOR, 0.55), [parts, selected]);

  // Hover is the weaker signal and never fights the selection for a part.
  const hover = useMemo(
    () => new Set(hovered && !selected.has(hovered) ? [hovered] : []),
    [hovered, selected],
  );
  useEffect(() => attachHighlight(parts, hover, HOVER_COLOR, 0.22), [parts, hover]);

  return null;
}

/**
 * Renders the light list, and the shadow camera the caster owns.
 *
 * The shadow camera is set imperatively rather than through JSX props: three
 * only rebuilds the projection when `updateProjectionMatrix` is called, so a
 * prop change alone moves the numbers without moving the shadow — which reads
 * as the controls not working.
 */
/**
 * Fewer pixels while the piece is moving.
 *
 * The stutter people report is always the same moment: they drag to turn the
 * piece and it lurches. At rest the scene is cheap enough, but a drag asks for
 * a new frame every 16ms of a ray-traced gem shader and a shadow pass, at up
 * to twice the device pixel ratio — four times the pixels of a plain render.
 * Nothing in the chain ever stepped down, so the frame rate had to give.
 *
 * Half resolution while the pointer is down and full resolution the moment it
 * is released: motion hides the softness, and a still frame is what anyone
 * actually looks at. Restoring is delayed a beat because OrbitControls damping
 * keeps gliding after release, and sharpening mid-glide costs a frame exactly
 * where it shows.
 *
 * Exports are untouched. They set the pixel ratio themselves and restore it,
 * and nothing here fires while one runs.
 */
function InteractionQuality({
  controlsRef,
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}) {
  const setDpr = useThree((s) => s.setDpr);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const full = Math.min(window.devicePixelRatio || 1, 2);
    /*
     * Never below 1. Going under it is visible as a soft, cheap-looking piece
     * even in motion, and on the integrated graphics this is aimed at the win
     * from halving again is small next to what it costs to look at.
     */
    const moving = Math.max(1, full / 2);
    let restore: ReturnType<typeof setTimeout> | undefined;

    const onStart = () => {
      clearTimeout(restore);
      setDpr(moving);
    };
    const onEnd = () => {
      clearTimeout(restore);
      restore = setTimeout(() => setDpr(full), 250);
    };

    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);
    return () => {
      clearTimeout(restore);
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
      setDpr(full);
    };
  }, [controlsRef, setDpr]);

  return null;
}

/**
 * Keeps hover picking off the brute-force path as the scene changes.
 *
 * Swept from the frame loop rather than an effect on the parts, because a
 * mesh appears in the scene a beat after the state that produced it and one
 * mesh without a tree is enough to stall the pointer by itself. The sweep is
 * a traverse over a handful of objects, skipping any that already have one,
 * and runs twice a second — next to a stalled pointer it does not register.
 */
function PickAcceleration() {
  const scene = useThree((s) => s.scene);
  const next = useRef(0);
  useFrame(() => {
    const now = performance.now();
    if (now < next.current) return;
    next.current = now + 500;
    acceleratePicking(scene);
  });
  return null;
}

function LightRig({
  lights,
  fit,
  shadows,
  debug,
}: {
  lights: LightDef[];
  fit: Fit | null;
  shadows: ShadowSettings;
  debug: boolean;
}) {
  const gl = useThree((state) => state.gl);
  const casterRef = useRef<THREE.SpotLight | THREE.DirectionalLight | null>(null);
  const caster = casterOf(lights);
  const directional = shadows.enabled && shadows.mode === "directional";

  /*
   * The shadow map type follows the mode, because the softness controls only
   * mean something under one of them.
   *
   * PCF — what the viewer has always used — samples a fixed 3x3 kernel and
   * ignores both `shadow.radius` and `blurSamples`, so a Samples slider over it
   * would be a control that does nothing. VSM blurs the depth map itself and
   * honours both. It is not the default because it changes every existing
   * render and carries its own light-bleed artefacts on thin geometry.
   */
  useEffect(() => {
    const want = directional ? THREE.VSMShadowMap : THREE.PCFShadowMap;
    if (gl.shadowMap.type === want) return;
    gl.shadowMap.type = want;
    // Existing materials compiled against the old shadow path; without this
    // they keep sampling it and the change does not appear.
    gl.shadowMap.needsUpdate = true;
  }, [gl, directional]);

  useEffect(() => {
    const light = casterRef.current;
    if (!light || !directional) return;

    const f = shadowFrustum(shadows, fit?.radius ?? 1);
    const cam = light.shadow.camera as THREE.OrthographicCamera & THREE.PerspectiveCamera;
    cam.near = f.near;
    cam.far = f.far;
    // A spot's shadow camera is perspective, so left/right/top/bottom mean
    // nothing to it — only an orthographic one has planes to set.
    if ((cam as THREE.OrthographicCamera).isOrthographicCamera) {
      cam.left = f.left;
      cam.right = f.right;
      cam.top = f.top;
      cam.bottom = f.bottom;
    }
    cam.updateProjectionMatrix();

    light.shadow.mapSize.set(shadows.mapWidth, shadows.mapHeight);
    light.shadow.bias = shadows.bias;
    light.shadow.radius = shadows.radius;
    (light.shadow as THREE.SpotLightShadow).focus = shadows.focus;
    (light.shadow as unknown as { blurSamples: number }).blurSamples = shadows.samples;
    /*
     * The map is allocated at the old size until it is disposed, so changing
     * mapSize without this leaves the shadow rendering at whatever size it was
     * first created with.
     */
    light.shadow.map?.dispose();
    light.shadow.map = null;
  }, [directional, shadows, fit?.radius]);

  return (
    <>
      {lights.map((l) => {
        if (!l.visible) return null;
        const casts = directional && caster?.id === l.id;
        const ref = casts ? (casterRef as never) : undefined;

        if (l.type === "ambient") {
          return <ambientLight key={l.id} intensity={l.intensity} color={l.color} />;
        }
        if (l.type === "point") {
          return (
            <pointLight
              key={l.id}
              position={l.position}
              intensity={l.intensity}
              color={l.color}
              distance={l.distance ?? 0}
            />
          );
        }
        if (l.type === "spot") {
          return (
            <spotLight
              key={l.id}
              ref={ref}
              position={l.position}
              intensity={l.intensity}
              color={l.color}
              angle={l.angle ?? 0.4}
              penumbra={l.penumbra ?? 0.5}
              distance={l.distance ?? 0}
              castShadow={casts}
            />
          );
        }
        return (
          <directionalLight
            key={l.id}
            ref={ref}
            position={l.position}
            intensity={l.intensity}
            color={l.color}
            castShadow={casts}
          />
        );
      })}

      {/* Where each light actually is. Guessing from the render is guesswork. */}
      {debug &&
        lights
          .filter((l) => l.visible && l.type !== "ambient")
          .map((l) => (
            <mesh key={`h-${l.id}`} position={l.position}>
              <sphereGeometry args={[0.06, 12, 12]} />
              <meshBasicMaterial color={l.color} toneMapped={false} />
            </mesh>
          ))}
    </>
  );
}

/**
 * Plays a camera move in the viewport.
 *
 * The same `poseAt` the exporter uses, so what is previewed is what is
 * downloaded — the two used to be different code with no reason to agree.
 *
 * While a move is playing OrbitControls is left alone rather than disabled: it
 * is only ever asked for its target, and writing the camera position under it
 * each frame is enough. Disabling it would drop the user's zoom on stop.
 */
function AnimationRig({
  preset,
  objectMove,
  object,
  playing,
  seconds,
  fit,
  settings,
  onProgress,
}: {
  preset: AnimationPreset | null;
  /** A move applied to the piece itself, or null. */
  objectMove: ObjectMove | null;
  /** The group the piece hangs from, which the object move drives. */
  object: THREE.Object3D | null;
  playing: boolean;
  seconds: number;
  fit: Fit | null;
  settings: CameraSettings;
  onProgress?: (t: number) => void;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const elapsed = useRef(0);

  // Restart from the top whenever the move or its length changes, so a switch
  // does not land mid-way through the new one.
  useEffect(() => {
    elapsed.current = 0;
  }, [preset, seconds]);

  useFrame((_, delta) => {
    if (!playing || !fit) return;
    // A move on the piece alone still needs the clock running.
    if (!preset && !objectMove) return;

    const length = Math.max(0.1, seconds);
    elapsed.current = (elapsed.current + delta) % length;
    const t = elapsed.current / length;

    if (preset) {
      const aspect = size.width / Math.max(size.height, 1);
      const framing = frameFit(fit, settings, aspect);
      camera.position.set(...posePosition(poseAt(preset, t), framing.distance));
      camera.lookAt(0, 0, 0);
    }

    if (objectMove && object) {
      const p = objectPoseAt(objectMove, t);
      /*
       * Lift is in piece radii, so a drop reads the same height on a ring and
       * on a necklace — the whole reason the pose is dimensionless.
       */
      object.position.y = p.lift * fit.radius;
      object.rotation.set(p.rotX, p.rotY, p.rotZ);
    }

    onProgress?.(t);
  });

  /*
   * Put the piece back when the move is taken off, or it is left hanging in
   * mid-air at whatever frame the clip happened to stop on.
   */
  useEffect(() => {
    if (objectMove || !object) return;
    object.position.y = 0;
    object.rotation.set(0, 0, 0);
  }, [objectMove, object]);

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

  /** Turntable speed multiplier, 1 = the original pace. */

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
  /** Projection, lens, clipping and object spin. */
  camera?: CameraSettings;
  /** A camera move to play in the viewport, or null for none. */
  animation?: AnimationPreset | null;
  /** A move applied to the piece itself, or null for none. */
  objectMove?: ObjectMove | null;
  animationPlaying?: boolean;
  animationSeconds?: number;
  onAnimationProgress?: (t: number) => void;
  /** Where the camera is right now, as it moves. */
  onCameraMoved?: (position: [number, number, number]) => void;
  /** The light rig. */
  lights?: LightDef[];
  /** Shows a marker at each light's position. */
  debugLights?: boolean;
  /** Shadow mechanism and its settings. */
  shadows?: ShadowSettings;
  /** Environment, light levels and ground shadow. */
  lighting?: LightingSettings;
  /** The surface the piece stands on. Off by default. */
  ground?: GroundSettings;
  /** Glow on the highlights. Off by default. */
  post?: PostSettings;
  /** Ground grid, from the viewport toolbar. */
  showGrid?: boolean;
  /** Freezes the camera so a framing cannot be nudged by accident. */
  locked?: boolean;
  /** Colour chosen per stone group in the picker, keyed by group id. */
  stoneColors?: Record<string, string>;
  /** Library metal resolved per part id, from the Materials panel. */
  metalOverrides?: Record<string, { color: string; roughness: number; metalness: number }>;
  /** Library optics resolved per stone group id, from the Materials panel. */
  gemOverrides?: Record<string, GemOptics>;
  /** Height factor per prong solid id, from the Prongs panel. 1 is unchanged. */
  prongHeights?: ProngHeights;
  /** The selectable stone groups in the loaded piece. */
  onStones?: (groups: StoneGroup[]) => void;
  /** Fired when a stone is tapped on the piece, so the picker can follow. */
  onStoneTap?: (id: string) => void;
  /** Every selectable part in the loaded piece. */
  onParts?: (parts: Part[]) => void;
  /** The piece's real extent, for Model Dimensions and anything else that
   *  needs the actual size rather than the framing radius alone. */
  onFit?: (fit: Fit) => void;
  dimensions?: DimensionSettings;
  /**
   * True while the Select tool is active.
   *
   * Off, the viewport is for looking: a tap moves the camera onto the detail
   * and nothing is picked. On, a tap picks and the camera holds still.
   */
  selecting?: boolean;
  /**
   * The prong brush is armed. A click is then exclusively a prong pick — add
   * or remove one shape-qualifying solid from the selection, or do nothing —
   * never a paint, a stamp, a stone tap, or a tap-to-focus. Independent of
   * `selecting`: this is its own tool, not a mode of the Select tool.
   */
  prongPicking?: boolean;
  /** Ids currently selected, and how to change them. */
  selected?: ReadonlySet<string>;
  onSelected?: (next: Set<string>) => void;
  /**
   * Paint mode. Return true to say the click was consumed, which suppresses the
   * selection change — painting and selecting on the same click would leave the
   * piece covered in selection tint after a few stones.
   */
  onPaintPart?: (partId: string, kind: PartKind) => boolean;
  /**
   * Striking a hallmark. Returns true when the click was consumed.
   *
   * `point` and `normal` are in the part's LOCAL space, because that is the
   * only frame that survives the recentring, the fit scale and the turntable —
   * a mark pinned to a world point would slide off the metal as soon as the
   * piece moved.
   */
  onPlaceStamp?: (
    partId: string,
    point: [number, number, number],
    normal: [number, number, number],
  ) => boolean;
  /** Hallmarks struck into the metal, rendered as decals on the piece. */
  stamps?: Stamp[];
  stampFont?: string;
  selectedStampId?: string | null;
  onLoadedChange: (loaded: boolean) => void;
  /** Filled with the capture API once a piece is framed; null while loading. */
  studioRef?: React.MutableRefObject<StudioApi | null>;
}

export default function Viewer({
  product,
  finish,
  resetSignal,
  hideLoader = false,
  camera: cameraSettings = DEFAULT_CAMERA,
  lighting = DEFAULT_LIGHTING,
  animation = null,
  objectMove = null,
  animationPlaying = false,
  animationSeconds = 6,
  onAnimationProgress,
  onCameraMoved,
  lights = DEFAULT_LIGHTS,
  debugLights = false,
  shadows = DEFAULT_SHADOWS,
  ground = DEFAULT_GROUND,
  post = DEFAULT_POST,
  showGrid = false,
  locked = false,
  stoneColors,
  metalOverrides,
  prongHeights,
  gemOverrides,
  onStones,
  onStoneTap,
  onParts,
  onFit,
  dimensions = DEFAULT_DIMENSIONS,
  selecting = false,
  prongPicking = false,
  selected,
  onSelected,
  onPaintPart,
  onPlaceStamp,
  stamps,
  stampFont,
  selectedStampId,
  onLoadedChange,
  studioRef,
}: ViewerProps) {
  const localStudio = useRef<StudioApi | null>(null);
  const studio = studioRef ?? localStudio;
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  // Held in state, not a ref: StudioRig has to re-read it when it appears.
  const [sceneRenderer, setSceneRenderer] = useState<SceneRenderer | null>(null);
  const [fit, setFit] = useState<Fit | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [partList, setPartList] = useState<Part[]>([]);
  const handleParts = useCallback(
    (parts: Part[]) => {
      setPartList(parts);
      onParts?.(parts);
    },
    [onParts],
  );
  const dimensionScale = useMemo(
    () => (fit ? mmPerUnit(dimensions.knownWidthMM, fit.width) : null),
    [dimensions.knownWidthMM, fit],
  );
  const dimensionSummary = useMemo(
    () => summariseGems(partList, dimensionScale),
    [partList, dimensionScale],
  );

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
      onFit?.(f);
    },
    [onLoadedChange, onFit],
  );

  // "Reset view" pulls back to the whole piece, so drop any focus with it.
  useEffect(() => setFocus(null), [resetSignal]);

  const downAt = useRef<{ x: number; y: number } | null>(null);
  const onPointerDownCapture = useCallback((e: React.PointerEvent) => {
    downAt.current = { x: e.clientX, y: e.clientY };
  }, []);

  /*
   * The last browser click already dealt with.
   *
   * R3F dispatches a click once per INTERSECTED OBJECT, and a ray through a
   * pave passes clean through several transparent stones — so one physical
   * click arrives here repeatedly, each time resolving to whatever it hit next.
   * `stopPropagation` is meant to end that, but it cannot run before the drag
   * guard above, and any dispatch that guard rejects leaves the rest of the
   * queue live. The result is one click painting the stone you aimed at AND
   * another one behind it, which is exactly the reported fault.
   *
   * Keyed on the native event, because that is the one thing every dispatch of
   * a single physical click genuinely shares.
   */
  const handledTap = useRef<MouseEvent | null>(null);

  /*
   * A click that hits nothing — the backdrop, not the piece — clears
   * whatever is selected. R3F's own miss event, so it fires only for a
   * click, never for an orbit drag; the same "did the pointer actually
   * move" guard as `handleModelTap` still applies, because a drag that
   * happens to end over empty space dispatches one too.
   */
  const handleBackgroundMiss = useCallback(
    (e: MouseEvent) => {
      const from = downAt.current;
      const moved = from ? Math.hypot(e.clientX - from.x, e.clientY - from.y) : 0;
      if (moved > 8) return;
      if (selected?.size) onSelected?.(new Set());
    },
    [selected, onSelected],
  );

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

      // One physical click, one stone. Before stopPropagation, which by itself
      // is too late to catch every dispatch.
      if (handledTap.current === e.nativeEvent) return;
      handledTap.current = e.nativeEvent;

      e.stopPropagation();

      /*
       * Tapping a stone also selects it, so the picker follows the piece rather
       * than making someone match a name in a list to a stone on screen. Focus
       * still happens either way — the two are not exclusive, and suppressing
       * the zoom would make stones feel unlike every other part of the model.
       */
      const stone = (e.object?.userData?.stone as { id?: string } | undefined)?.id;

      /*
       * Selection rides on the same tap as focus. Making it a separate mode
       * would mean choosing a tool before you can point at anything, which is
       * exactly the friction the tap-to-focus gesture was added to avoid.
       */
      /*
       * Which solid was hit, not just which layer.
       *
       * "Gem 03" is 140 separate diamonds and "Metal 01" is 285 solids, so the
       * group id alone can only ever mean "all of them". The raycast already
       * knows the triangle, and the decoder reordered the buffer so a solid is
       * a contiguous run of triangles — one binary search turns one into the
       * other. Ctrl/shift still adds, so a handful of stones is a few clicks.
       */
      const info = e.object?.userData?.part as { id?: string; kind?: PartKind } | undefined;
      const group = info?.id;
      const solids = (e.object?.userData?.solids as ArrayLike<number> | undefined) ?? undefined;
      const hit = e.faceIndex == null ? null : solidAt(solids, e.faceIndex);
      const part = group === undefined ? undefined : hit === null ? group : solidId(group, hit);

      /*
       * Picking prongs is its own exclusive tool, armed from the Prongs
       * panel's brush — not a mode of Select, and not open to painting,
       * stamping or the stone picker. A click toggles the clicked METAL
       * solid in the selection or does nothing (a stone, or the backdrop);
       * it never falls through to anything else.
       *
       * Deliberately not gated on shape (aspect ratio, stone proximity) —
       * that was tried, tuned against a real piece, and never worked. Size
       * is the one check kept: on a piece where a whole pavé face turned out
       * to be one connected sheet of metal, clicking it selected the entire
       * sheet, which no shape test would have caught since it never claimed
       * to check size. A person's own click is still trusted for WHICH small
       * solid is a prong; this only refuses something clearly too large to
       * be one.
       */
      if (prongPicking) {
        if (group && info?.kind === "metal" && hit !== null && part && selected && onSelected) {
          const pseudoPart: Part = {
            id: group,
            label: "",
            kind: "metal",
            mesh: e.object as THREE.Mesh,
            solids,
          };
          if (isReasonablySized(pseudoPart, hit)) {
            onSelected(applyClick(selected, part, true));
          }
        }
        return;
      }

      /*
       * Painting is tried first, in ANY mode.
       *
       * It used to sit inside the Select branch, so with the brush armed and
       * the View tool active — which is the default, and what anyone browsing
       * is in — clicking a stone did nothing at all while the panel said
       * "click any stone to paint Garnet". Arming a brush IS the statement of
       * intent; requiring a second, invisible mode on top of it is the kind of
       * thing that reads as the feature being broken.
       */
      /*
       * Striking a hallmark comes first, because it needs the one thing no
       * other tool does: WHERE on the surface the click landed, not just which
       * part it belongs to.
       *
       * Both are handed over in the part's own local space. World coordinates
       * would be wrong within a frame — the piece is recentred and scaled on
       * load and turned by the turntable — so a mark struck at a world point
       * would slide off the metal the moment anything moved.
       */
      if (group && info?.kind === "metal" && e.face) {
        const mesh = e.object as THREE.Mesh;
        const struck = onPlaceStamp?.(
          group,
          mesh.worldToLocal(e.point.clone()).toArray(),
          // `face.normal` is already in the mesh's own space, which is the
          // space the stamp is stored in.
          e.face.normal.toArray(),
        );
        if (struck) return;
      }

      const painted = part && info?.kind ? onPaintPart?.(part, info.kind) : false;
      if (painted) return;

      /*
       * One gesture, one intention.
       *
       * Selecting used to happen on every click alongside the zoom, so looking
       * at a ring meant fighting it — turn the piece, tap to see the setting,
       * and now three prongs are lit and the camera has jumped somewhere else.
       * In Select the camera holds still; in View nothing is picked.
       */
      if (selecting) {
        if (part && selected && onSelected) {
          const additive = e.nativeEvent.ctrlKey || e.nativeEvent.shiftKey || e.nativeEvent.metaKey;
          onSelected(applyClick(selected, part, additive));
        }
        // The stone picker still follows a tap, since that is the same intent.
        if (stone) onStoneTap?.(stone);
        return;
      }

      if (stone) onStoneTap?.(stone);

      const current = e.camera.position.distanceTo(controlsRef.current?.target ?? origin());
      setFocus({
        point: e.point.clone(),
        // Close enough to read a setting, but never pull back out if they've
        // already pinched in tighter than that.
        dist: Math.min(current, fit.radius * 0.55),
      });
    },
    [fit, selecting, prongPicking, onStoneTap, selected, onSelected, onPaintPart, onPlaceStamp],
  );

  const clearFocus = useCallback(() => setFocus(null), []);

  /*
   * Hover tells you what a click will select before you commit to it, which is
   * the only thing that makes a merged part list discoverable — "Metal 01" and
   * "Metal 02" mean nothing until pointing at one lights it up.
   *
   * State is only touched when the part under the cursor actually changes, so
   * moving across one part is free rather than a re-render per pointer event.
   */
  const [hovered, setHovered] = useState<string | null>(null);

  /*
   * Phone layout. Matched to the `sm` breakpoint the stylesheet uses, so the
   * canvas furniture and the CSS cannot disagree about what "narrow" means.
   */
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const sync = () => setCompact(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  /** The group an object move lifts and turns. */
  const pieceRef = useRef<THREE.Group>(null);
  const handleHover = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      // Highlighting on hover while nobody is selecting is noise, and it costs
      // a raycast against a million vertices on every pointer move.
      if (!selecting) return;
      const group = (e.object?.userData?.part as { id?: string } | undefined)?.id ?? null;
      const solids = (e.object?.userData?.solids as ArrayLike<number> | undefined) ?? undefined;
      const hit = e.faceIndex == null ? null : solidAt(solids, e.faceIndex);
      // Same resolution as the click, so what lights up is what you will get.
      const part = group === null ? null : hit === null ? group : solidId(group, hit);
      setHovered((prev) => (prev === part ? prev : part));
    },
    [selecting],
  );
  const clearHover = useCallback(() => setHovered(null), []);

  // Leaving Select drops the hover, or the last-hovered part stays lit forever.
  useEffect(() => {
    if (!selecting) setHovered(null);
  }, [selecting]);

  const glConfig = useMemo(
    () => ({
      antialias: true,
      alpha: true,
      // Required to read pixels back after a render. Without it the buffer is
      // already cleared by the time an export tries to grab the frame.
      preserveDrawingBuffer: true,
      toneMapping: THREE.ACESFilmicToneMapping,
      toneMappingExposure: DEFAULT_LIGHTING.exposure,
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
        onPointerMissed={handleBackgroundMiss}
      >
        {/*
          Two real cameras, not one faked with a long lens. Swapping the default
          re-points OrbitControls at the new one; `key` forces a fresh instance
          so drei cannot keep the old projection alive.
        */}
        {cameraSettings.projection === "orthographic" ? (
          <OrthographicCamera key="ortho" makeDefault position={[0, 0, 5]} />
        ) : (
          <PerspectiveCamera
            key="persp"
            makeDefault
            fov={cameraSettings.fov}
            position={[0, 0, 5]}
          />
        )}

        {/*
          The rig, from the light list.

          These were five hardcoded elements, so the rig was whatever had been
          typed and nothing could be added, moved or switched off. The list is
          seeded with exactly those five, so the default render is unchanged.
        */}
        <LightRig lights={lights} fit={fit} shadows={shadows} debug={debugLights} />

        {/*
          `gl` only takes an initial exposure at construction — it is not a
          prop that stays wired up, so the slider in Environment moved state
          and nothing else. This is the only thing that ever writes it after.
        */}
        <ExposureSync exposure={lighting.exposure} />

        {/*
          What the metal reflects. The stones do NOT use this unless the gem
          environment is left shared — their shader samples its own map.
        */}
        <Environment
          preset={(environmentById(lighting.environment).preset ?? "warehouse") as "warehouse"}
          /*
           * Rotating the environment moves every reflection, which on a metal
           * band is where the highlight sits — most of whether a render reads
           * as composed. Only Y: tipping an environment sideways puts the
           * horizon on a diagonal and nothing looks photographed.
           */
          environmentRotation={[0, lighting.environmentRotation, 0]}
          environmentIntensity={lighting.environmentIntensity}
        />

        {dimensions.showOnCanvas && fit && (
          <DimensionOverlay fit={fit} scale={dimensionScale} summary={dimensionSummary} />
        )}

        <Suspense fallback={null}>
          {/* Tap anywhere on the piece to orbit and zoom around that spot. */}
          {/*
            The group an object move drives.

            A ref rather than state: it is written every frame, and putting it
            through React would re-render the whole viewport sixty times a
            second to move one transform.
          */}
          <group
            ref={pieceRef}
            onClick={handleModelTap}
            onPointerMove={handleHover}
            onPointerOut={clearHover}
          >
            {source === "glb" && (
              <GLBModel
                key={product.id}
                url={product.glbUrl}
                finish={finish}
                onFit={handleFit}
                camera={cameraSettings}
                lighting={lighting}
                stoneColors={stoneColors}
                metalOverrides={metalOverrides}
                gemOverrides={gemOverrides}
                prongHeights={prongHeights}
                onStones={onStones}
                onParts={handleParts}
                stamps={stamps}
                stampFont={stampFont}
                selectedStampId={selectedStampId}
              />
            )}
            {source === "fallback" && (
              <FallbackModel
                finish={finish}
                onFit={handleFit}
                camera={cameraSettings}
                lighting={lighting}
                stoneColors={stoneColors}
                metalOverrides={metalOverrides}
                gemOverrides={gemOverrides}
                prongHeights={prongHeights}
                onStones={onStones}
                onParts={handleParts}
                stamps={stamps}
                stampFont={stampFont}
                selectedStampId={selectedStampId}
              />
            )}
            {source === "object" && product.object && (
              <ObjectModel
                key={product.id}
                object={product.object}
                finish={finish}
                onFit={handleFit}
                camera={cameraSettings}
                lighting={lighting}
                stoneColors={stoneColors}
                metalOverrides={metalOverrides}
                gemOverrides={gemOverrides}
                prongHeights={prongHeights}
                onStones={onStones}
                onParts={handleParts}
                stamps={stamps}
                stampFont={stampFont}
                selectedStampId={selectedStampId}
              />
            )}
          </group>
        </Suspense>

        {/*
          Scaled to the piece, which is normalised to a unit sphere on load — a
          fixed-size grid is either invisible around a ring or swallows a
          necklace. `fadeDistance` keeps it from drawing to the horizon.
        */}
        {fit && showGrid && (
          <Grid
            position={[0, groundY(fit.halfHeight, fit.radius).shadow, 0]}
            args={[fit.radiusXZ * 20, fit.radiusXZ * 20]}
            cellSize={fit.radiusXZ * 0.5}
            sectionSize={fit.radiusXZ * 2.5}
            cellThickness={0.6}
            sectionThickness={1}
            fadeDistance={fit.radius * 28}
            fadeStrength={1.5}
            infiniteGrid={false}
            followCamera={false}
          />
        )}

        {selected && <SelectionHighlight parts={partList} selected={selected} hovered={hovered} />}

        {fit && ground.enabled && <Ground fit={fit} settings={ground} />}

        {/*
          Two shadow mechanisms, and they are genuinely different things.

          Contact is a blurred render of the silhouette from below: cheap,
          always plausible, and unable to show the SHAPE of anything. It is what
          every render of this product has used, so it stays the default —
          switching the mechanism restyles work a client may already have
          approved, which is the user's call to make, not ours.

          Directional is a real shadow camera, driven by whichever light is the
          caster. It throws the actual outline of a shank across the ground.
        */}
        {fit && shadows.enabled && shadows.mode === "contact" && (
          // Sit the shadow just under the piece rather than under its
          // bounding sphere, so a wide, flat necklace isn't floating.
          <ContactShadows
            position={[0, groundY(fit.halfHeight, fit.radius).shadow, 0]}
            opacity={shadows.opacity}
            scale={fit.radiusXZ * shadows.spread}
            blur={shadows.blur}
            far={fit.radius * 4}
          />
        )}

        {/*
          A real cast shadow needs something to land on. The ground plane is
          optional, so this is a receiver that only exists in directional mode —
          without it the shadow falls into empty space and nothing shows, which
          reads as the mode being broken.
        */}
        {fit && shadows.enabled && shadows.mode === "directional" && !ground.enabled && (
          <mesh
            position={[0, groundY(fit.halfHeight, fit.radius).ground, 0]}
            rotation={[-Math.PI / 2, 0, 0]}
            receiveShadow
          >
            <planeGeometry args={[fit.radiusXZ * 30, fit.radiusXZ * 30]} />
            <shadowMaterial opacity={shadows.opacity} />
          </mesh>
        )}

        <AnimationRig
          preset={animation}
          objectMove={objectMove}
          object={pieceRef.current}
          playing={animationPlaying}
          seconds={animationSeconds}
          fit={fit}
          settings={cameraSettings}
          onProgress={onAnimationProgress}
        />

        <Framing
          fit={fit}
          settings={cameraSettings}
          onMoved={onCameraMoved}
          resetSignal={resetSignal}
          controlsRef={controlsRef}
        />
        {/* `piece` lets an export play an object move and put the piece back
            afterwards, rather than leaving it wherever the last frame was. */}
        <StudioRig
          fit={fit}
          camera={cameraSettings}
          apiRef={studio}
          controlsRef={controlsRef}
          piece={pieceRef}
        />
        <FocusRig focus={focus} controlsRef={controlsRef} onArrived={clearFocus} />
        <InteractionQuality controlsRef={controlsRef} />
        {/*
          Bloom was written, tuned and given a panel, and then never mounted.
          Nothing drew through the composer, so every control in Post moved a
          number that reached no pixel — which is why the highlights on a stone
          were the size of the stone and no larger. A real diamond blows out
          the sensor around each flash, and that halo is most of what makes a
          photograph of one look like a photograph.
        */}
        {post && <BloomRig settings={post} onRenderer={setSceneRenderer} />}
        <PickAcceleration />
        {/*
          Bottom-left orientation ball, and a way to snap to an axis.

          Its margin is larger on a phone: at 64px the ball sat underneath the
          toolbar, which shares that corner once the panel is a sheet rather
          than a column beside the viewport.
        */}
        <GizmoHelper alignment="bottom-left" margin={compact ? [52, 108] : [64, 64]}>
          <GizmoViewport axisColors={["#d15b5b", "#7bbd6a", "#5b83d1"]} labelColor="#ffffff" />
        </GizmoHelper>

        {/*
          No `autoRotate`.
          
          The viewer used to open spinning, with no way to stop it once the
          duplicate Pause button was removed — and a piece that turns the moment
          it loads is a demo, not a tool: it moves while you are trying to read
          a setting. Spinning is a deliberate choice now, made by picking the
          Turntable move in Animation, which drives the camera along the same
          path the video export renders.
        */}
        <OrbitControls
          ref={controlsRef}
          enabled={!locked}
          enableDamping
          dampingFactor={0.06}
          enablePan
          zoomToCursor
          makeDefault
        />
      </Canvas>

      {!fit && !hideLoader && <LoadingOverlay />}
    </div>
  );
}
