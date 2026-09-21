/*
 * A turntable that never stops turning.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Givara's viewer feels the way it does because it uses OrbitControls: a drag
 * sideways yaws, a drag down tilts, and the easing carries the motion on after
 * the pointer lifts. That is a two-angle turntable, and the constraint is what
 * makes it feel controlled. A trackball, tried here first, has no up-axis and
 * maps a drag onto whichever screen axis the gesture happened to follow — it
 * rotates without limit but rolls the piece as a side effect, and that
 * arbitrariness reads as wobble.
 *
 * But OrbitControls cannot go over the top. It stores the camera as spherical
 * `(radius, phi, theta)` and every update ends with:
 *
 *     spherical.phi = clamp( phi, minPolarAngle, maxPolarAngle );
 *     spherical.makeSafe();          // pins phi into [EPS, PI - EPS]
 *
 * `makeSafe` is not a tunable being unhelpful. A spherical angle really is
 * degenerate at the poles: there `lookAt`'s view direction is parallel to the
 * up vector, so the roll of the frame is undefined and the image snaps to an
 * arbitrary rotation. The clamp stops the camera ever reaching the place where
 * the maths has no answer. No option turns it off because turning it off
 * breaks the model.
 *
 * So this drops the model rather than the guard. The camera's pose is built
 * directly as a quaternion:
 *
 *     q = Ry( yaw ) * Rx( pitch )          // THREE.Euler order "YXZ"
 *     position   = target + q * (0, 0, radius)
 *     quaternion = q
 *
 * There is no up vector anywhere in that, so there is no pole and nothing to
 * clamp. `pitch` is an ordinary unbounded number: at PI the piece has rolled
 * fully over and is upside down, at 2PI it is back where it started, and it
 * passes through both without a discontinuity.
 *
 * EVERYTHING ELSE IS OrbitControls', VALUE FOR VALUE — the same pixels-to-
 * radians conversion against `clientHeight`, the same `rotateSpeed`
 * multiplier, the same damped accumulate-and-decay, the same `0.95 ^
 * zoomSpeed` dolly. That is deliberate: the feel is the point, and it is the
 * clamp alone that had to go. The equivalence is asserted in
 * `tests/test-turntable.mjs`.
 */
import * as THREE from "three";

interface EventMap {
  start: object;
  end: object;
  change: object;
}

/** A live pointer, in client coordinates. */
interface Pointer {
  x: number;
  y: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * The one controls object allowed to drive each camera.
 *
 * Only ever one SHOULD exist, and yet several did: measured on a running dev
 * server, six were updating the same camera every frame, five of them stale
 * leftovers still holding their opening radius of 5. They took turns writing
 * the camera, so the piece snapped back to 5 units out — reading as "it got
 * smaller when I touched it" — and each one re-derived its angles from another
 * one's write, which is what made rotation judder and refuse to pass upside
 * down.
 *
 * Anything can produce a duplicate: a hot reload, React's double-mount in
 * development, a camera swapped mid-render. Rather than chase each source, one
 * instance holds the camera and every other is inert, so two can never fight
 * over one camera whatever created them.
 *
 * The claim is made on MOUNT, not in the constructor. React may build an
 * instance and throw it away — `useMemo` is not a guarantee — and a claim from
 * the constructor let a discarded object take the camera and silence the live
 * one, which stopped the viewer moving at all. Only a mounted component calls
 * `claim`, and it gives the camera back when it unmounts.
 */
const driving = new WeakMap<THREE.Camera, object>();

export class TurntableControls extends THREE.EventDispatcher<EventMap> {
  readonly object: THREE.Camera;
  readonly domElement: HTMLElement;

  enabled = true;

  /** The point orbited, and the point the camera always looks at. */
  readonly target = new THREE.Vector3();

  minDistance = 0;
  maxDistance = Infinity;

  /* OrbitControls' defaults, overridden by the caller to Givara's values. */
  rotateSpeed = 1;
  zoomSpeed = 1;
  enableDamping = false;
  dampingFactor = 0.05;
  enableZoom = true;
  enableRotate = true;

  /** Around Y. Unbounded. */
  private yaw = 0;
  /**
   * Around the camera's own X, measured from the equator. Unbounded — this is
   * the whole point of the file. Past +/-PI/2 the piece is overhead or
   * underneath and still turning; at PI it is inverted.
   */
  private pitch = 0;
  private radius = 1;

