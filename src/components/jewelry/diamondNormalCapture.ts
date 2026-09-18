/**
 * Bake a stone's own surface into a cubemap the gem shader can trace against.
 *
 * This is the piece that makes a rendered diamond look cut rather than moulded.
 * Tracing a ray through a brilliant means intersecting it against the real
 * facets, over and over, and a fragment shader cannot walk a BVH. So instead we
 * pre-render the stone *from its own centre* into a cube render target, storing
 * at every direction:
 *
 *   rgb — the surface normal there, encoded to 0..1
 *   a   — how far that surface is from the centre, as a fraction of the
 *         bounding radius
 *
 * A single `textureCube` fetch then answers "what surface lies this way, and
 * where", which is enough to intersect a ray against the hull by a couple of
 * fixed-point iterations (see `intersect` in GemMaterial.ts). Because the
 * distance is stored *normalised*, the same capture is valid for any uniformly
 * scaled copy of the stone.
 *
 * Rendered with `side: BackSide` on purpose: the camera sits inside the stone,
 * so the faces we want are the ones pointing away from it.
 */
import * as THREE from "three";

export interface NormalCapture {
  texture: THREE.CubeTexture;
  /** Bounding-sphere radius, in the geometry's own units. */
  radius: number;
  /** Bounding-box centre, in the geometry's own units. */
  centerOffset: THREE.Vector3;
  renderTarget: THREE.WebGLCubeRenderTarget;
}

const vertexShader = /* glsl */ `
varying vec3 vPosition;
varying vec3 vNormal;

void main() {
  vPosition = position;
  // Stored outward; the gem shader's getSurfaceNormal() negates on decode.
  vNormal = normalize( normal );
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4( position, 1.0 );
}
`;

const fragmentShader = /* glsl */ `
varying vec3 vPosition;
varying vec3 vNormal;
uniform vec3 centerOffset;
uniform float radius;

void main() {
  vec3 encodedNormal = vNormal * 0.5 + 0.5;
  float dist = length( vPosition - centerOffset ) / radius;
  gl_FragColor = vec4( encodedNormal, dist );
}
`;

const cache = new Map<string, NormalCapture>();

/**
 * Hard cap, enforced here rather than by a caller.
 *
 * Each entry is a cube render target — at 256 that is ~3 MB of VRAM, and it is
 * never reclaimed by garbage collection because the GPU resource outlives the
 * JS object. The cache is keyed by `geometry.uuid`, and `facetGeometry()`
 * builds a NEW geometry on every material rebuild, so the key never repeats:
 * left unbounded this allocates a fresh target per rebuild until the driver
 * drops the context ("THREE.WebGLRenderer: Context Lost"), which is exactly
 * the failure mode `diamondSceneCapture.ts` already documents for bursts of
 * GPU allocation.
 *
 * Relying on an external prune call is what failed the first time — it was
 * simply never wired up here. Self-limiting is the only version that cannot
 * silently regress.
 */
const CACHE_LIMIT = 4;

function evictOldest(): void {
  while (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.get(oldest.value)?.renderTarget.dispose();
    cache.delete(oldest.value);
  }
}

/**
 * Half-float first. A capture stores a normal *and* a distance, and at 8 bits
 * the distance quantises into visible terraces across a facet. Unsigned byte is
 * kept as a last resort for devices that cannot render to a float target at
 * all — a banded stone still beats no stone.
 */
const TARGET_TYPES: THREE.TextureDataType[] = [THREE.HalfFloatType, THREE.UnsignedByteType];

/**
 * @param size Cube face resolution. The centre stone earns a large capture; the
 * melee covers a few pixels each and does not.
 */
