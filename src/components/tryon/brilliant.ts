/*
 * A round brilliant cut, facet by facet.
 *
 * A sphere or an icosahedron behind a refraction shader reads as glass. What
 * makes a diamond look like a diamond is the specific facet layout of the
 * modern round brilliant: the pavilion mains are angled at ~40.8° so light
 * entering the crown is totally internally reflected twice and leaves back
 * up through the crown (brilliance), and the crown's bezels at ~34.5° split
 * it into colours on the way out (fire). Get those angles wrong and the stone
 * "leaks" light out of the bottom and looks dark in the middle. That is the
 * classic look of a cheap 3D diamond.
 *
 * So this builds the real 57-facet layout with GIA "Excellent" proportions:
 *
 *   crown:    1 table · 8 stars · 8 bezels (kites) · 16 upper girdles
 *   girdle:   16 faceted segments
 *   pavilion: 8 mains (kites) · 16 lower girdles · pointed culet
 *
 * Girdle radius is 1, girdle centre at y = 0, table facing +Y. Output is a
 * non-indexed triangle soup with every triangle wound outward, which is what
 * the refraction shader's BVH needs; flat normals come from the faces.
 *
 * Pure numbers with no three.js, so the Node suite can check it.
 */

export interface BrilliantProportions {
  /** Table width as a fraction of girdle diameter. */
  table: number;
  /** Crown angle, degrees. */
  crownAngle: number;
  /** Pavilion angle, degrees. */
  pavilionAngle: number;
  /** Girdle thickness as a fraction of diameter. */
  girdle: number;
  /** Star facet length, 0..1 of the distance from table edge to girdle. */
  star: number;
  /** Lower girdle facet length, 0..1 of the distance from girdle to culet. */
  lowerGirdle: number;
}

/* GIA Excellent / Tolkowsky-ideal ranges, centred. */
export const IDEAL: BrilliantProportions = {
  table: 0.56,
  crownAngle: 34.5,
  pavilionAngle: 40.8,
  girdle: 0.03,
  star: 0.5,
  lowerGirdle: 0.77,
};

export interface Brilliant {
  /** xyz per vertex, 3 vertices per triangle. */
  positions: Float32Array;
  triangles: number;
  /** Logical facets, 57 plus girdle segments. */
  facets: number;
  /** Heights, for setting design: table top, girdle top/bottom, culet. */
  tableY: number;
  girdleTop: number;
  girdleBottom: number;
  culetY: number;
}

type V3 = [number, number, number];
const DEG = Math.PI / 180;

