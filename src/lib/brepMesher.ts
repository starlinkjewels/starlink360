/**
 * Meshes Rhino Brep faces that were saved without a render mesh.
 *
 * ── Why this exists ──
 *
 * A .3dm only carries triangles if Rhino cached a render mesh when it saved
 * ("Save Small", plugin exports, files never shown shaded). rhino3dm cannot
 * create one: it is built on openNURBS, and openNURBS has no Brep mesher —
 * McNeel's own answer is "save with render meshes, or call Rhino.Compute",
 * which is a paid, Windows/Linux server product. Without this file, every such
 * part simply vanished from the viewer with a notice.
 *
 * ── How ──
 *
 * rhino3dm 8.35 exposes a face's loops and trims (which edge each trim runs
 * along, and in which direction) but not the 2D trim curves themselves. So the
 * boundary is recovered the way CAD importers do it when only 3D edges are
 * trustworthy: sample each 3D edge, then invert every sample onto the face's
 * surface (closest point, Gauss-Newton) to get its (u, v). That gives the trim
 * loops in parameter space, which earcut triangulates — holes included — and
 * the triangulation is then refined against the true surface until it is
 * within tolerance. Every vertex gets the exact surface normal, which is what
 * makes polished metal reflect smoothly rather than faceted.
 *
 * ── Watertightness ──
 *
 * Boundary vertices use the edge's own 3D sample points, cached per edge, so
 * the two faces meeting at an edge share bit-identical vertices there, and the
 * refinement never splits a boundary segment. Interior refinement always
 * splits an edge in BOTH triangles that share it. Together these mean no
 * cracks, inside a face or between faces.
 *
 * ── Seams and poles ──
 *
 * A closed surface (cylinder, sphere, torus) maps one 3D seam line to two
 * parameter lines, u = min and u = max, and a pole maps one 3D point to a
 * whole side of the domain. Both are resolved with openNURBS's own convention:
 * a face always lies to the LEFT of its trims in parameter space. A seam trim
 * running up (+v) is therefore on the max side, one running down on the min
 * side, and a singular (pole) trim runs along its domain side in the direction
 * that keeps the face on its left.
 *
 * Written as ES5 source text, like WORKER_SOURCE, because it runs inside the
 * classic decode worker; the Node suites evaluate the same text.
 */
