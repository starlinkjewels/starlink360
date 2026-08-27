/*
 * The 3D Image Texture backdrop.
 *
 * i3D's own reference screenshots show this control locked behind a paywall
 * in every capture available to this project (a checkbox with a lock badge,
 * always unchecked, never in an active state, never shown in a viewport) — so
 * there is no observable reference for what it actually does on screen. See
 * `docs/phase4-3d-backdrop/AUDIT.md` for the full trail. What follows is a
 * reasoned engineering choice given that gap, not a copy of confirmed
 * behaviour, and the report says so plainly.
 *
 * The one thing the NAME itself commits to is that this is not the existing
 * flat CSS layer: it has to be a real object with real depth. Starlink360's
 * camera orbits a full 360° around the piece (`OrbitControls`, no fixed
 * front), which rules out a plane fixed in world space — at some orbit angle
 * it would show its own back (or, double-sided, a mirrored image), and at
 * others it would sit off to one side rather than "behind" anything. A
 * camera-facing billboard, positioned on the far side of the origin from the
 * camera and re-aimed every frame, is the only one of the options in the brief
 * that stays a coherent backdrop across an unrestricted orbit — so that is
 * what this implements, sized to exactly fill the current view at its depth.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

export interface ImageBackdrop3DProps {
  /** Data URL of the uploaded/preset image. Absent renders nothing. */
  image: string | null;
  /** Bounding-sphere radius of the piece, as a sizing floor. */
  fitRadius: number;
}

const textureCache = new Map<string, THREE.Texture>();

/** Loads (and caches) a texture from a data URL, disposing nothing here — the
 *  cache owns the lifetime; see the effect below for when an entry is retired. */
function loadTexture(url: string): Promise<THREE.Texture> {
  const hit = textureCache.get(url);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        // A photograph, not data: read and displayed as-is, the same
        // assumption the CSS image backdrop makes.
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        textureCache.set(url, tex);
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

export function ImageBackdrop3D({ image, fitRadius }: ImageBackdrop3DProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const { invalidate } = useThree();
  /*
   * One 1×1 plane, resized every frame with `mesh.scale` rather than rebuilt —
   * a fresh `PlaneGeometry` per frame would allocate and dispose a buffer 60
   * times a second for a shape that only ever needed a transform.
   */
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const textureRef = useRef<THREE.Texture | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!image) {
      textureRef.current = null;
      if (materialRef.current) materialRef.current.map = null;
      invalidate();
      return;
    }
    loadTexture(image).then((tex) => {
      if (cancelled) return;
      textureRef.current = tex;
      if (materialRef.current) {
        materialRef.current.map = tex;
        materialRef.current.needsUpdate = true;
      }
      invalidate();
    });
    return () => {
      cancelled = true;
    };
  }, [image, invalidate]);

  /*
   * Retires cache entries nobody references any more.
   *
   * Kept out of the load effect above so a rapid replace → replace → remove
   * (the stress case this phase's brief calls for) cannot dispose a texture
   * that a slower-finishing load is about to hand to the material — the
   * dependency here is the CURRENT image only, and disposal always looks at
   * the PREVIOUS one.
   */
  const prevImage = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevImage.current;
    prevImage.current = image;
    if (!prev || prev === image) return;
    const stale = textureCache.get(prev);
    if (stale) {
      stale.dispose();
      textureCache.delete(prev);
    }
  }, [image]);

  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    if (!mesh || !image) return;

    /*
     * `OrbitControls.target` is recentred to the origin on every fit (see
     * Viewer.tsx), so the direction from the origin to the camera is a safe
     * stand-in for "which way is the camera looking from" without needing the
     * controls ref threaded all the way down here.
     */
    const camPos = camera.position;
    const distFromOrigin = camPos.length();
    const dir = distFromOrigin > 1e-6 ? camPos.clone().normalize() : new THREE.Vector3(0, 0, 1);

    /*
     * Comfortably inside the camera's own far plane (itself already sized off
     * the piece and the current camera settings in `camera.ts`), and always
     * well beyond `OrbitControls.maxDistance` — both scale off the same
     * framing distance, so reading `camera.far` live tracks any FOV/near/far
     * change instead of duplicating that formula here. Floored at a multiple
     * of the piece's own radius so a degenerate near/far pair on a tiny or
     * just-loaded piece cannot collapse the backdrop onto the model.
     */
    const depth = Math.max(camera.far * 0.8, fitRadius * 5);
    mesh.position.copy(dir).multiplyScalar(-depth);
    // Faces the camera: see the file header for why this is a billboard
    // rather than a world-fixed plane.
    mesh.quaternion.copy(camera.quaternion);

    let width: number;
    let height: number;
    const persp = camera as THREE.PerspectiveCamera;
    const ortho = camera as THREE.OrthographicCamera;
    if ((camera as THREE.Camera & { isPerspectiveCamera?: boolean }).isPerspectiveCamera) {
      const tanHalfV = Math.tan((persp.fov * Math.PI) / 360);
      height = 2 * depth * tanHalfV;
      width = height * persp.aspect;
    } else {
      width = ortho.right - ortho.left;
      height = ortho.top - ortho.bottom;
    }
    // A hair oversized so a rounding error never leaves a sliver of the old
    // stage colour visible at the frame edge.
    mesh.scale.set(width * 1.02, height * 1.02, 1);

    const tex = textureRef.current;
    // Always an HTMLImageElement here — loaded via THREE.TextureLoader, never
    // a canvas or video source. three's own type keeps `image` as `any`-ish,
    // so this is a real fact about the loader, not a cast of convenience.
    const img = tex?.image as HTMLImageElement | undefined;
    if (tex && img?.width) {
      // Cover, not stretch — matches the CSS image backdrop's own
      // `center / cover`. The plane's aspect is view-derived and changes
      // every frame the camera moves, so the crop is recomputed here rather
      // than cached.
      const planeAspect = width / height;
      const imgAspect = img.width / img.height;
      if (imgAspect > planeAspect) {
        const scale = planeAspect / imgAspect;
        tex.repeat.set(scale, 1);
        tex.offset.set((1 - scale) / 2, 0);
      } else {
        const scale = imgAspect / planeAspect;
        tex.repeat.set(1, scale);
        tex.offset.set(0, (1 - scale) / 2);
      }
    }
  });

  if (!image) return null;

  return (
    <mesh ref={meshRef} geometry={geometry} castShadow={false} receiveShadow={false}>
      {/*
        Not tone-mapped, matching the CSS image backdrop's own behaviour: a
        photograph is display-ready pixels, not scene radiance, and running it
        through ACES Filmic would darken/desaturate it in a way the flat mode
        never does. `depthWrite`/`depthTest` stay at their defaults — real
        depth at a real distance keeps it behind the piece without any
        render-order trick.

        DoubleSide, deliberately: this mesh is only re-aimed at the MAIN
        camera every frame (see `useFrame` above), but it is a real scene
        object, so anything ELSE that renders the scene from a different
        viewpoint — chiefly the ground's mirror reflector, which draws the
        whole scene again from a reflected camera — looks at it from an angle
        the billboard math never accounted for. Single-sided, that second
        viewpoint would frequently be looking at the back face and cull it to
        nothing, which would read as the backdrop mysteriously failing to
        reflect rather than as the single-sided default it actually is.
      */}
      <meshBasicMaterial ref={materialRef} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
