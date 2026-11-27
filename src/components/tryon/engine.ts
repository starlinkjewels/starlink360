import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GlintPass } from "./sparkle";
import {
  BANGLE_BACK,
  BRACELET_BACK,
  FACE,
  FINGERS,
  HAND,
  POSE,
  earAnchor,
  headPose,
  mapDirs,
  mapPoints,
  neckAnchor,
  rightInImageFromLabel,
  ringAnchor,
  dot,
  wristAnchor,
  type Anchor,
  type Finger,
  type Pt,
  type StageFrame,
} from "./anchors";
import { HandednessVote, LandmarkFilter } from "./filters";
import {
  StoneMaterials,
  UNIT_MM,
  assignOccluders,
  buildPieces,
  disposePiece,
  metalMaterial,
  occluderMaterial,
  type BuiltPiece,
  type ChainLength,
  type Kit,
} from "./jewelry";
import { categoryById, type Category, type TrackerKind } from "./catalog";
import { loadTracker, type Tracker } from "./landmarkers";
import { environmentById } from "@/components/jewelry/lighting";
import { loadGemPhoto } from "@/components/jewelry/gemStudio";
import { backdropById, backdropCss } from "./backdrops";

/*
 * The try-on loop: camera → MediaPipe → anchors → three.js, every frame.
 *
 * Plain three.js rather than react-three-fiber, because the render must be in
 * lock-step with the detection result for the same video frame. A declarative
 * scene updated through React state would draw the jewellery one frame behind
 * the hand, which reads as the ring sliding on the finger.
 */

export interface TryOnConfig {
  category: Category;
  style: string;
  metalId: string;
  gemId: string;
  carat: number;
  /** Size multiplier on top of the measured fit, 0.8–1.2. */
  fit: number;
  finger: Finger;
  chain: ChainLength;
  /** Shows the occluders, for calibrating the anchors. */
  debug?: boolean;
  /** Star glints on the brightest flashes. Off is the clean product-photo look. */
  sparkle?: boolean;
  /** Ground behind the piece in the 3D view; see backdrops.ts. */
  backdrop?: string;
}

export type TryOnPhase =
  "idle" | "camera" | "models" | "searching" | "tracking" | "preview" | "error";

export interface TryOnStatus {
  phase: TryOnPhase;
  message?: string;
  /** Coaching shown while tracking, e.g. "turn your hand". */
  hint?: string;
}

/** After this long without a detection, the piece is hidden. */
const LOST_MS = 220;
const FOV = 30;
/*
 * What the METAL reflects: the white studio capture, large and even, which
 * gives polished gold the soft warm gradients of product photography. The
 * punchier small studio put hard black bands across every band. Stones see
 * their own purpose-built room instead (gemStudio.ts).
 */
const ENV_URL = "/env/white_studio_02_2k.hdr";
const SPARKLE_STRENGTH = 0.3;

interface SwingState {
  dir: THREE.Vector3;
  vel: THREE.Vector3;
  lastPivot: THREE.Vector3 | null;
  lastPivotVel: THREE.Vector3;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const vec = (p: Pt) => new THREE.Vector3(p.x, p.y, p.z);

interface PreviewFit {
  centre: THREE.Vector3;
  radius: number;
  /** The feature stone (centre stone, drop, pendant): where a zoom heads. */
  feature: THREE.Vector3;
}

/** Bounding sphere of a piece in its own units, ignoring occluders. */
function measure(root: THREE.Object3D): PreviewFit {
  const box = new THREE.Box3();
  let feature: THREE.Vector3 | null = null;
  let featureSize = 0;
  const saved = { p: root.position.clone(), q: root.quaternion.clone(), s: root.scale.clone() };
  root.position.set(0, 0, 0);
  root.quaternion.identity();
  root.scale.setScalar(1);
  root.updateMatrixWorld(true);
  const part = new THREE.Box3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || o.userData.occluder) return;
    const inst = o as THREE.InstancedMesh;
    // A lone stone is a feature stone; the biggest one is where a zoom goes.
    if (inst.isInstancedMesh && o.userData.stones && inst.count === 1) {
      const size = inst.getWorldScale(new THREE.Vector3()).x;
      if (size > featureSize) {
        featureSize = size;
        feature = inst.getWorldPosition(new THREE.Vector3());
      }
    }
    if (inst.isInstancedMesh) {
      inst.computeBoundingBox();
      if (inst.boundingBox) part.copy(inst.boundingBox).applyMatrix4(inst.matrixWorld);
    } else {
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      part.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
    }
    box.union(part);
  });
  root.position.copy(saved.p);
  root.quaternion.copy(saved.q);
  root.scale.copy(saved.s);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  return {
    centre: sphere.center,
    radius: Math.max(1e-6, sphere.radius),
    feature: feature ?? sphere.center.clone(),
  };
}