  /** Pending rotation, consumed a `dampingFactor` at a time. */
  private dYaw = 0;
  private dPitch = 0;
  /** Pending dolly, applied whole — OrbitControls does not damp zoom either. */
  private scale = 1;

  private readonly pointers = new Map<number, Pointer>();
  private pinch = 0;

  private readonly q = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly offset = new THREE.Vector3();
  /**
   * The position this last wrote.
   *
   * The angles above are the source of truth, which means anything else that
   * moves the camera — a view preset, a frame of an animation, the axis gizmo
   * — would be overwritten on the next update. Comparing against this detects
   * that and re-derives the angles from wherever the camera now is, so those
   * callers keep working without having to know this class exists.
   */
  private readonly written = new THREE.Vector3();

  constructor(object: THREE.Camera, domElement: HTMLElement) {
    super();
    this.object = object;
    this.domElement = domElement;
    // Without this a drag on a touch screen scrolls the page instead.
    this.domElement.style.touchAction = "none";

    domElement.addEventListener("pointerdown", this.onPointerDown);
    domElement.addEventListener("pointermove", this.onPointerMove);
    domElement.addEventListener("pointerup", this.onPointerUp);
    domElement.addEventListener("pointercancel", this.onPointerUp);
    domElement.addEventListener("wheel", this.onWheel, { passive: false });

    this.syncFromCamera();
    /*
     * Seeded from the camera, NOT left at NaN.
     *
     * `distanceToSquared` against NaN is NaN, and `NaN > 1e-12` is false — so
     * with a NaN seed the very first update skipped the check and wrote the
     * camera back to wherever this was constructed. That is the framing effect
     * placing the camera and being overruled a frame later, which is the piece
     * appearing at one size and then jumping to another.
     */
    this.written.copy(object.position);
  }

  /**
   * Whether this instance is the one driving its camera.
   *
   * An unclaimed camera counts as available, so a lone instance works before
   * its component has mounted — the framing effect runs in that window.
   */
  private get active(): boolean {
    const holder = driving.get(this.object);
    return holder === undefined || holder === this;
  }

  /** Taken on mount: this instance, and no other, now drives the camera. */
  claim(): void {
    driving.set(this.object, this);
  }

  /** Given back on unmount, so the next mount can take it. */
  release(): void {
    if (driving.get(this.object) === this) driving.delete(this.object);
  }

  dispose(): void {
    this.release();
    const el = this.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("pointercancel", this.onPointerUp);
    el.removeEventListener("wheel", this.onWheel);
    this.pointers.clear();
  }

  /**
   * Adopt whatever pose the camera is in now, WITHOUT losing the winding.
   *
   * A position does not name one (pitch, yaw). Both
   *
   *     ( p, y )      and      ( PI - p, y + PI )
   *
   * put the camera in the same place, and so does either plus any whole number
   * of turns. `asin` only ever answers in [-PI/2, PI/2], so taking it at face
   * value throws away which way round the piece had been wound.
   *
   * That is not academic: it was the "flickers and will not move when upside
   * down" bug. Once the pitch was past vertical, every sync snapped it back to
   * the canonical solution and flipped the yaw by PI — the piece jumped to its
   * mirror image, the next drag wound it out again, and it juddered on the
   * spot instead of turning over.
   *
   * So all the equivalent solutions are generated and the one nearest the
   * current angles wins. A sync then costs nothing when the camera has not
   * really moved, and stays continuous when it has.
   */
  private syncFromCamera(): void {
    this.offset.copy(this.object.position).sub(this.target);
    this.radius = this.offset.length() || 1;

    const base = Math.asin(clamp(-this.offset.y / this.radius, -1, 1));
    const yaw = Math.atan2(this.offset.x, this.offset.z);
    const TAU = Math.PI * 2;

    let bestPitch = base;
    let bestYaw = yaw;
    let bestCost = Infinity;

    // The two families of solution, each wound to the turn nearest the current
    // pitch — so a camera left upside down is read back as upside down.
    for (const [pitch, mirrored] of [
      [base, false],
      [Math.PI - base, true],
    ] as const) {
      const wound = pitch + TAU * Math.round((this.pitch - pitch) / TAU);
      const cost = Math.abs(wound - this.pitch);
      if (cost >= bestCost) continue;
      bestCost = cost;
      bestPitch = wound;
      const y = mirrored ? yaw + Math.PI : yaw;
      bestYaw = y + TAU * Math.round((this.yaw - y) / TAU);
    }

    this.pitch = bestPitch;
    this.yaw = bestYaw;
  }