export const BREP_MESHER_SOURCE = String.raw`
function createBrepMesher(rhino, earcut) {
  "use strict";

  /* ── small vector helpers, on plain [x, y, z] arrays ── */
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function len(a) { return Math.sqrt(dot(a, a)); }
  function dist(a, b) { return len(sub(a, b)); }
  function finite3(a) {
    return !!a && isFinite(a[0]) && isFinite(a[1]) && isFinite(a[2]);
  }

  var OUTER = rhino.BrepLoopType ? rhino.BrepLoopType.Outer : null;
  var INNER = rhino.BrepLoopType ? rhino.BrepLoopType.Inner : null;
  function loopKind(loop) {
    var t = loop.loopType;
    if (t === OUTER || (t && t.value === 1)) return "outer";
    if (t === INNER || (t && t.value === 2)) return "inner";
    return "other";
  }

  /* ── one face's surface, with wrapping for closed directions ── */
  function View(face) {
    var du = face.domain(0), dv = face.domain(1);
    this.face = face;
    this.u0 = du[0]; this.u1 = du[1];
    this.v0 = dv[0]; this.v1 = dv[1];
    this.pu = face.isClosed(0) ? du[1] - du[0] : 0;
    this.pv = face.isClosed(1) ? dv[1] - dv[0] : 0;
    this.rev = !!face.orientationIsReversed;
    this.grid = null;
  }
  View.prototype.wu = function (u) {
    if (this.pu) return this.u0 + (((u - this.u0) % this.pu) + this.pu) % this.pu;
    return u < this.u0 ? this.u0 : u > this.u1 ? this.u1 : u;
  };
  View.prototype.wv = function (v) {
    if (this.pv) return this.v0 + (((v - this.v0) % this.pv) + this.pv) % this.pv;
    return v < this.v0 ? this.v0 : v > this.v1 ? this.v1 : v;
  };
  View.prototype.at = function (u, v) {
    return this.face.pointAt(this.wu(u), this.wv(v));
  };
  /**
   * Unit normal facing out of the face, or null where the surface has none.
   *
   * At a singular point (a sphere's pole, a cone's apex) one partial
   * derivative vanishes and the normal is undefined — and rhino3dm's normalAt
   * does not say so: at a sphere's north pole it returns (0, 0, -1), pointing
   * INTO the stone. Used as-is that is a dark, inside-out spot at the table or
   * culet. Singular points only occur on a side of the domain, so only there
   * are the partials checked; null makes the caller average the surrounding
   * triangles instead, which is the correct normal at a pole.
   */
  View.prototype.normal = function (u, v) {
    var su = this.u1 - this.u0, sv = this.v1 - this.v0;
    var wu = this.wu(u), wv = this.wv(v);
    var onSide =
      Math.abs(wu - this.u0) <= su * 1e-6 || Math.abs(wu - this.u1) <= su * 1e-6 ||
      Math.abs(wv - this.v0) <= sv * 1e-6 || Math.abs(wv - this.v1) <= sv * 1e-6;
    if (onSide) {
      var S = this.at(u, v), d = this.derivs(u, v, S);
      var lu = len(d[0]), lv = len(d[1]);
      if (lu <= lv * 1e-6 || lv <= lu * 1e-6) return null;
    }
    var n = null;
    try { n = this.face.normalAt(this.wu(u), this.wv(v)); } catch (err) { n = null; }
    if (!finite3(n)) return null;
    var l = len(n);
    if (!(l > 1e-12)) return null;
    var s = this.rev ? -1 / l : 1 / l;
    return [n[0] * s, n[1] * s, n[2] * s];
  };
  /** Partial derivatives by finite difference, stepping inward at a domain edge. */
  View.prototype.derivs = function (u, v, S) {
    var hu = (this.u1 - this.u0) * 1e-6 || 1e-9;
    var hv = (this.v1 - this.v0) * 1e-6 || 1e-9;
    if (!this.pu && u + hu > this.u1) hu = -hu;
    if (!this.pv && v + hv > this.v1) hv = -hv;
    var A = this.at(u + hu, v), B = this.at(u, v + hv);
    var Su = sub(A, S), Sv = sub(B, S);
    return [
      [Su[0] / hu, Su[1] / hu, Su[2] / hu],
      [Sv[0] / hv, Sv[1] / hv, Sv[2] / hv]
    ];
  };

  /**
   * Closest point on the surface to P, starting from (u, v).
   *
   * Gauss-Newton on |S(u,v) - P|^2. At a pole one partial vanishes, so that
   * direction is frozen rather than allowed to take a huge, meaningless step —
   * which is also what keeps a pole sample's u equal to its neighbour's.
   */
  View.prototype.newton = function (P, u, v) {
    var spanU = this.u1 - this.u0, spanV = this.v1 - this.v0;
    var S = this.at(u, v);
    for (var it = 0; it < 40; it++) {
      var d = this.derivs(u, v, S);
      var Su = d[0], Sv = d[1];
      var r = sub(P, S);
      var a = dot(Su, Su), b = dot(Su, Sv), c = dot(Sv, Sv);
      var g1 = dot(Su, r), g2 = dot(Sv, r);
      var stepU = 0, stepV = 0;
      if (a < c * 1e-10) {
        stepV = c > 0 ? g2 / c : 0;
      } else if (c < a * 1e-10) {
        stepU = a > 0 ? g1 / a : 0;
      } else {
        var reg = (a + c) * 1e-12;
        var det = (a + reg) * (c + reg) - b * b;
        if (!(Math.abs(det) > 0)) break;
        stepU = ((c + reg) * g1 - b * g2) / det;
        stepV = ((a + reg) * g2 - b * g1) / det;
      }
      // Never jump more than a quarter of the domain in one step.
      var mu = spanU * 0.25, mv = spanV * 0.25;
      if (stepU > mu) stepU = mu; else if (stepU < -mu) stepU = -mu;
      if (stepV > mv) stepV = mv; else if (stepV < -mv) stepV = -mv;

      var nu = u + stepU, nv = v + stepV;
      if (!this.pu) nu = nu < this.u0 ? this.u0 : nu > this.u1 ? this.u1 : nu;
      if (!this.pv) nv = nv < this.v0 ? this.v0 : nv > this.v1 ? this.v1 : nv;
      var NS = this.at(nu, nv);
      // Backtrack if the step made things worse.
      var tries = 0;
      while (dist(NS, P) > dist(S, P) && tries < 6) {
        stepU *= 0.5; stepV *= 0.5;
        nu = u + stepU; nv = v + stepV;
        if (!this.pu) nu = nu < this.u0 ? this.u0 : nu > this.u1 ? this.u1 : nu;
        if (!this.pv) nv = nv < this.v0 ? this.v0 : nv > this.v1 ? this.v1 : nv;
        NS = this.at(nu, nv);
        tries++;
      }
      var moved = Math.abs(nu - u) / (spanU || 1) + Math.abs(nv - v) / (spanV || 1);
      u = nu; v = nv; S = NS;
      if (moved < 1e-12) break;
    }
    return { u: u, v: v, d: dist(S, P) };
  };
  /** Coarse samples over the whole domain, for seeding a search with no prior. */
  View.prototype.seeds = function () {
    if (this.grid) return this.grid;
    var n = 16, out = [];
    for (var i = 0; i <= n; i++) {
      for (var j = 0; j <= n; j++) {
        var u = this.u0 + ((this.u1 - this.u0) * i) / n;
        var v = this.v0 + ((this.v1 - this.v0) * j) / n;
        out.push({ u: u, v: v, P: this.at(u, v) });
      }
    }
    return (this.grid = out);
  };
  /** Global inversion: Newton from the few nearest coarse samples, best wins. */
  View.prototype.invertGlobal = function (P) {
    var g = this.seeds();
    var ranked = g.slice().sort(function (x, y) { return dist(x.P, P) - dist(y.P, P); });
    var best = null;
    for (var k = 0; k < 4 && k < ranked.length; k++) {
      var r = this.newton(P, ranked[k].u, ranked[k].v);
      if (!best || r.d < best.d) best = r;
    }
    return best;
  };

  /* ── edges: sampled once, shared by both faces that use them ── */

  /**
   * Points along one 3D edge, in the edge's own direction.
   *
   * Adaptive: a span is split while its midpoint strays from the chord by more
   * than the tolerance, while it is longer than maxLen, or while the tangent
   * turns by more than maxAngle across it. Boundary segments are never split
   * later (that would open a crack against the neighbouring face), so the edge
   * has to be fine enough here, once.
   */
  function sampleEdge(edge, tol, cosMax, maxLen) {
    var d = edge.domain;
    var t0 = d[0], t1 = d[1];
    var linear = false;
    try { linear = edge.isLinear(tol); } catch (err) { linear = false; }
    if (linear) {
      // Straight, but still no longer than maxLen per segment: a boundary
      // segment is never split later, so the triangle beside an over-long
      // one could never meet the length limit.
      var A0 = edge.pointAt(t0), A1 = edge.pointAt(t1);
      var segs = Math.max(1, Math.ceil(dist(A0, A1) / maxLen));
      var line = [A0];
      for (var si = 1; si < segs; si++) line.push(edge.pointAt(t0 + ((t1 - t0) * si) / segs));
      line.push(A1);
      return line;
    }

    var out = [];
    function tan(t) {
      var v = null;
      try { v = edge.tangentAt(t); } catch (err) { v = null; }
      return finite3(v) ? v : null;
    }
    function rec(ta, Pa, Ta, tb, Pb, Tb, depth) {
      var tm = (ta + tb) / 2;
      var Pm = edge.pointAt(tm);
      var mid = [(Pa[0] + Pb[0]) / 2, (Pa[1] + Pb[1]) / 2, (Pa[2] + Pb[2]) / 2];
      var split =
        depth < 14 &&
        (dist(Pm, mid) > tol ||
          dist(Pa, Pb) > maxLen ||
          (Ta && Tb && dot(Ta, Tb) < cosMax));
      if (!split) { out.push(Pb); return; }
      var Tm = tan(tm);
      rec(ta, Pa, Ta, tm, Pm, Tm, depth + 1);
      rec(tm, Pm, Tm, tb, Pb, Tb, depth + 1);
    }
    // Start from a few even spans: a closed circle's ends coincide, and an
    // S-curve can pass straight through its own chord midpoint.
    var n = 8, prevT = t0, prevP = edge.pointAt(t0), prevTan = tan(t0);
    out.push(prevP);
    for (var i = 1; i <= n; i++) {
      var t = t0 + ((t1 - t0) * i) / n;
      var P = edge.pointAt(t), T = tan(t);
      rec(prevT, prevP, prevTan, t, P, T, 0);
      prevT = t; prevP = P; prevTan = T;
    }
    return out;
  }

  /* ── loops in parameter space ── */

  /**
   * Inverts one trim's samples onto the face.
   *
   * Starts from the middle sample, which is the one least likely to sit on a
   * seam or at a pole, and walks outward in both directions so every sample
   * is seeded by its neighbour. That keeps the trim continuous across a seam
   * and gives a pole sample its neighbour's u.
   */
  function invertTrim(view, pts, okDist) {
    var n = pts.length;
    var uv = new Array(n);
    var mid = n >> 1;
    var c = view.newton(pts[mid], (view.u0 + view.u1) / 2, (view.v0 + view.v1) / 2);
    if (c.d > okDist) c = view.invertGlobal(pts[mid]);
    if (!c || c.d > okDist) return null;
    uv[mid] = [c.u, c.v];
    var i, r;
    for (i = mid + 1; i < n; i++) {
      r = view.newton(pts[i], uv[i - 1][0], uv[i - 1][1]);
      if (r.d > okDist) {
        var g = view.invertGlobal(pts[i]);
        if (!g || g.d > okDist) return null;
        r = g;
      }
      uv[i] = [r.u, r.v];
    }
    for (i = mid - 1; i >= 0; i--) {
      r = view.newton(pts[i], uv[i + 1][0], uv[i + 1][1]);
      if (r.d > okDist) {
        var g2 = view.invertGlobal(pts[i]);
        if (!g2 || g2.d > okDist) return null;
        r = g2;
      }
      uv[i] = [r.u, r.v];
    }
    return uv;
  }

  function near(x, y, span) { return Math.abs(x - y) <= span * 1e-5; }

  /** Is every sample of this trim on the u-seam (or v-seam) of a closed direction? */
  function onSeam(view, uv, dir) {
    var p = dir === 0 ? view.pu : view.pv;
    if (!p) return false;
    var lo = dir === 0 ? view.u0 : view.v0, hi = dir === 0 ? view.u1 : view.v1;
    for (var i = 0; i < uv.length; i++) {
      var x = dir === 0 ? view.wu(uv[i][0]) : view.wv(uv[i][1]);
      if (!near(x, lo, p) && !near(x, hi, p)) return false;
    }
    return true;
  }

  function shift(uv, du, dv) {
    if (!du && !dv) return uv;
    for (var i = 0; i < uv.length; i++) { uv[i][0] += du; uv[i][1] += dv; }
    return uv;
  }

  /**
   * One loop as a polygon in (u, v), plus the exact 3D point of every vertex.
   * Returns null if any part of it cannot be placed on the surface.
   */
  function buildLoop(view, brep, loop, edgeCache, opts) {
    var trims = [];
    var count = loop.trimCount;
    for (var t = 0; t < count; t++) {
      var T = loop.trims.get(t);
      var ei = T.edgeIndex;
      if (ei < 0) { trims.push({ singular: true }); continue; }
      var pts = edgeCache(ei);
      if (!pts) return null;
      if (T.isReversed) pts = pts.slice().reverse();
      var uv = invertTrim(view, pts, opts.okDist);
      if (!uv) return null;
      trims.push({
        singular: false,
        pts: pts,
        uv: uv,
        seamU: onSeam(view, uv, 0),
        seamV: onSeam(view, uv, 1)
      });
    }
    if (!trims.length) return null;

    // Begin at a trim with an unambiguous position: plain beats seam beats pole.
    var start = -1, i;
    for (i = 0; i < trims.length && start < 0; i++) {
      if (!trims[i].singular && !trims[i].seamU && !trims[i].seamV) start = i;
    }
    for (i = 0; i < trims.length && start < 0; i++) if (!trims[i].singular) start = i;
    if (start < 0) return null;

    var spanU = view.u1 - view.u0, spanV = view.v1 - view.v0;
    var U = [], V = [], X = [];
    var pendingSingular = false;
    for (var k = 0; k < trims.length; k++) {
      var tr = trims[(start + k) % trims.length];
      if (tr.singular) { pendingSingular = true; continue; }
      var uvs = tr.uv;
      var first = uvs[0], last = uvs[uvs.length - 1];

      if (k === 0) {
        // The face lies to the left of its trims: up the seam means the max
        // side, down means the min side.
        if (tr.seamU) {
          var side = last[1] > first[1] ? view.u1 : view.u0;
          for (i = 0; i < uvs.length; i++) uvs[i][0] = side;
        }
        if (tr.seamV) {
          var sideV = last[0] > first[0] ? view.v0 : view.v1;
          for (i = 0; i < uvs.length; i++) uvs[i][1] = sideV;
        }
      } else {
        var pu = U[U.length - 1], pv = V[V.length - 1];
        var ku = 0, kv = 0;
        if (pendingSingular) {
          // A pole trim runs along a domain side, in the direction that keeps
          // the face on its left — so the next trim starts on that side of
          // the previous end, never behind it.
          if (view.pu && (near(view.wv(pv), view.v0, spanV) || near(view.wv(pv), view.v1, spanV))) {
            var up = near(view.wv(pv), view.v0, spanV); // bottom side runs +u
            var diff = first[0] - pu;
            ku = up ? Math.ceil((-diff) / view.pu - 1e-9) : Math.floor((-diff) / view.pu + 1e-9);
            var nd = diff + ku * view.pu;
            if (up && nd <= spanU * 1e-6) ku += 1;
            if (!up && nd >= -spanU * 1e-6) ku -= 1;
          } else if (view.pv && (near(view.wu(pu), view.u0, spanU) || near(view.wu(pu), view.u1, spanU))) {
            var right = near(view.wu(pu), view.u1, spanU); // max-u side runs +v
            var diffV = first[1] - pv;
            kv = right ? Math.ceil((-diffV) / view.pv - 1e-9) : Math.floor((-diffV) / view.pv + 1e-9);
            var ndv = diffV + kv * view.pv;
            if (right && ndv <= spanV * 1e-6) kv += 1;
            if (!right && ndv >= -spanV * 1e-6) kv -= 1;
          }
        } else {
          // Shared vertex: land the start exactly on the previous end.
          if (view.pu) ku = Math.round((pu - first[0]) / view.pu);
          if (view.pv) kv = Math.round((pv - first[1]) / view.pv);
        }
        shift(uvs, ku * view.pu, kv * view.pv);
        if (pendingSingular) fillPole(uvs[0][0], uvs[0][1]);
      }
      pendingSingular = false;

      for (i = 0; i < uvs.length; i++) {
        var n = U.length;
        // Trims meet end to start; keep the shared vertex once.
        if (n && Math.abs(U[n - 1] - uvs[i][0]) <= spanU * 1e-9 && Math.abs(V[n - 1] - uvs[i][1]) <= spanV * 1e-9) continue;
        U.push(uvs[i][0]); V.push(uvs[i][1]); X.push(tr.pts[i]);
      }
    }
    // A loop that ends on a pole trim closes through it back to the start.
    if (pendingSingular && U.length) fillPole(U[0], V[0]);

    /*
     * Points along a pole trim, from the last placed vertex to (toU, toV).
     *
     * The trim is one 3D point but a whole side of the parameter domain. With
     * no points along it, that side would be a single boundary segment
     * spanning the full turn, and the triangle beside it could never be
     * refined to tolerance. One point per maxAngle of turn, all at the pole;
     * their normals are filled from the neighbouring triangles later.
     */
    function fillPole(toU, toV) {
      var last = U.length - 1;
      var su = toU - U[last], sv = toV - V[last];
      var frac = Math.max(Math.abs(su) / (view.pu || spanU || 1), Math.abs(sv) / (view.pv || spanV || 1));
      var k = Math.max(4, Math.ceil((frac * 360) / opts.maxAngleDeg));
      var P = X[last];
      for (var j = 1; j < k; j++) {
        U.push(U[last] + (su * j) / k);
        V.push(V[last] + (sv * j) / k);
        X.push(P);
      }
    }

    // Closing vertex repeats the first.
    var m = U.length;
    if (m > 1 && Math.abs(U[m - 1] - U[0]) <= spanU * 1e-9 && Math.abs(V[m - 1] - V[0]) <= spanV * 1e-9) {
      U.pop(); V.pop(); X.pop();
    }
    if (U.length < 3) return null;
    return { U: U, V: V, X: X };
  }

  function signedArea(U, V) {
    var a = 0;
    for (var i = 0, j = U.length - 1; i < U.length; j = i++) a += (U[j] - U[i]) * (V[j] + V[i]);
    return a / 2;
  }

  /* ── the face ── */

  /**
   * Triangles for one Brep face, or null if it cannot be meshed.
   *
   * opts: tol (max distance from the true surface), cosMax (max angle between
   * neighbouring normals, as a cosine), maxLen (longest edge), maxTris (budget),
   * okDist (how far an inverted edge sample may sit from the surface).
   */
  function meshFace(brep, faceIndex, edgeCache, opts) {
    var face = brep.faces().get(faceIndex);
    var view = new View(face);

    var loops = face.loops;
    var rings = [], outer = -1;
    for (var l = 0; l < loops.count; l++) {
      var L = loops.get(l);
      var kind = loopKind(L);
      if (kind === "other") continue;
      var ring = buildLoop(view, brep, L, edgeCache, opts);
      if (!ring) {
        if (kind === "outer") return null;
        continue; // a hole that cannot be placed is skipped, not fatal
      }
      ring.area = Math.abs(signedArea(ring.U, ring.V));
      if (kind === "outer" && outer < 0) outer = rings.length;
      rings.push(ring);
    }
    if (!rings.length) return null;
    if (outer < 0) {
      // No loop flagged outer: the largest one is.
      outer = 0;
      for (var r0 = 1; r0 < rings.length; r0++) if (rings[r0].area > rings[outer].area) outer = r0;
    }
    if (outer !== 0) { var tmp = rings[0]; rings[0] = rings[outer]; rings[outer] = tmp; }

    var cu = (view.u0 + view.u1) / 2, cv = (view.v0 + view.v1) / 2;

    /*
     * The face's metric: how many parameter units make one "target edge" in
     * each direction.
     *
     * Every length the triangulator compares (earcut, Delaunay flips, which
     * edge to bisect) is measured in units of the spacing the tolerances
     * actually REQUIRE there, not in raw 3D length. A torus shank bends
     * sharply around its tube and gently around the ring; measured in plain
     * length, bisection makes round triangles and over-refines the gentle
     * direction several times over. Measured in required spacing, round
     * triangles in the metric come out correctly stretched in 3D — long along
     * a cylinder's axis, short around it.
     *
     * Required spacing per direction comes from the normal curvature k there:
     * the tighter of the sag limit sqrt(8 tol / k) and the angle limit
     * maxAngle / k, capped at maxLen. Sampled over the face and the most
     * demanding sample wins, so it errs fine rather than coarse.
     */
    var ku = 0, kv = 0;
    (function () {
      function need(k) {
        var h = opts.maxLen;
        if (k > 1e-12) h = Math.min(h, Math.sqrt((8 * opts.tol) / k), opts.angleRad / k);
        return Math.max(h, opts.tol);
      }
      var spanU = view.u1 - view.u0, spanV = view.v1 - view.v0;
      var eu = spanU * 1e-4, ev = spanV * 1e-4, n = 5;
      for (var i = 0; i < n; i++) {
        for (var j = 0; j < n; j++) {
          var u = view.u0 + (spanU * (i + 0.5)) / n, v = view.v0 + (spanV * (j + 0.5)) / n;
          var N0 = view.normal(u, v);
          if (!N0) continue;
          var S0 = view.at(u, v), d = view.derivs(u, v, S0);
          var su = len(d[0]), sv = len(d[1]);
          var Nu = view.normal(u + eu, v), Nv = view.normal(u, v + ev);
          if (su > 1e-12) {
            var kU = Nu ? len(sub(Nu, N0)) / (eu * su) : 0;
            ku = Math.max(ku, su / need(kU));
          }
          if (sv > 1e-12) {
            var kV = Nv ? len(sub(Nv, N0)) / (ev * sv) : 0;
            kv = Math.max(kv, sv / need(kV));
          }
        }
      }
      if (!(ku > 0)) ku = 1 / (spanU || 1);
      if (!(kv > 0)) kv = 1 / (spanV || 1);
    })();

    /* vertices */
    var U = [], V = [], X = [], N = [], boundary = {};
    // Edge -> the (up to two) triangles on it. Shared by flipping and refining.
    var edges = {};
    var holes = [], coords = [];
    function ekey(a, b) { return a < b ? a * 4194304 + b : b * 4194304 + a; }
    for (var ri = 0; ri < rings.length; ri++) {
      var R = rings[ri];
      var base = U.length;
      if (ri > 0) holes.push(base);
      for (var q = 0; q < R.U.length; q++) {
        U.push(R.U[q]); V.push(R.V[q]); X.push(R.X[q]);
        N.push(view.normal(R.U[q], R.V[q]));
        coords.push(R.U[q] * ku, R.V[q] * kv);
      }
      for (var q2 = 0; q2 < R.U.length; q2++) {
        boundary[ekey(base + q2, base + ((q2 + 1) % R.U.length))] = true;
      }
    }

    var flat = earcut(coords, holes.length ? holes : null, 2);
    if (!flat || !flat.length) return null;

    /* triangles, all counter-clockwise in (u, v) */
    var tris = [];
    for (var f = 0; f < flat.length; f += 3) {
      var a = flat[f], b = flat[f + 1], c = flat[f + 2];
      var area = (U[b] - U[a]) * (V[c] - V[a]) - (U[c] - U[a]) * (V[b] - V[a]);
      if (area === 0) continue;
      tris.push(area > 0 ? [a, b, c] : [a, c, b]);
    }
    if (!tris.length) return null;

    recoverBoundary();
    for (var ti = 0; ti < tris.length; ti++) {
      var tt = tris[ti];
      addEdge(tt[0], tt[1], ti); addEdge(tt[1], tt[2], ti); addEdge(tt[2], tt[0], ti);
    }
    flipToDelaunay();

    function addEdge(a, b, t) {
      var k = ekey(a, b);
      var e = edges[k];
      if (!e) edges[k] = [t, -1];
      else if (e[0] === -1) e[0] = t;
      else e[1] = t;
    }
    function swapEdgeTri(a, b, from, to) {
      var e = edges[ekey(a, b)];
      if (!e) return;
      if (e[0] === from) e[0] = to; else if (e[1] === from) e[1] = to;
    }
    /** Twice the signed area in metric-scaled (u, v); positive = counter-clockwise. */
    function orient(a, b, c) {
      return ((U[b] - U[a]) * ku) * ((V[c] - V[a]) * kv) - ((U[c] - U[a]) * ku) * ((V[b] - V[a]) * kv);
    }

    /*
     * Lawson edge flips to the Delaunay triangulation of the polygon.
     *
     * earcut clips ears, which leaves long slivers — and, where a run of
     * boundary points is collinear only to rounding (a cylinder's circular
     * edge is a straight line in (u, v)), triangles made of three consecutive
     * boundary points with almost no area. Bisecting such a sliver's chord
     * lands exactly on its middle point and makes a duplicate vertex there.
     * Flipping every edge that fails the empty-circumcircle test removes both
     * and hands refinement well-shaped triangles to start from. A flip is only
     * taken when both new triangles keep positive area, so the result stays a
     * valid triangulation of the same region; boundary edges never flip.
     */
    function flipToDelaunay(seed) {
      var queue = seed || [];
      if (!seed) for (var k0 in edges) queue.push(+k0);
      var budget = queue.length * 30 + 1000;
      while (queue.length && budget-- > 0) {
        var key = queue.pop();
        if (boundary[key]) continue;
        var e = edges[key];
        if (!e || e[0] < 0 || e[1] < 0) continue;
        var a = Math.floor(key / 4194304), b = key % 4194304;
        var t1 = tris[e[0]], t2 = tris[e[1]];
        // Orient so t1 runs a -> b and t2 runs b -> a.
        if (!hasDirected(t1, a, b)) { var sw = a; a = b; b = sw; }
        if (!hasDirected(t1, a, b) || !hasDirected(t2, b, a)) continue;
        var c = third(t1, a, b), d = third(t2, a, b);
        if (c === d) continue;
        if (!(orient(a, d, c) > 0 && orient(d, b, c) > 0)) continue;
        if (!(inCircle(a, b, c, d) > 0)) continue;
        var i1 = e[0], i2 = e[1];
        tris[i1] = [a, d, c];
        tris[i2] = [d, b, c];
        delete edges[key];
        swapEdgeTri(a, d, i2, i1);
        swapEdgeTri(b, c, i1, i2);
        edges[ekey(c, d)] = [i1, i2];
        queue.push(ekey(a, d), ekey(d, b), ekey(b, c), ekey(c, a));
      }
    }
    function hasDirected(t, a, b) {
      return (t[0] === a && t[1] === b) || (t[1] === a && t[2] === b) || (t[2] === a && t[0] === b);
    }
    function third(t, a, b) {
      for (var i = 0; i < 3; i++) if (t[i] !== a && t[i] !== b) return t[i];
      return -1;
    }
    /** > 0 when d lies inside the circumcircle of counter-clockwise (a, b, c). */
    function inCircle(a, b, c, d) {
      var dx = U[d] * ku, dy = V[d] * kv;
      var ax = U[a] * ku - dx, ay = V[a] * kv - dy;
      var bx = U[b] * ku - dx, by = V[b] * kv - dy;
      var cx = U[c] * ku - dx, cy = V[c] * kv - dy;
      var a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
      var det = ax * (by * c2 - b2 * cy) - ay * (bx * c2 - b2 * cx) + a2 * (bx * cy - by * cx);
      // A whisker above zero, so cocircular points (a regular grid) don't flip back and forth.
      var scale = (a2 + b2 + c2) * (a2 + b2 + c2);
      return det > scale * 1e-12 ? det : 0;
    }

    /*
     * Puts back the boundary points earcut dropped.
     *
     * earcut removes collinear ring points by design, and on a closed surface
     * whole trims are collinear in (u, v) — a cylinder's circular edges are
     * straight lines u = 0..2pi there. Left out, the boundary between two kept
     * points is one long triangle edge that is not flagged as boundary, so
     * refinement splits it and makes a second vertex on top of each dropped
     * one: a crack, and an endless refinement loop. Each dropped run lies on
     * the edge joining its two kept neighbours, so it is fanned back into the
     * one triangle on that edge.
     */
    function recoverBoundary() {
      var used = new Uint8Array(U.length);
      for (var t = 0; t < tris.length; t++) {
        used[tris[t][0]] = 1; used[tris[t][1]] = 1; used[tris[t][2]] = 1;
      }
      var start = 0;
      for (var ri2 = 0; ri2 < rings.length; ri2++) {
        var n = rings[ri2].U.length;
        for (var p = 0; p < n; p++) {
          var A = start + p;
          if (!used[A] || used[start + ((p + 1) % n)]) continue;
          // A is kept and its successor was dropped: collect the run up to B.
          var run = [], s = (p + 1) % n;
          while (!used[start + s] && run.length < n) { run.push(start + s); s = (s + 1) % n; }
          var B = start + s;
          if (!used[B] || B === A) continue;
          // The one triangle with A -> B as an edge, in its own winding.
          var hit = -1, z = -1;
          for (var t2 = 0; t2 < tris.length && hit < 0; t2++) {
            var tr = tris[t2];
            for (var e = 0; e < 3; e++) {
              if (tr[e] === A && tr[(e + 1) % 3] === B) { hit = t2; z = tr[(e + 2) % 3]; break; }
            }
          }
          if (hit < 0) continue;
          var chain = [A].concat(run, [B]);
          tris[hit] = [chain[0], chain[1], z];
          for (var c2 = 1; c2 < chain.length - 1; c2++) tris.push([chain[c2], chain[c2 + 1], z]);
        }
        start += n;
      }
    }

    /*
     * Planar face (every gem facet, flat tops and bottoms): the triangulation
     * is already exact, and refining it would only add triangles.
     */
    var planar = true;
    var n0 = view.normal(cu, cv);
    if (!n0) planar = false;
    for (var pi = 0; planar && pi < U.length; pi += Math.max(1, (U.length / 12) | 0)) {
      var nn = N[pi];
      if (nn && dot(nn, n0) < 1 - 1e-9) planar = false;
    }
    if (planar) {
      for (var pc = 0; pc < tris.length && planar; pc++) {
        var t3 = tris[pc];
        var mu = (U[t3[0]] + U[t3[1]] + U[t3[2]]) / 3, mv = (V[t3[0]] + V[t3[1]] + V[t3[2]]) / 3;
        var nm = view.normal(mu, mv);
        if (nm && dot(nm, n0) < 1 - 1e-9) planar = false;
      }
    }

    if (!planar) {
      seedInterior();
      refine();
    }

    /*
     * Interior points, before any refinement.
     *
     * With only boundary points, the Delaunay triangulation of a closed
     * surface's parameter rectangle is a fan of slivers running the whole
     * length of the domain (a torus: bottom seam to top seam). Bisecting
     * slivers drops their midpoints almost on top of one another, which
     * leaves pockets of needlessly tiny triangles. So a jittered grid at one
     * required spacing (one metric unit) is inserted first — each point by
     * the standard incremental Delaunay step: find its triangle, split it in
     * three, restore Delaunay with the same flips — and refinement starts
     * from evenly sized triangles.
     */
    function seedInterior() {
      var mu0 = Infinity, mu1 = -Infinity, mv0 = Infinity, mv1 = -Infinity;
      for (var i = 0; i < U.length; i++) {
        if (U[i] < mu0) mu0 = U[i]; if (U[i] > mu1) mu1 = U[i];
        if (V[i] < mv0) mv0 = V[i]; if (V[i] > mv1) mv1 = V[i];
      }
      var su = 1 / ku, sv = 1 / kv;
      var nu = Math.ceil((mu1 - mu0) / su), nv = Math.ceil((mv1 - mv0) / sv);
      var cap = Math.min(opts.maxTris / 4, 20000);
      if (nu * nv > cap) {
        var f = Math.sqrt((nu * nv) / cap);
        su *= f; sv *= f;
        nu = Math.ceil((mu1 - mu0) / su); nv = Math.ceil((mv1 - mv0) / sv);
      }
      if (nu < 2 && nv < 2) return;
      var last = 0, seed = 12345;
      function jitter() {
        // Deterministic, so the same file always meshes the same way.
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return (seed / 0x7fffffff - 0.5) * 0.2;
      }
      for (var gi = 0; gi < nu; gi++) {
        for (var gj = 0; gj < nv; gj++) {
          var u = mu0 + (gi + 0.5 + jitter()) * su;
          var v = mv0 + (gj + 0.5 + jitter()) * sv;
          var t = locate(u, v, last);
          if (t < 0) continue;
          last = t;
          if (tooClose(t, u, v)) continue;
          insertAt(t, u, v);
        }
      }
    }
    function orientUV(a, b, u, v) {
      return ((U[b] - U[a]) * ku) * ((v - V[a]) * kv) - ((u - U[a]) * ku) * ((V[b] - V[a]) * kv);
    }
    /** The triangle holding (u, v), or -1 if the point is outside the face. */
    function locate(u, v, start) {
      var t = start < tris.length ? start : 0;
      for (var steps = 0; steps < 4000; steps++) {
        var tr = tris[t], moved = false;
        for (var s = 0; s < 3; s++) {
          var a = tr[s], b = tr[(s + 1) % 3];
          if (orientUV(a, b, u, v) < 0) {
            var e = edges[ekey(a, b)];
            var nt = !e ? -1 : e[0] === t ? e[1] : e[0];
            if (nt < 0) { moved = false; s = 3; t = -1; break; }
            t = nt; moved = true; break;
          }
        }
        if (t < 0) break;
        if (!moved) return t;
      }
      // The straight walk can leave a non-convex face through its boundary
      // while the point is inside elsewhere. Check every triangle.
      for (var k = 0; k < tris.length; k++) {
        var q = tris[k];
        if (orientUV(q[0], q[1], u, v) >= 0 && orientUV(q[1], q[2], u, v) >= 0 && orientUV(q[2], q[0], u, v) >= 0) return k;
      }
      return -1;
    }
    /** Within 0.4 required spacings of a corner or a boundary edge: skip it. */
    function tooClose(t, u, v) {
      var tr = tris[t];
      for (var s = 0; s < 3; s++) {
        var a = tr[s], b = tr[(s + 1) % 3];
        var ax = U[a] * ku, ay = V[a] * kv, px = u * ku, py = v * kv;
        if ((px - ax) * (px - ax) + (py - ay) * (py - ay) < 0.16) return true;
        if (boundary[ekey(a, b)]) {
          var bx = U[b] * ku, by = V[b] * kv;
          var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
          var h = L2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
          h = h < 0 ? 0 : h > 1 ? 1 : h;
          var cx = ax + h * dx - px, cy = ay + h * dy - py;
          if (cx * cx + cy * cy < 0.16) return true;
        }
      }
      return false;
    }
    function insertAt(t, u, v) {
      var vi = U.length;
      U.push(u); V.push(v); X.push(view.at(u, v)); N.push(view.normal(u, v));
      var tr = tris[t], a = tr[0], b = tr[1], c = tr[2];
      var t2 = tris.length, t3 = tris.length + 1;
      tris[t] = [a, b, vi];
      tris.push([b, c, vi], [c, a, vi]);
      swapEdgeTri(b, c, t, t2);
      swapEdgeTri(c, a, t, t3);
      addEdge(a, vi, t); addEdge(a, vi, t3);
      addEdge(b, vi, t); addEdge(b, vi, t2);
      addEdge(c, vi, t2); addEdge(c, vi, t3);
      flipToDelaunay([ekey(a, b), ekey(b, c), ekey(c, a)]);
    }

    /*
     * Refinement by edge bisection.
     *
     * A triangle is split while it strays from the surface (chord error at its
     * edge midpoints or centre), its normals turn too far, or its edges are
     * too long. It is always split on its LONGEST interior edge, and that
     * edge is split in both triangles sharing it, which keeps the mesh
     * conforming (no T-junctions, so no cracks) and the triangles well shaped.
     */
    function refine() {
      var midCache = {};
      function midpoint(a, b) {
        var k = ekey(a, b);
        var m = midCache[k];
        if (!m) {
          var mu = (U[a] + U[b]) / 2, mv = (V[a] + V[b]) / 2;
          m = midCache[k] = { u: mu, v: mv, P: view.at(mu, mv), N: view.normal(mu, mv) };
        }
        return m;
      }
      /*
       * How far the flat mesh sits off the surface at a point: the gap between
       * the surface point S and the mesh point M, measured ALONG the surface
       * normal (the chord height CAD meshers bound).
       *
       * Not the straight distance |S - M|. The parameter-space midpoint of an
       * edge is not its 3D midpoint wherever the parameterisation is uneven -
       * near a sphere's poles above all - so S slides sideways along the
       * surface even where the mesh lies perfectly on it. Measured straight,
       * that sideways slide reads as error and refinement never ends.
       */
      function sag(S, M, n) {
        var d = sub(S, M);
        return n ? Math.abs(dot(d, n)) : len(d);
      }
      function edgeLen(a, b) { return dist(X[a], X[b]); }
      /*
       * Length in the face's metric (1 = one required spacing). This, not 3D
       * length, picks which edge to bisect: it is what makes the triangles
       * stretch to the curvature, and on a closed surface two vertices on
       * opposite sides of the parameter domain can be the SAME seam point in
       * 3D, so a sliver spanning the whole domain looks short in 3D and would
       * never be cut the right way.
       */
      function uvLen(a, b) {
        var du2 = (U[a] - U[b]) * ku, dv2 = (V[a] - V[b]) * kv;
        return Math.sqrt(du2 * du2 + dv2 * dv2);
      }
      /*
       * An edge is split only when it is interior and BOTH of its triangles
       * have real area. Bisecting the long side of a zero-area sliver lands on
       * the sliver's own middle vertex, duplicating it — a crack, and a loop.
       */
      function splittable(a, b) {
        if (boundary[ekey(a, b)]) return false;
        var e = edges[ekey(a, b)];
        if (!e || e[0] < 0 || e[1] < 0) return false;
        var L2 = uvLen(a, b);
        var floor = L2 * L2 * 1e-9;
        for (var s = 0; s < 2; s++) {
          var t = tris[e[s]];
          if (Math.abs(orient(t[0], t[1], t[2])) <= floor) return false;
        }
        return true;
      }
      /*
       * Only edges that CAN be split are judged. A boundary edge is fixed (it
       * was sampled to tolerance already, and splitting it would crack the
       * seam with the next face), so letting it fail the test would split the
       * triangle's other edges forever without ever fixing anything.
       */
      function needs(t) {
        var tr = tris[t];
        var longest = 0;
        for (var s = 0; s < 3; s++) {
          var a = tr[s], b = tr[(s + 1) % 3];
          if (!splittable(a, b)) continue;
          var Luv = uvLen(a, b);
          if (Luv > longest) longest = Luv;
          if (edgeLen(a, b) > opts.maxLen) return true;
          var m = midpoint(a, b);
          var mid = [(X[a][0] + X[b][0]) / 2, (X[a][1] + X[b][1]) / 2, (X[a][2] + X[b][2]) / 2];
          if (sag(m.P, mid, m.N) > opts.tol) return true;
          // Metric units: below a few percent of the required spacing, an edge
          // is never split for angle or centre error alone (a pole's normals
          // never settle, however small the triangles get).
          if (N[a] && N[b] && dot(N[a], N[b]) < opts.cosMax && Luv > 0.03) return true;
        }
        if (longest <= 0.03) return false;
        var cu2 = (U[tr[0]] + U[tr[1]] + U[tr[2]]) / 3, cv2 = (V[tr[0]] + V[tr[1]] + V[tr[2]]) / 3;
        var Pc = view.at(cu2, cv2);
        var Xc = [
          (X[tr[0]][0] + X[tr[1]][0] + X[tr[2]][0]) / 3,
          (X[tr[0]][1] + X[tr[1]][1] + X[tr[2]][1]) / 3,
          (X[tr[0]][2] + X[tr[1]][2] + X[tr[2]][2]) / 3
        ];
        return sag(Pc, Xc, view.normal(cu2, cv2)) > opts.tol;
      }
      function split(a, b) {
        var e = edges[ekey(a, b)];
        var m = midpoint(a, b);
        var mi = U.length;
        U.push(m.u); V.push(m.v); X.push(m.P); N.push(view.normal(m.u, m.v));
        delete edges[ekey(a, b)];
        var made = [];
        for (var side = 0; side < 2; side++) {
          var t = e[side];
          var tr = tris[t];
          // Rotate so the split edge is tr[0] -> tr[1].
          var r = tr[0] === a || tr[0] === b ? (tr[1] === a || tr[1] === b ? 0 : 2) : 1;
          var x = tr[r], y = tr[(r + 1) % 3], z = tr[(r + 2) % 3];
          var nt = tris.length;
          tris[t] = [x, mi, z];
          tris.push([mi, y, z]);
          swapEdgeTri(y, z, t, nt);
          addEdge(x, mi, t); addEdge(mi, z, t);
          addEdge(mi, y, nt); addEdge(mi, z, nt);
          made.push(t, nt);
        }
        return made;
      }

      /** The triangle's longest edge that may be split, as [a, b], or null. */
      function longestEdge(t) {
        var tr = tris[t];
        var best = null, bestLen = -1;
        for (var s = 0; s < 3; s++) {
          var a = tr[s], b = tr[(s + 1) % 3];
          if (!splittable(a, b)) continue;
          var L2 = uvLen(a, b);
          if (L2 > bestLen) { bestLen = L2; best = [a, b]; }
        }
        return best;
      }
      function sameEdge(p, q) {
        return !!p && !!q && ((p[0] === q[0] && p[1] === q[1]) || (p[0] === q[1] && p[1] === q[0]));
      }

      /*
       * Rivara's Longest-Edge Propagation Path.
       *
       * Plain "bisect this triangle's longest edge" breaks down on slivers:
       * the neighbour across that edge has a different longest edge, so each
       * split leaves a new sliver beside the old one and refinement never
       * finishes. LEPP walks across longest edges until it reaches two
       * triangles that share the SAME longest edge, and splits that one —
       * which provably terminates and never degrades triangle shape. Repeated
       * until the triangle that asked has itself been split.
       */
      function lepp(t, made) {
        for (var guard = 0; guard < 64; guard++) {
          var e = longestEdge(t);
          if (!e) return;
          var pair = edges[ekey(e[0], e[1])];
          var other = pair[0] === t ? pair[1] : pair[0];
          var oe = longestEdge(other);
          if (!oe || sameEdge(oe, e)) {
            var parts = split(e[0], e[1]);
            for (var i = 0; i < parts.length; i++) made.push(parts[i]);
            return;
          }
          t = other;
        }
      }

      var stack = [];
      for (var s0 = tris.length - 1; s0 >= 0; s0--) stack.push(s0);
      while (stack.length && tris.length < opts.maxTris) {
        var t = stack[stack.length - 1];
        if (!needs(t)) { stack.pop(); continue; }
        var before = tris.length;
        var made = [];
        lepp(t, made);
        if (tris.length === before) { stack.pop(); continue; } // nothing could be split
        // t stays on the stack: it is checked again, and refined again if
        // the split happened further along its path rather than on it.
        for (var mm = 0; mm < made.length; mm++) stack.push(made[mm]);
      }
    }

    /* normals: exact where the surface has one, averaged at poles */
    var nv = U.length;
    var acc = new Float64Array(nv * 3);
    for (var t2 = 0; t2 < tris.length; t2++) {
      var tq = tris[t2];
      var fn = cross(sub(X[tq[1]], X[tq[0]]), sub(X[tq[2]], X[tq[0]]));
      if (view.rev) fn = [-fn[0], -fn[1], -fn[2]];
      for (var w = 0; w < 3; w++) {
        acc[tq[w] * 3] += fn[0]; acc[tq[w] * 3 + 1] += fn[1]; acc[tq[w] * 3 + 2] += fn[2];
      }
    }

    /*
     * A pole is ONE 3D point but many vertices — one per step along its side
     * of the domain — and each of those sees only a sliver of the fan around
     * it. Their normals are pooled by position, so every copy gets the whole
     * fan's average: the true normal at the pole, not one tilted toward
     * whichever triangle it happens to touch.
     */
    var pooled = {};
    for (var pv0 = 0; pv0 < nv; pv0++) {
      if (N[pv0]) continue;
      var pk = X[pv0][0] + "," + X[pv0][1] + "," + X[pv0][2];
      var pool = pooled[pk] || (pooled[pk] = [0, 0, 0]);
      pool[0] += acc[pv0 * 3]; pool[1] += acc[pv0 * 3 + 1]; pool[2] += acc[pv0 * 3 + 2];
    }
    for (var pv1 = 0; pv1 < nv; pv1++) {
      if (N[pv1]) continue;
      var pool2 = pooled[X[pv1][0] + "," + X[pv1][1] + "," + X[pv1][2]];
      acc[pv1 * 3] = pool2[0]; acc[pv1 * 3 + 1] = pool2[1]; acc[pv1 * 3 + 2] = pool2[2];
    }

    var pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3);
    for (var vi = 0; vi < nv; vi++) {
      pos[vi * 3] = X[vi][0]; pos[vi * 3 + 1] = X[vi][1]; pos[vi * 3 + 2] = X[vi][2];
      var nvec = N[vi];
      if (!nvec) {
        var ax = acc[vi * 3], ay = acc[vi * 3 + 1], az = acc[vi * 3 + 2];
        var al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
        nvec = [ax / al, ay / al, az / al];
      }
      nrm[vi * 3] = nvec[0]; nrm[vi * 3 + 1] = nvec[1]; nrm[vi * 3 + 2] = nvec[2];
    }
    var idx = new Uint32Array(tris.length * 3);
    var w4 = 0;
    for (var t4 = 0; t4 < tris.length; t4++) {
      var tv = tris[t4];
      // Two corners on the same pole point: a zero-area triangle. Harmless to
      // draw, but it double-counts an edge for anything that welds the mesh.
      if (X[tv[0]] === X[tv[1]] || X[tv[1]] === X[tv[2]] || X[tv[2]] === X[tv[0]]) continue;
      idx[w4] = tv[0];
      // A reversed face points against its surface normal: wind it the other way.
      idx[w4 + 1] = view.rev ? tv[2] : tv[1];
      idx[w4 + 2] = view.rev ? tv[1] : tv[2];
      w4 += 3;
    }
    if (!w4) return null;
    return { position: pos, normal: nrm, index: idx.subarray(0, w4) };
  }

  /**
   * Meshes the given faces of one Brep. Faces that cannot be meshed come back
   * as null in their slot, so the caller can still count them.
   *
   * Tolerances scale with the Brep itself, so a 1 mm melee stone and a 20 mm
   * band are both meshed to the same RELATIVE accuracy.
   */
  function meshBrepFaces(brep, faceIndices, quality) {
    var bb = null;
    try { bb = brep.getBoundingBox(); } catch (err) { bb = null; }
    var diag = 1;
    if (bb && bb.min && bb.max) diag = dist(bb.min, bb.max) || 1;
    var q = quality || {};
    /*
     * Defaults. Sag 0.05% of the part's diagonal is ~0.012 mm on a 25 mm ring
     * — about half a pixel with the ring filling a 4K frame — and 10 degrees
     * of normal turn per edge. Every vertex carries the exact surface normal,
     * so shading stays smooth well past where the outline would show facets.
     * Measured: a sphere comes out within 0.07% of its true area in ~15k
     * triangles; tightening to 0.02% costs 4x the triangles for no visible gain.
     */
    var maxAngleDeg = q.maxAngleDeg || 10;
    var opts = {
      tol: diag * (q.relTol || 5e-4),
      maxAngleDeg: maxAngleDeg,
      cosMax: Math.cos((maxAngleDeg * Math.PI) / 180),
      maxLen: diag * (q.relMaxLen || 0.12),
      maxTris: q.maxTrisPerFace || 60000,
      angleRad: (maxAngleDeg * Math.PI) / 180,
      okDist: diag * 2e-3
    };

    var edges = brep.edges();
    var cache = {};
    function edgeCache(ei) {
      if (cache[ei] !== undefined) return cache[ei];
      var pts = null;
      try { pts = sampleEdge(edges.get(ei), opts.tol, opts.cosMax, opts.maxLen); } catch (err) { pts = null; }
      return (cache[ei] = pts);
    }

    var out = [];
    for (var i = 0; i < faceIndices.length; i++) {
      var m = null;
      try { m = meshFace(brep, faceIndices[i], edgeCache, opts); } catch (err) { m = null; }
      out.push(m);
    }
    return out;
  }

  return { meshBrepFaces: meshBrepFaces };
}
`;