const MIN_ZOOM = 0.7;
const MAX_ZOOM = 7;
/** Auto-turn resumes this long after the visitor last touched the piece. */
const IDLE_RESUME_MS = 2500;

function cameraError(e: unknown): string {
  const name = (e as { name?: string })?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera access was blocked. Allow the camera for this site in your browser settings, then try again.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "No camera was found on this device.";
  if (name === "NotReadableError")
    return "The camera is being used by another app. Close it and try again.";
  return (e as Error)?.message || "The camera could not be started.";
}

export class TryOnEngine {
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private glints: GlintPass;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10000);
  private resolution = new THREE.Vector2(1, 1);
  private w = 1;
  private h = 1;

  private stream: MediaStream | null = null;
  private facing: "user" | "environment" = "user";
  private mirrored = true;

  private env: THREE.DataTexture | null = null;
  private envTarget: THREE.WebGLRenderTarget | null = null;
  private stones: StoneMaterials | null = null;
  private kit: Kit | null = null;
  private pieces: BuiltPiece[] = [];
  private swings: (SwingState | null)[] = [];
  private pieceKey = "";
  private occMat: THREE.Material;
  private extraOccluders: THREE.Mesh[] = [];
  private headOccluder: THREE.Mesh;

  private cfg: TryOnConfig;
  private tracker: Tracker | null = null;
  private trackerKind: TrackerKind | null = null;

  private imgFilter = new LandmarkFilter();
  private worldFilter = new LandmarkFilter({ minCutoff: 1.2, beta: 30, dCutoff: 1 });
  private vote = new HandednessVote();

  private raf = 0;
  private lastVideoTime = -1;
  private lastTs = 0;
  private lastSeen = -Infinity;
  private lastFrame = 0;
  private lost = true;
  private disposed = false;
  private status: TryOnStatus = { phase: "idle" };
  private hint: string | undefined;
  private frameCount = 0;
  private exposure = 1;
  private probe: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver;
  /** Turntable mode: no camera, the piece spins in the middle of the stage. */
  private previewMode = false;
  private previewTime = 0;
  private previewFit: PreviewFit[] = [];
  /** 3D view interaction: zoom factor and a hand-applied turn. */
  private zoom = 1;
  private turn = { yaw: 0, pitch: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; zoom: number } | null = null;
  private lastTouch = -Infinity;
  private detachPointer: (() => void) | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    private readonly onStatus: (s: TryOnStatus) => void,
    initial: TryOnConfig,
  ) {
    this.cfg = initial;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 0);
    /*
     * ACES Filmic at exposure 1, as the leading commercial real-time jewellery
     * viewers run it. Its contrast curve deepens the dark facets and rolls the
     * brightest flashes off smoothly, which is most of the crisp, punchy look
     * of a photographed stone. Neutral was tried: truer colour, flatter stones.
     */
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    /*
     * Render → star glints → tone mapping. The frame stays linear HDR until
     * OutputPass, so the glint pass can tell a flash at 20× white from a
     * merely white facet. Multisampled, because the composer bypasses the
     * canvas's own antialiasing.
     */
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      samples: 4,
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.glints = new GlintPass();
    this.composer.addPass(this.glints);
    this.composer.addPass(new OutputPass());
    this.applyLook();

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(0.4, 1, 1);
    const fill = new THREE.DirectionalLight(0xfff3e0, 0.5);
    fill.position.set(-1, 0.3, 0.6);
    this.scene.add(key, fill);

    this.occMat = occluderMaterial(!!initial.debug);
    this.headOccluder = this.makeOccluder(new THREE.SphereGeometry(1, 32, 24));
    for (let i = 0; i < 3; i++)
      this.extraOccluders.push(this.makeOccluder(new THREE.CylinderGeometry(1, 1, 1, 20)));

    // Console access while developing: window.__tryon
    if (import.meta.env.DEV) (window as unknown as { __tryon?: TryOnEngine }).__tryon = this;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
  }

  private makeOccluder(geo: THREE.BufferGeometry): THREE.Mesh {
    const m = new THREE.Mesh(geo, this.occMat);
    m.renderOrder = -1;
    m.visible = false;
    m.frustumCulled = false;
    this.scene.add(m);
    return m;
  }

  /* -------------------------------------------------------------- setup */

  private setStatus(next: TryOnStatus) {
    const s = this.status;
    if (s.phase === next.phase && s.message === next.message && s.hint === next.hint) return;
    this.status = next;
    this.onStatus(next);
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    const dpr = this.renderer.getPixelRatio();
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.resolution.set(w * dpr, h * dpr);
    // Camera distance chosen so the z = 0 plane maps 1:1 onto stage pixels.
    const d = h / 2 / Math.tan((FOV * Math.PI) / 360);
    this.camera.aspect = w / h;
    this.camera.position.set(0, 0, d);
    this.camera.near = d * 0.1;
    this.camera.far = d * 4;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  async start(): Promise<void> {
    try {
      this.setStatus({ phase: "camera" });
      await Promise.all([this.openCamera(this.facing), this.loadEnvironment()]);
      this.rebuild();
      this.lastFrame = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.frame);
      await this.ensureTracker();
    } catch (e) {
      if (!this.disposed) this.setStatus({ phase: "error", message: cameraError(e) });
    }
  }

  private async openCamera(facing: "user" | "environment") {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        window.isSecureContext
          ? "This browser cannot open the camera."
          : "The camera needs a secure connection. Open this page over https.",
      );
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
      },
    });
    if (this.disposed) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    this.facing = facing;
    // Front cameras are shown as a mirror, which is what people expect.
    const settings = stream.getVideoTracks()[0]?.getSettings();
    this.mirrored = (settings?.facingMode ?? facing) !== "environment";
    this.video.style.transform = this.mirrored ? "scaleX(-1)" : "none";
    this.video.srcObject = stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    this.lastVideoTime = -1;
    this.resetTracking();
  }

  async switchCamera(): Promise<void> {
    const next = this.facing === "user" ? "environment" : "user";
    try {
      await this.openCamera(next);
    } catch (e) {
      // Desktop machines usually have one camera; stay on it.
      await this.openCamera(this.facing).catch(() => undefined);
      throw e;
    }
  }

  private async loadEnvironment() {
    if (this.env) return;
    const tex = await new HDRLoader().loadAsync(ENV_URL);
    if (this.disposed) {
      tex.dispose();
      return;
    }
    tex.mapping = THREE.EquirectangularReflectionMapping;
    this.env = tex;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTarget = pmrem.fromEquirectangular(tex);
    pmrem.dispose();
    this.scene.environment = this.envTarget.texture;
    // 1.5, as the leading commercial viewers run it: polished metal under ACES
    // needs it to read light and creamy rather than dark and mirror-like.
    this.scene.environmentIntensity = 1.5;
    /*
     * Stones trace into the same real studio capture, with the gem tuning the
     * studio viewer uses for it (lighting.ts, white-studio `gemTune`). The
     * try-on camera never moves, so this is already the camera-locked
     * "oriented lighting" the studio sets up explicitly.
     */
    const gemRoom = await loadGemPhoto(ENV_URL);
    if (this.disposed) return;
    this.stones = new StoneMaterials(gemRoom, environmentById("white-studio").gemTune);
  }

  private async ensureTracker() {
    const kind = categoryById(this.cfg.category).tracker;
    if (this.trackerKind === kind && this.tracker) return;
    this.trackerKind = kind;
    this.tracker = null;
    this.resetTracking();
    this.setStatus({ phase: "models" });
    try {
      const t = await loadTracker(kind);
      // The category may have changed while the model downloaded.
      if (this.disposed || this.trackerKind !== kind) return;
      this.tracker = t;
      this.setStatus({ phase: "searching" });
    } catch (e) {
      if (this.trackerKind === kind) {
        this.trackerKind = null;
        this.setStatus({
          phase: "error",
          message:
            "The tracking model could not be downloaded. Check your connection and try again.",
        });
      }
      console.error("[try-on] tracker failed", e);
    }
  }

  setConfig(cfg: TryOnConfig): void {
    const debugChanged = !!cfg.debug !== !!this.cfg.debug;
    const categoryChanged = cfg.category !== this.cfg.category;
    this.cfg = cfg;
    if (debugChanged) {
      this.occMat.dispose();
      this.occMat = occluderMaterial(!!cfg.debug);
      for (const m of [this.headOccluder, ...this.extraOccluders]) m.material = this.occMat;
      this.pieces.forEach((p) => assignOccluders(p, this.occMat));
    }
    this.applyLook();
    if (this.env) this.rebuild();
    if (categoryChanged && !this.previewMode) {
      this.resetTracking();
      if (this.stream) void this.ensureTracker();
    }
  }

  /* ------------------------------------------------------------- pieces */

  private rebuild() {
    if (!this.stones) return;
    const { category, style, metalId, gemId, carat, chain } = this.cfg;
    const key = JSON.stringify([category, style, metalId, gemId, carat, chain]);
    if (key === this.pieceKey) return;
    this.pieceKey = key;

    const wasVisible = this.pieces.some((p) => p.root.visible);
    for (const p of this.pieces) {
      this.scene.remove(p.root);
      disposePiece(p);
    }
    this.kit?.metal.dispose();
    this.stones.dispose();

    const centre = this.stones.make(gemId);
    this.kit = { metal: metalMaterial(metalId), centre, accent: this.stones.make("diamond") };
    this.pieces = buildPieces({ category, style, carat, chain }, this.kit);
    this.swings = this.pieces.map((p) =>
      p.swing
        ? {
            dir: DOWN.clone(),
            vel: new THREE.Vector3(),
            lastPivot: null,
            lastPivotVel: new THREE.Vector3(),
          }
        : null,
    );
    for (const p of this.pieces) {
      assignOccluders(p, this.occMat);
      p.root.visible = wasVisible && !this.lost;
      this.scene.add(p.root);
    }
    this.previewFit = this.pieces.map((p) => measure(p.root));
    if (this.previewMode) this.setOccludersVisible(false);
  }

  /** Sparkle and, in the 3D view, the backdrop and its shadow. */
  private applyLook() {
    const on = !!this.cfg.sparkle;
    this.glints.enabled = on;
    this.glints.strength = on ? SPARKLE_STRENGTH : 0;
    if (!this.previewMode) return;
    const b = backdropById(this.cfg.backdrop);
    this.container.style.background = backdropCss(b);
    this.renderer.domElement.style.filter = b.shadow;
  }

  private setOccludersVisible(on: boolean) {
    for (const p of this.pieces) p.root.traverse((o) => o.userData.occluder && (o.visible = on));
  }

  /**
   * Shows the piece on a turntable instead of on the body.
   *
   * The fallback when the camera is blocked or missing, so a visitor is never
   * left at a dead end, and a way to inspect a piece up close.
   */
  async startPreview(): Promise<void> {
    this.previewMode = true;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.video.style.visibility = "hidden";
    this.applyLook();
    this.tracker = null;
    this.trackerKind = null;
    try {
      await this.loadEnvironment();
    } catch {
      this.setStatus({ phase: "error", message: "The 3D preview could not load its lighting." });
      return;
    }
    this.pieceKey = "";
    this.rebuild();
    this.setOccludersVisible(false);
    this.hideAll();
    this.lastFrame = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
    this.attachPointer();
    this.setStatus({ phase: "preview" });
  }

  /**
   * Scroll or pinch to zoom, drag to turn, double-click to reset.
   *
   * A close look at the stone is the point of a 3D view; at the framing that
   * fits a whole ring, a 1 ct stone is a few dozen pixels and nobody can see
   * the cut. Zooming in also moves the focus onto the feature stone.
   */
  private attachPointer() {
    if (this.detachPointer) return;
    const el = this.container;
    el.style.touchAction = "none";
    el.style.cursor = "grab";
    const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    const touched = () => (this.lastTouch = performance.now());

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoom = clampZoom(this.zoom * Math.exp(-e.deltaY * 0.0015));
      touched();
    };
    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.zoom };
      }
      el.style.cursor = "grabbing";
      touched();
    };
    const onMove = (e: PointerEvent) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const next = { x: e.clientX, y: e.clientY };
      this.pointers.set(e.pointerId, next);
      if (this.pointers.size === 1) {
        this.turn.yaw += (next.x - prev.x) * 0.008;
        this.turn.pitch = Math.max(
          -1.2,
          Math.min(1.2, this.turn.pitch + (next.y - prev.y) * 0.006),
        );
      } else if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        this.zoom = clampZoom(this.pinch.zoom * (d / Math.max(1, this.pinch.dist)));
      }
      touched();
    };
    const onUp = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      if (!this.pointers.size) el.style.cursor = "grab";
    };
    const onDouble = () => {
      this.zoom = 1;
      this.turn = { yaw: 0, pitch: 0 };
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("dblclick", onDouble);
    this.detachPointer = () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("dblclick", onDouble);
    };
  }

  private placePreview(dt: number) {
    // The turntable holds still while the visitor is handling the piece.
    if (performance.now() - this.lastTouch > IDLE_RESUME_MS) this.previewTime += dt;
    const t = this.previewTime;
    const R = Math.min(this.w, this.h) * 0.3 * this.zoom;
    const cat = this.cfg.category;
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    // Hand-applied turn, on top of whatever the turntable is doing.
    const hand = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(this.turn.pitch, this.turn.yaw, 0),
    );
    // How far the focus has moved from the whole piece onto the feature stone.
    const focus = Math.min(1, Math.max(0, (this.zoom - 1) / 1.5));
    if (cat === "ring" || cat === "bracelet" || cat === "bangle") {
      // Band seen three-quarter on, turning.
      q.setFromEuler(e.set(0.45, 0, 0))
        .multiply(new THREE.Quaternion().setFromAxisAngle(Y_AXIS, t * 0.6))
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
        );
    } else if (cat === "necklace") {
      // As on a bust: slightly from above, a gentle sway.
      q.setFromEuler(e.set(0.28, Math.sin(t * 0.6) * 0.3, 0));
    }
    const pair = this.pieces.length > 1;
    this.pieces.forEach((p, i) => {
      const fit = this.previewFit[i];
      if (!fit) return;
      if (cat === "earrings") {
        // Each earring turned outward the way it sits on a lobe, swaying.
        const side = i === 0 ? -1 : 1;
        q.setFromEuler(e.set(0.1, side * 0.55 + Math.sin(t * 0.7) * 0.35, 0));
      }
      const s = (pair ? R * 0.75 : R) / fit.radius;
      const offset = pair ? (i === 0 ? -1 : 1) * Math.min(R, this.w * 0.22) * 0.7 : 0;
      const rot = hand.clone().multiply(q);
      p.root.quaternion.copy(rot);
      p.root.scale.setScalar(s);
      // Keep the piece (or, zoomed in, its feature stone) centred on screen.
      const target = fit.centre.clone().lerp(fit.feature, focus);
      const c = target.multiplyScalar(s).applyQuaternion(rot);
      p.root.position.set(offset - c.x, -c.y, -c.z);
      p.root.visible = true;
    });
  }

  private hideAll() {
    for (const p of this.pieces) p.root.visible = false;
    this.headOccluder.visible = false;
    for (const o of this.extraOccluders) o.visible = false;
  }

  private resetTracking() {
    this.imgFilter.reset();
    this.worldFilter.reset();
    this.vote.reset();
    this.lost = true;
    this.lastSeen = -Infinity;
    this.swings.forEach((s) => {
      if (s) {
        s.dir.copy(DOWN);
        s.vel.set(0, 0, 0);
        s.lastPivot = null;
      }
    });
    this.hideAll();
  }

  /** Puts a piece on its anchor. Rotation is lightly slerped on top of the landmark filter. */
  private place(obj: THREE.Object3D, a: Anchor, scale: number, extra?: THREE.Quaternion) {
    tmpM.makeBasis(vec(a.xAxis), vec(a.yAxis), vec(a.zAxis));
    tmpQ.setFromRotationMatrix(tmpM);
    if (extra) tmpQ.multiply(extra);
    if (!obj.visible || this.lost) obj.quaternion.copy(tmpQ);
    else obj.quaternion.slerp(tmpQ, 0.7);
    obj.position.set(a.position.x, a.position.y, a.position.z);
    obj.scale.setScalar(Math.max(1e-3, scale));
    obj.visible = true;
  }

  private cylinderBetween(mesh: THREE.Mesh, a: Pt, b: Pt, radius: number) {
    const A = vec(a);
    const B = vec(b);
    const d = B.clone().sub(A);
    const len = d.length();
    if (len < 1e-3) {
      mesh.visible = false;
      return;
    }
    mesh.position.copy(A).add(B).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(Y_AXIS, d.divideScalar(len));
    mesh.scale.set(radius, len * 1.1, radius);
    mesh.visible = true;
  }

  /* --------------------------------------------------------------- loop */

  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const v = this.video;

    if (
      this.tracker &&
      v.readyState >= 2 &&
      v.videoWidth > 0 &&
      v.currentTime !== this.lastVideoTime
    ) {
      this.lastVideoTime = v.currentTime;
      // detectForVideo needs strictly increasing timestamps.
      let ts = performance.now();
      if (ts <= this.lastTs) ts = this.lastTs + 1;
      this.lastTs = ts;
      try {
        if (this.detect(ts)) {
          this.lastSeen = ts;
          this.lost = false;
        }
      } catch (e) {
        console.warn("[try-on] detection failed", e);
      }
    }

    if (this.tracker) {
      if (performance.now() - this.lastSeen > LOST_MS) {
        if (!this.lost) this.resetTracking();
        this.setStatus({ phase: "searching", hint: this.hint });
      } else {
        this.setStatus({ phase: "tracking", hint: this.hint });
      }
    }

    if (this.previewMode) this.placePreview(dt);
    this.updateSwings(dt);
    if (!this.previewMode && ++this.frameCount % 20 === 0) this.matchLight();
    this.stones?.twinkle(now / 1000);
    this.composer.render(dt);
  };

  private stageFrame(): StageFrame {
    return {
      stageW: this.w,
      stageH: this.h,
      videoW: this.video.videoWidth,
      videoH: this.video.videoHeight,
      mirrored: this.mirrored,
    };
  }

  /** Runs the tracker on the current frame and places the piece. True if found. */
  private detect(ts: number): boolean {
    const t = this.tracker!;
    const f = this.stageFrame();
    const sec = ts / 1000;
    const { category, fit } = this.cfg;
    this.hint = undefined;

    if (t.kind === "hand") {
      const r = t.task.detectForVideo(this.video, ts);
      const raw = r.landmarks?.[0];
      if (!raw?.length || !this.pieces[0]) return false;
      const label = r.handedness?.[0]?.[0];
      const right = this.vote.push(
        rightInImageFromLabel(label?.categoryName ?? "Right") ? 1 : -1,
        label?.score ?? 0.5,
      );
      const img = mapPoints(f, this.imgFilter.apply(raw, sec));
      const world = r.worldLandmarks?.[0];
      const dirs = world?.length ? mapDirs(f, this.worldFilter.apply(world, sec)) : img;

      if (category === "ring") {
        const a = ringAnchor(img, dirs, this.cfg.finger, right, this.mirrored);
        this.place(this.pieces[0].root, a, a.scale * fit);
        // Neighbouring fingers hide the sides of the band when fingers are together.
        const others = (Object.keys(FINGERS) as Finger[]).filter((k) => k !== this.cfg.finger);
        others.forEach((k, i) => {
          const fd = FINGERS[k];
          this.cylinderBetween(this.extraOccluders[i], img[fd.mcp], img[fd.pip], a.scale * 0.95);
        });
        if (a.dorsalFacing < -0.25)
          this.hint = "Turn the back of your hand to the camera to see the stone";
      } else {
        const back = category === "bangle" ? BANGLE_BACK : BRACELET_BACK;
        const a = wristAnchor(img, dirs, right, this.mirrored, back);
        this.place(this.pieces[0].root, a, a.scale * fit);
        for (const o of this.extraOccluders) o.visible = false;
        if (raw[HAND.WRIST].y > 0.96) this.hint = "Raise your hand so your whole wrist is in view";
      }
      return true;
    }

    if (t.kind === "face") {
      const r = t.task.detectForVideo(this.video, ts);
      const raw = r.faceLandmarks?.[0];
      if (!raw?.length || this.pieces.length < 2) return false;
      const ids = [
        FACE.FOREHEAD,
        FACE.CHIN,
        FACE.NOSE_TIP,
        FACE.SIDE_A,
        FACE.SIDE_B,
        FACE.JAW_A,
        FACE.JAW_B,
      ];
      const filtered = this.imgFilter.apply(
        ids.map((i) => raw[i]),
        sec,
      );
      const mapped = mapPoints(f, filtered);
      const sparse: Pt[] = [];
      ids.forEach((id, k) => (sparse[id] = mapped[k]));
      const head = headPose(sparse);
      (["A", "B"] as const).forEach((side, i) => {
        const piece = this.pieces[i];
        const ear = head.ears[i];
        // Turn each earring a little outward, the way a lobe faces.
        const splay = 0.35 * Math.sign(dot(ear.outward, head.basis.x) || 1);
        this.place(
          piece.root,
          earAnchor(head, side),
          head.width * fit,
          tmpQ.clone().setFromAxisAngle(Y_AXIS, splay),
        );
        piece.root.visible = ear.facing > -0.55;
      });
      // The head, which hides the far earring as you turn.
      const W = head.width;
      tmpM.makeBasis(vec(head.basis.x), vec(head.basis.y), vec(head.basis.z));
      this.headOccluder.quaternion.setFromRotationMatrix(tmpM);
      this.headOccluder.position
        .copy(vec(head.centre))
        .addScaledVector(vec(head.basis.z), -0.05 * W)
        .addScaledVector(vec(head.basis.y), 0.05 * W);
      this.headOccluder.scale.set(0.46 * W, 0.66 * W, 0.6 * W);
      this.headOccluder.visible = true;
      if (Math.abs(head.basis.z.x) > 0.75) this.hint = "Turn a little toward the camera";
      return true;
    }

    // Pose: necklace.
    const r = t.task.detectForVideo(this.video, ts);
    const raw = r.landmarks?.[0];
    if (!raw?.length || !this.pieces[0]) return false;
    const L = raw[POSE.L_SHOULDER];
    const R = raw[POSE.R_SHOULDER];
    if ((L.visibility ?? 1) < 0.5 || (R.visibility ?? 1) < 0.5) {
      this.hint = categoryById("necklace").prompt;
      return false;
    }
    const ids = [POSE.L_SHOULDER, POSE.R_SHOULDER];
    const mapped = mapPoints(f, this.imgFilter.apply([L, R], sec));
    const world = r.worldLandmarks?.[0];
    const sparse: Pt[] = [];
    const sparseDirs: Pt[] = [];
    ids.forEach((id, k) => (sparse[id] = mapped[k]));
    if (world?.length) {
      const wd = mapDirs(
        f,
        this.worldFilter.apply([world[POSE.L_SHOULDER], world[POSE.R_SHOULDER]], sec),
      );
      ids.forEach((id, k) => (sparseDirs[id] = wd[k]));
    }
    const a = neckAnchor(sparse, world?.length ? sparseDirs : null);
    this.place(this.pieces[0].root, a, a.scale * fit);
    if (Math.abs(a.yaw) > 0.9) this.hint = "Face the camera to see the full necklace";
    return true;
  }

  /*
   * Drops and pendants hang under gravity and swing when you move.
   *
   * A damped pendulum per piece, integrated in stage pixels with g scaled by
   * the piece's measured size, so a 12 mm drop swings at a 12 mm drop's
   * natural frequency at any distance from the camera.
   */
  private updateSwings(dt: number) {
    if (dt <= 0) return;
    this.pieces.forEach((piece, i) => {
      const s = this.swings[i];
      const swing = piece.swing;
      if (!s || !swing || !piece.root.visible) return;
      piece.root.updateMatrixWorld(true);
      const pivot = swing.getWorldPosition(new THREE.Vector3());
      const pxPerUnit = piece.root.scale.x;
      const pxPerM = pxPerUnit / (UNIT_MM[this.cfg.category] / 1000);
      const g = 9.81 * pxPerM;
      const L = Math.max(1, (piece.swingLength ?? 0.05) * pxPerUnit);

      const pivotAcc = new THREE.Vector3();
      if (s.lastPivot) {
        const vel = pivot.clone().sub(s.lastPivot).divideScalar(dt);
        pivotAcc.copy(vel).sub(s.lastPivotVel).divideScalar(dt);
        s.lastPivotVel.copy(vel);
        // Tracking noise is not motion; cap what it can do to the pendulum.
        if (pivotAcc.length() > 2.5 * g) pivotAcc.setLength(2.5 * g);
      }
      s.lastPivot = pivot;

      const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / steps;
      for (let k = 0; k < steps; k++) {
        const force = DOWN.clone().multiplyScalar(g).addScaledVector(pivotAcc, -0.6);
        force.addScaledVector(s.dir, -force.dot(s.dir));
        s.vel.addScaledVector(force, h / L);
        s.vel.multiplyScalar(Math.max(0, 1 - 6 * h));
        s.vel.addScaledVector(s.dir, -s.vel.dot(s.dir));
        s.dir.addScaledVector(s.vel, h).normalize();
      }
      // Never further than 70° from hanging straight down.
      if (s.dir.dot(DOWN) < Math.cos((70 * Math.PI) / 180)) {
        s.dir.lerp(DOWN, 0.2).normalize();
        s.vel.multiplyScalar(0.5);
      }
      const parentQ = swing.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
      swing.quaternion.setFromUnitVectors(
        DOWN,
        tmpV.copy(s.dir).applyQuaternion(parentQ).normalize(),
      );
    });
  }

  /** Nudges exposure toward the room's brightness so the piece sits in the scene. */
  private matchLight() {
    const v = this.video;
    if (v.readyState < 2 || !v.videoWidth) return;
    if (!this.probe) {
      const c = document.createElement("canvas");
      c.width = 16;
      c.height = 16;
      this.probe = c.getContext("2d", { willReadFrequently: true });
    }
    const ctx = this.probe;
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4)
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    const lum = sum / (d.length / 4) / 255;
    const target = Math.min(1.25, Math.max(0.72, 0.7 + lum * 0.85));
    this.exposure += (target - this.exposure) * 0.25;
    this.renderer.toneMappingExposure = this.exposure;
  }

  /* ------------------------------------------------------------ capture */

  /** The current frame, video and jewellery composited, as a JPEG. */
  async capture(): Promise<Blob> {
    const dpr = this.renderer.getPixelRatio();
    const W = Math.round(this.w * dpr);
    const H = Math.round(this.h * dpr);
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("Capture is not supported in this browser.");
    const v = this.video;
    const s = Math.max(W / v.videoWidth, H / v.videoHeight);
    const dw = v.videoWidth * s;
    const dh = v.videoHeight * s;
    const backdrop = backdropById(this.cfg.backdrop);
    if (!v.videoWidth) {
      const g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.7);
      g.addColorStop(0, backdrop.stops[0]);
      g.addColorStop(0.55, backdrop.stops[1]);
      g.addColorStop(1, backdrop.stops[2]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.save();
    if (this.mirrored) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    if (v.videoWidth) ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
    // Render and read back in the same task; the drawing buffer is not preserved.
    this.composer.render(0);
    // The on-screen shadow is a CSS filter, which drawImage does not carry.
    if (this.previewMode && backdrop.shadow !== "none") ctx.filter = backdrop.shadow;
    ctx.drawImage(this.renderer.domElement, 0, 0, W, H);
    ctx.filter = "none";
    ctx.font = `${Math.round(15 * dpr)}px "Cormorant Garamond", Georgia, serif`;
    ctx.textAlign = "right";
    const lightGround = this.previewMode && backdrop.light;
    ctx.fillStyle = lightGround ? "rgba(40,30,20,0.7)" : "rgba(255,255,255,0.85)";
    ctx.shadowColor = lightGround ? "rgba(0,0,0,0)" : "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 6 * dpr;
    ctx.fillText("Netram ✦ Virtual Try-On", W - 16 * dpr, H - 16 * dpr);
    return new Promise((resolve, reject) =>
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("Capture failed."))), "image/jpeg", 0.92),
    );
  }

  /* ------------------------------------------------------------ dispose */

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.detachPointer?.();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    for (const p of this.pieces) disposePiece(p);
    this.kit?.metal.dispose();
    this.stones?.dispose();
    this.occMat.dispose();
    this.headOccluder.geometry.dispose();
    this.extraOccluders.forEach((o) => o.geometry.dispose());
    this.envTarget?.dispose();
    this.env?.dispose();
    this.glints.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    // Trackers are cached module-wide on purpose: reopening the page should not
    // download and compile the model again.
  }
}