export function roundBrilliant(p: BrilliantProportions = IDEAL): Brilliant {
  const g = p.girdle; // full thickness as fraction of diameter (diameter = 2)
  const gTop = g; // half-thickness in radius units = g * 2 / 2
  const gBot = -g;
  const tc = Math.tan(p.crownAngle * DEG);
  const tp = Math.tan(p.pavilionAngle * DEG);

  /*
   * The table is an octagon whose corners sit on the bezel axes (22.5° + 45°i).
   * "Table %" is measured across the flats, so the corner radius is larger.
   */
  const tableFlat = p.table; // radius across flats, in girdle radii
  const tableCorner = tableFlat / Math.cos(22.5 * DEG);
  const crownH = tc * (1 - tableCorner);
  const tableY = gTop + crownH;
  const culetY = gBot - tp; // pavilion main runs from girdle (r=1) to culet (r=0)

  const at = (r: number, a: number, y: number): V3 => [r * Math.cos(a), y, r * Math.sin(a)];
  const bezelAxis = (i: number) => (22.5 + 45 * i) * DEG;
  const starAxis = (i: number) => 45 * i * DEG;

  // Table corners, on the bezel axes.
  const T = Array.from({ length: 8 }, (_, i) => at(tableCorner, bezelAxis(i), tableY));

  /*
   * Star points, on the star axes, a `star` fraction of the way from the table
   * edge to the girdle. Height is chosen so the point lies exactly in both
   * neighbouring bezel planes; that is what keeps each bezel a flat kite.
   * A bezel plane drops `tc` per unit of distance along its own axis, and a
   * star point at radius r is r·cos(22.5°) along either neighbour's axis.
   */
  const edgeMid = tableFlat; // table edge midpoint radius == across-flats radius
  const rStar = edgeMid + p.star * (1 - edgeMid);
  const yStar = tableY - tc * (rStar * Math.cos(22.5 * DEG) - tableCorner);
  const S = Array.from({ length: 8 }, (_, i) => at(rStar, starAxis(i), yStar));

  // Girdle: 16 points, even ones under the stars, odd ones under the bezels.
  const Gt = Array.from({ length: 16 }, (_, j) => at(1, 22.5 * j * DEG, gTop));
  const Gb = Array.from({ length: 16 }, (_, j) => at(1, 22.5 * j * DEG, gBot));

  /*
   * Pavilion: mains are kites on the bezel axes from the culet to the odd
   * girdle points. Lower-girdle points sit on the star axes, `lowerGirdle` of
   * the way from girdle to culet, at the height that keeps both neighbouring
   * mains planar (same construction as the stars, mirrored).
   */
  const rLow = 1 - p.lowerGirdle;
  const yLow = culetY + tp * (rLow * Math.cos(22.5 * DEG));
  const P = Array.from({ length: 8 }, (_, i) => at(rLow, starAxis(i), yLow));
  const C: V3 = [0, culetY, 0];
  const tableCentre: V3 = [0, tableY, 0];

  const tris: [V3, V3, V3][] = [];
  const quad = (a: V3, b: V3, c: V3, d: V3) => {
    tris.push([a, b, c], [a, c, d]);
  };
  let facets = 0;

  // Table.
  for (let i = 0; i < 8; i++) tris.push([tableCentre, T[i], T[(i + 1) % 8]]);
  facets += 1;
  for (let i = 0; i < 8; i++) {
    const prev = (i + 7) % 8;
    // Star i sits between table corners i-1 and i.
    tris.push([T[prev], T[i], S[i]]);
    // Bezel kite i: table corner i, star i, girdle under the bezel, star i+1.
    quad(T[i], S[i], Gt[2 * i + 1], S[(i + 1) % 8]);
    // Upper girdles either side of star i.
    tris.push([S[i], Gt[2 * i], Gt[2 * i + 1]]);
    tris.push([S[i], Gt[(2 * i + 15) % 16], Gt[2 * i]]);
    // Pavilion main kite i and the lower girdles either side of point i.
    quad(C, P[i], Gb[2 * i + 1], P[(i + 1) % 8]);
    tris.push([P[i], Gb[2 * i], Gb[2 * i + 1]]);
    tris.push([P[i], Gb[(2 * i + 15) % 16], Gb[2 * i]]);
  }
  facets += 8 + 8 + 16 + 8 + 16;
  for (let j = 0; j < 16; j++) quad(Gt[j], Gt[(j + 1) % 16], Gb[(j + 1) % 16], Gb[j]);
  facets += 16;

  /*
   * Wind every triangle outward. The stone is convex and contains the origin,
   * so outward is simply "normal points away from the centre". Doing it this
   * way rather than by careful vertex order means a proportion change can
   * never produce an inside-out facet, which the shader renders as a hole.
   */
  const out = new Float32Array(tris.length * 9);
  const centre: V3 = [0, (tableY + culetY) / 2, 0];
  tris.forEach(([a, b, c], t) => {
    const ux = b[0] - a[0],
      uy = b[1] - a[1],
      uz = b[2] - a[2];
    const wx = c[0] - a[0],
      wy = c[1] - a[1],
      wz = c[2] - a[2];
    const nx = uy * wz - uz * wy,
      ny = uz * wx - ux * wz,
      nz = ux * wy - uy * wx;
    const cx = (a[0] + b[0] + c[0]) / 3 - centre[0];
    const cy = (a[1] + b[1] + c[1]) / 3 - centre[1];
    const cz = (a[2] + b[2] + c[2]) / 3 - centre[2];
    const flip = nx * cx + ny * cy + nz * cz < 0;
    const order = flip ? [a, c, b] : [a, b, c];
    order.forEach((vtx, k) => out.set(vtx, t * 9 + k * 3));
  });

  return {
    positions: out,
    triangles: tris.length,
    facets,
    tableY,
    girdleTop: gTop,
    girdleBottom: gBot,
    culetY,
  };
}

/** Girdle diameter in mm for a round brilliant of this carat weight. */
export function caratToDiameterMm(carat: number): number {
  // 1.00 ct ≈ 6.5 mm; weight scales with volume, so diameter with the cube root.
  return 6.5 * Math.cbrt(Math.max(0.01, carat));
}