export function captureNormals(
  renderer: THREE.WebGLRenderer,
  geometry: THREE.BufferGeometry,
  size = 512,
): NormalCapture {
  const key = `${geometry.uuid}@${size}`;
  const cached = cache.get(key);
  if (cached) return cached;

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const centerOffset = new THREE.Vector3();
  geometry.boundingBox?.getCenter(centerOffset);
  const radius = geometry.boundingSphere?.radius ?? 1;

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      centerOffset: { value: centerOffset.clone() },
      radius: { value: radius },
    },
    side: THREE.BackSide,
    toneMapped: false,
    depthWrite: true,
    depthTest: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // The capture is defined in the geometry's own space; any node transform the
  // part carries is undone by the shader's modelOffsetMatrixInv instead.
  mesh.matrixAutoUpdate = false;
  mesh.matrix.identity();
  mesh.matrixWorld.identity();
  mesh.matrixWorldNeedsUpdate = false;
  const scene = new THREE.Scene();
  scene.add(mesh);

  // Everything the CubeCamera pass disturbs, restored in full below. A capture
  // runs mid-frame off the back of a model load, so leaving the renderer in a
  // different state than we found it corrupts the next draw.
  const previousTarget = renderer.getRenderTarget();
  const previousClearColor = new THREE.Color();
  renderer.getClearColor(previousClearColor);
  const previousClearAlpha = renderer.getClearAlpha();
  const previousAutoClear = renderer.autoClear;
  const previousToneMapping = renderer.toneMapping;
  const previousColorSpace = renderer.outputColorSpace;
  const previousViewport = new THREE.Vector4();
  const previousScissor = new THREE.Vector4();
  renderer.getViewport(previousViewport);
  renderer.getScissor(previousScissor);
  const previousScissorTest = renderer.getScissorTest();

  // Tone mapping and an sRGB encode would both mangle what is being stored
  // here: these are not colours, they are a normal and a length.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.autoClear = true;
  // (0.5, 0.5, 1) decodes to +Z and a distance of 1 — a harmless "straight
  // ahead, at the hull" for rays that escape the geometry entirely.
  renderer.setClearColor(new THREE.Color(0.5, 0.5, 1), 1);

  let renderTarget: THREE.WebGLCubeRenderTarget | null = null;
  let lastError: unknown = null;
  for (const type of TARGET_TYPES) {
    let candidate: THREE.WebGLCubeRenderTarget | null = null;
    try {
      candidate = new THREE.WebGLCubeRenderTarget(size, {
        format: THREE.RGBAFormat,
        type,
        generateMipmaps: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        depthBuffer: true,
        stencilBuffer: false,
      });
      // Near plane hugs the centre and far clears the hull, so the depth range
      // is spent entirely on the stone.
      const camera = new THREE.CubeCamera(radius * 0.001, radius * 10, candidate);
      camera.position.copy(centerOffset);
      camera.update(renderer, scene);
      renderTarget = candidate;
      break;
    } catch (error) {
      candidate?.dispose();
      lastError = error;
    }
  }

  renderer.resetState();
  renderer.setRenderTarget(previousTarget);
  renderer.setClearColor(previousClearColor, previousClearAlpha);
  renderer.autoClear = previousAutoClear;
  renderer.toneMapping = previousToneMapping;
  renderer.outputColorSpace = previousColorSpace;
  renderer.setViewport(previousViewport);
  renderer.setScissor(previousScissor);
  renderer.setScissorTest(previousScissorTest);

  scene.remove(mesh);
  material.dispose();

  if (!renderTarget) {
    throw new Error(`Diamond normal capture failed: ${String(lastError)}`);
  }

  const capture: NormalCapture = {
    texture: renderTarget.texture,
    radius,
    centerOffset,
    renderTarget,
  };
  evictOldest();
  cache.set(key, capture);
  return capture;
}

/** Drop every capture. Geometry disposal invalidates them, so the two go together. */
export function clearNormalCaptures(): void {
  cache.forEach((capture) => capture.renderTarget.dispose());
  cache.clear();
}

/** Drop captures whose geometry is no longer cached. */
export function pruneNormalCaptures(liveGeometryIds: Set<string>): void {
  for (const [key, capture] of cache) {
    const uuid = key.slice(0, key.lastIndexOf("@"));
    if (liveGeometryIds.has(uuid)) continue;
    capture.renderTarget.dispose();
    cache.delete(key);
  }
}