  update(): void {
    // A superseded instance does nothing at all — see `driving`.
    if (!this.active) return;

    if (this.object.position.distanceToSquared(this.written) > 1e-12) {
      this.syncFromCamera();
    }

    if (this.enableDamping) {
      this.yaw += this.dYaw * this.dampingFactor;
      this.pitch += this.dPitch * this.dampingFactor;
    } else {
      this.yaw += this.dYaw;
      this.pitch += this.dPitch;
    }

    this.radius = clamp(this.radius * this.scale, this.minDistance, this.maxDistance);
    this.scale = 1;

    // The pose, with no up vector and therefore no pole. "YXZ" composes as
    // Ry(yaw) * Rx(pitch), which is the turntable: yaw about world Y, pitch
    // about the camera's own X.
    this.euler.set(this.pitch, this.yaw, 0, "YXZ");
    this.q.setFromEuler(this.euler);

    this.offset.set(0, 0, this.radius).applyQuaternion(this.q);
    this.object.position.copy(this.target).add(this.offset);
    this.object.quaternion.copy(this.q);
    // Kept consistent for everything that reads it — the export rig snapshots
    // it, and the gizmo draws from it.
    this.object.up.set(0, 1, 0).applyQuaternion(this.q);

    if (this.enableDamping) {
      this.dYaw *= 1 - this.dampingFactor;
      this.dPitch *= 1 - this.dampingFactor;
    } else {
      this.dYaw = 0;
      this.dPitch = 0;
    }

    this.written.copy(this.object.position);
    this.dispatchEvent({ type: "change" });
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.enabled || !this.active) return;
    if (this.pointers.size === 0) {
      this.domElement.setPointerCapture(event.pointerId);
      this.dispatchEvent({ type: "start" });
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 2) this.pinch = this.pinchDistance();
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.enabled || !this.active) return;
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;

    const prevX = pointer.x;
    const prevY = pointer.y;
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (this.pointers.size === 1) {
      if (!this.enableRotate) return;
      /*
       * OrbitControls' conversion, unchanged: a drag of the full canvas
       * HEIGHT is one full turn, on both axes — height for the horizontal too,
       * so the piece turns at the same rate whatever the window's shape.
       */
      const height = this.domElement.clientHeight || 1;
      const dx = (event.clientX - prevX) * this.rotateSpeed;
      const dy = (event.clientY - prevY) * this.rotateSpeed;
      this.dYaw -= (2 * Math.PI * dx) / height;
      this.dPitch -= (2 * Math.PI * dy) / height;
      /*
       * Applied here and not left to the next frame, which is what
       * OrbitControls does (`scope.update()` closes every one of its input
       * handlers) and is the whole of why it feels immediate.
       *
       * Damping consumes `dampingFactor` of the pending movement per update.
       * Updating only once a frame therefore moves 6% of a drag per frame and
       * the piece visibly trails the pointer. A mouse or trackpad reports far
       * more often than the display refreshes, so stepping on each report
       * instead lets the camera keep up with the hand while still easing out
       * after it stops.
       */
      this.update();
      return;
    }

    if (this.pointers.size === 2 && this.enableZoom) {
      const distance = this.pinchDistance();
      if (this.pinch > 0 && distance > 0) this.scale *= this.pinch / distance;
      this.pinch = distance;
      this.update();
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    this.pinch = 0;
    if (this.pointers.size === 0) {
      if (this.domElement.hasPointerCapture(event.pointerId)) {
        this.domElement.releasePointerCapture(event.pointerId);
      }
      this.dispatchEvent({ type: "end" });
    }
  };

  private onWheel = (event: WheelEvent): void => {
    if (!this.enabled || !this.enableZoom || !this.active) return;
    event.preventDefault();
    const step = Math.pow(0.95, this.zoomSpeed);
    this.scale *= event.deltaY < 0 ? step : 1 / step;
    // Same reason as the drag above: OrbitControls updates on the event.
    this.update();
  };

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
}
