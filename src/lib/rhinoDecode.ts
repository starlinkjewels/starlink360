/**
 * Direct .3dm decoder.
 *
 * Replaces three's Rhino3dmLoader for the .3dm path. Measured on a real
 * 71 MB file (960 Breps / 5,782 BRep faces / 1.17M vertices), that loader
 * needed 5-10 minutes; this returns in well under ten seconds.
 *
 * The loader is slow for two structural reasons, neither of which is tunable
 * from outside it:
 *
 *  1. It emits one THREE.Mesh per BRep face — 5,782 of them for this file —
 *     and structured-clones each back from its worker.
 *  2. `rhino3dm.toThreejsJSON()` hands back plain JS Arrays, not typed arrays,
 *     so that clone ships ~14 million boxed numbers, and the main thread then
 *     runs BufferGeometryLoader.parse() 5,782 times to convert them back.
 *
 * So this walks the document in a worker, writes vertices straight into
 * Float32Arrays, merges everything into the two buckets the viewer actually
 * renders, and transfers two ArrayBuffers back with zero copying.
 */

export interface DecodedBucket {
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array;
}

/** One stone colour present in the piece. */
export interface DecodedGem extends DecodedBucket {
  /** sRGB hex from the Rhino render material, e.g. "#ffffff" for diamond, "#a01c28" for ruby. */
  color: string;
  /** Material name Rhino had on it — "Diamond", "Ruby", "Emerald". */
  material: string;
  /**
   * Rhino layer the stones sit on — "Gem 01", "Gem 02".
   *
   * This is the jeweller's own separation of centre stone from melee, and it is
   * what makes a stone selectable: grouping by colour alone merges every white
   * stone in a piece into one object with nothing to point at.
   */
  layer: string;
  /** Mesh chunks merged in (BRep faces). Not a stone count. */
  parts: number;
}

export interface DecodedDocument {
  metal: DecodedBucket | null;
  /**
   * Stones grouped by colour. A piece can set diamond, ruby and sapphire at
   * once, and each needs its own material — a single merged gem mesh forces
   * every stone to be the same colour.
   */
  gems: DecodedGem[];
  notices: string[];
  /** Objects skipped because Rhino stored no render mesh for them. */
  missingMesh: number;
}

export interface DecodeRules {
  gemLayer: string;
  metalLayer: string;
  gemWords: string;
  metalWords: string;
  constructionWords: string;
}

/* The worker runs as a classic script so it can `importScripts` the same
 * rhino3dm build the loader uses — proven to work, and already prefetched.
 * Written without template literals so it survives being embedded in one. */
export const WORKER_SOURCE = String.raw`
self.onmessage = function (e) {
  var msg = e.data;
  var lib = msg.libraryPath;
  var rules = msg.rules;

  function post(o, transfer) { self.postMessage(o, transfer || []); }

  function re(src) { return new RegExp(src, "i"); }

  try {
    self.importScripts(lib + "rhino3dm.js");
  } catch (err) {
    post({ type: "error", message: "Could not load the Rhino decoder. Check your connection." });
    return;
  }

  self.rhino3dm({ locateFile: function (p) { return lib + p; } }).then(function (rhino) {
    try {
      run(rhino, msg.buffer, rules);
    } catch (err) {
      post({ type: "error", message: (err && err.message) || String(err) });
    }
  }).catch(function (err) {
    post({ type: "error", message: (err && err.message) || String(err) });
  });

  function run(rhino, buffer, rules) {
    var GEM_LAYER = re(rules.gemLayer);
    var METAL_LAYER = re(rules.metalLayer);
    var GEM_WORDS = re(rules.gemWords);
    var METAL_WORDS = re(rules.metalWords);
    var CONSTRUCTION = re(rules.constructionWords);

    var doc = rhino.File3dm.fromByteArray(new Uint8Array(buffer));
    if (!doc) throw new Error("This file could not be read as a Rhino model.");

    /*
     * ── material table ──
     *
     * This is where a stone's real colour lives. Layer colours are Rhino's
     * organisation palette, not the gem: in a real file Gem 01-04 came through
     * as four shades of blue purely because that is the default ramp, which
     * would have turned a set of diamonds into sapphires. The render material
     * is authoritative — those same layers pointed at a material literally
     * named "Diamond".
     */
    function hex2(n) {
      var v = Math.max(0, Math.min(255, Math.round(n))).toString(16);
      return v.length < 2 ? "0" + v : v;
    }
    function chroma(c) {
      if (!c) return -1;
      return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
    }

    var mats = doc.materials();
    var matTable = [];
    for (var mi = 0; mi < mats.count; mi++) {
      var M = mats.get(mi);
      /*
       * Which colour actually describes the stone depends on how the material
       * was authored. A ruby is often built as a transparent material with the
       * red on transparentColor and diffuse left white — reading diffuse alone
       * would render it as a colourless diamond. Take whichever channel
       * actually carries colour, and fall back to diffuse when neither does.
       */
      var dc = M.diffuseColor || { r: 255, g: 255, b: 255 };
      var tc = M.transparentColor;

      /*
       * Rhino 7 and 8 author gems as physically based materials, where the real
       * colour lives on baseColor and legacy diffuse is often left plain white.
       * Reading only diffuse renders every coloured stone as a white diamond.
       *
       * The guard is not defensive tidiness. In rhino3dm 8.17, reading
       * baseColor on a material that is NOT physically based does not throw a
       * normal error - it faults inside the wasm module ("null function or
       * function signature mismatch"), which would take the whole decode down.
       * So supported must be checked first, and the read wrapped even then.
       */
      var bc = null;
      try {
        var pbr = typeof M.physicallyBased === "function" ? M.physicallyBased() : null;
        if (pbr && pbr.supported === true) bc = pbr.baseColor || null;
      } catch (err) {
        bc = null;
      }

      /* Whichever channel actually carries colour wins. A ruby is often built
       * as a transparent material with the red on transparentColor and diffuse
       * left white, so no single channel can be trusted alone. */
      var pick = dc;
      if (chroma(tc) > chroma(pick)) pick = tc;
      if (bc && chroma(bc) > chroma(pick)) pick = bc;

      /*
       * A near-black colour means "not set", not "black stone".
       *
       * Rhino leaves diffuse at (0,0,0) on plenty of materials — the same way
       * every object in this file reports objectColor (0,0,0) while actually
       * drawing ByLayer. Taken literally that paints the diamonds black, and a
       * black gem is never a real material. Anything this dark falls back to
       * colourless, which is what a diamond is.
       */
      var lum = Math.max(pick.r, pick.g, pick.b);
      if (lum < 24) pick = { r: 255, g: 255, b: 255 };

      matTable.push({
        name: M.name || "",
        hex: "#" + hex2(pick.r) + hex2(pick.g) + hex2(pick.b),
        chroma: chroma(pick),
      });
    }

    // ── layer table ──
    var layers = doc.layers();
    var layerTable = [];
    for (var i = 0; i < layers.count; i++) {
      var L = layers.get(i);
      layerTable.push({
        name: L.fullPath || L.name || "",
        visible: L.visible !== false,
        mat: typeof L.renderMaterialIndex === "number" ? L.renderMaterialIndex : -1,
      });
    }

    var FROM_OBJECT = rhino.ObjectMaterialSource
      ? rhino.ObjectMaterialSource.MaterialFromObject
      : null;
    var FROM_LAYER = rhino.ObjectMaterialSource
      ? rhino.ObjectMaterialSource.MaterialFromLayer
      : null;

    /**
     * The material an object actually draws with.
     *
     * The object's own index is only authoritative when the object says its
     * material comes from itself. Rhino leaves a stale materialIndex behind on
     * objects that were copied or imported and then set back to ByLayer, so
     * trusting the index unconditionally applies a leftover material - which
     * shows up as a set of stones in assorted wrong colours instead of one.
     *
     * The enum is compared by identity because rhino3dm exposes these as
     * objects rather than numbers. When it is missing or unrecognised, fall
     * back to the old rule (index when set, layer otherwise) rather than
     * guessing.
     */
    function resolveMaterial(attrs, layer) {
      var idx = attrs && typeof attrs.materialIndex === "number" ? attrs.materialIndex : -1;
      var src = attrs ? attrs.materialSource : null;

      if (FROM_LAYER && src === FROM_LAYER) idx = layer ? layer.mat : -1;
      else if (FROM_OBJECT && src === FROM_OBJECT) {
        // Explicitly per-object, but an out-of-range index still has to fall
        // back rather than drop the colour entirely.
        if (idx < 0 || idx >= matTable.length) idx = layer ? layer.mat : -1;
      } else if (idx < 0 || idx >= matTable.length) idx = layer ? layer.mat : -1;

      if (idx < 0 || idx >= matTable.length) return { name: "", hex: "#ffffff", chroma: 0 };
      return matTable[idx];
    }

    /*
     * Stone colour taken from the material or layer NAME.
     *
     * Jewellery CAD plugins - RhinoGold, MatrixGold - name a material after the
     * stone and its size, which is why this client's files carry materials
     * called "/Diamond0.2-<guid>" and "/Platinum-<guid>". The gem colour lives
     * in the plugin's own data, NOT in the standard Rhino material, so the
     * material that reaches us has plain white diffuse. Read literally, every
     * coloured stone in such a file renders as a colourless diamond.
     *
     * The name is the only place the intent survives, so it is read here. Two
     * rules keep this safe:
     *
     *  - A material that carries real colour of its own always wins. This is a
     *    fallback for neutral materials, never an override.
     *  - It is applied to stones only, so nothing here can tint metal.
     *
     * An entry of "" means "named, and genuinely colourless" - diamond, CZ,
     * moissanite - which must stop the search rather than fall through to a
     * later, looser pattern. Order matters: "pink sapphire" has to be read as
     * pink before "sapphire" claims it as blue.
     */
    /*
     * A trailing \b is useless on these names, and its absence is silent.
     *
     * The plugin writes the stone size straight onto the name with no
     * separator — "/Diamond0.2", "/Ruby0.1" — and \b needs a word character
     * beside a non-word character. Between "d" and "0" there is none, so
     * /\bruby\b/ never matches "/Ruby0.1" and the stone just stays white.
     * Short tokens are therefore closed with (?![a-z]), which still rejects
     * "Czech" for "cz" but accepts a digit straight after.
     */
    var GEM_TINTS = [
      // Compounds first. "Blue Topaz" is a pale aqua, not sapphire blue.
      [/aquamarine|\baqua(?![a-z])|sky\s*blue|swiss\s*blue|blue\s*topaz/i, "#77c6d8"],
      [/tanzanite|iolite/i, "#4b5ec4"],

      // Then explicit colour words, so a "Pink Diamond" is pink, not white.
      [/\bpink(?![a-z])/i, "#efa0bd"],
      [/\bblack(?![a-z])|\bonyx(?![a-z])|\bjet(?![a-z])/i, "#141419"],
      [/\bred(?![a-z])/i, "#a5182b"],
      [/\bblue(?![a-z])/i, "#12409b"],
      [/\bgreen(?![a-z])/i, "#0d7a45"],
      [/\byellow(?![a-z])|canary/i, "#e6c33c"],
      [/\bpurple(?![a-z])|violet|lavender/i, "#8f5cc0"],
      [/\borange(?![a-z])/i, "#e07a2c"],
      [/\bbrown(?![a-z])|cognac|smoky|champagne|chocolate/i, "#8b5a33"],

      // Named and genuinely colourless. Must stop the search rather than fall
      // through to a looser species pattern below.
      [
        /colou?rless|white\s*sapph|diamond|cubic\s*zirconia|\bcz(?![a-z])|moissanite|rock\s*crystal|crystal|\bglass(?![a-z])/i,
        ""
      ],

      // Species whose name alone implies the colour.
      [/\bruby(?![a-z])|rubellite|rhodolite/i, "#a5182b"],
      [/garnet/i, "#7b2233"],
      [/sapphire/i, "#12409b"],
      [/emerald|tsavorite/i, "#0d7a45"],
      [/peridot/i, "#adc523"],
      [/amethyst/i, "#8f5cc0"],
      [/citrine/i, "#e6c33c"],
      [/padparadscha|spessartite|\bcoral(?![a-z])/i, "#e07a2c"],
      [/morganite|rose\s*quartz/i, "#efa0bd"],
      [/turquoise/i, "#3ec3bf"],
      [/moonstone/i, "#e8eef5"],
      [/\bopal(?![a-z])/i, "#e6eff2"],
      [/\bpearl(?![a-z])/i, "#f7e8ea"],
      [/\bamber(?![a-z])/i, "#cf8722"],
      [/topaz/i, "#f0c164"]
    ];

    /** Hex for a stone name, "" when named-but-colourless, null when unknown. */
    function gemTintFromName(text) {
      if (!text) return null;
      for (var t = 0; t < GEM_TINTS.length; t++) {
        if (GEM_TINTS[t][0].test(text)) return GEM_TINTS[t][1];
      }
      return null;
    }

    /** Stones only. Anything with real colour of its own is left alone. */
    function tintGem(mat, layer) {
      if (mat.chroma >= 12) return mat;
      var t = gemTintFromName(mat.name);
      if (t === null && layer) t = gemTintFromName(layer.name);
      if (!t) return mat;
      return { name: mat.name, hex: t, chroma: 255 };
    }

    function classify(name) {
      var segs = name.split("::");
      for (var i = segs.length - 1; i >= 0; i--) {
        var s = segs[i].trim();
        if (GEM_LAYER.test(s)) return "gem";
        if (METAL_LAYER.test(s)) return "metal";
      }
      if (METAL_WORDS.test(name)) return "metal";
      if (GEM_WORDS.test(name)) return "gem";
      if (CONSTRUCTION.test(name)) return null;
      return "metal";
    }

    // ── instance definitions: id -> member object ids ──
    var idefs = doc.instanceDefinitions();
    var idefMembers = {};
    for (var d = 0; d < idefs.count; d++) {
      var idef = idefs.get(d);
      idefMembers[idef.id] = idef.getObjectIds();
    }

    var objs = doc.objects();
    var total = objs.count;

    // Index every object by id so instance references can find their members.
    var byId = {};
    var records = [];
    for (var i = 0; i < total; i++) {
      var o = objs.get(i);
      var a = o.attributes();
      var rec = {
        obj: o,
        id: a.id,
        layerIndex: a.layerIndex,
        isDef: a.isInstanceDefinitionObject === true,
      };
      byId[a.id] = rec;
      records.push(rec);
    }

    var chunks = [];
    var missingMesh = 0;
    // Chunks are per BRep face; this groups the faces of one solid together so
    // winding can be judged against the solid's own centre.
    var groupId = 0;

    // Pull every cached render mesh off one geometry, transformed if needed.
    function harvest(geometry, bucket, xf, mat) {
      var type = geometry.constructor.name;
      var got = 0;
      groupId++;

      if (type === "Brep") {
        // Jewellery has to be watertight to be manufactured, so a closed Brep
        // is a real part. An open surface is construction geometry — a profile,
        // a cutter, a silhouette — and rendering it draws a stray gold outline
        // tracing the piece. Recorded per chunk and filtered once the whole
        // document is known, so a file made only of surfaces still shows.
        var solid = geometry.isSolid !== false;
        var faces = null;
        try { faces = geometry.faces(); } catch (err) { faces = null; }
        if (faces) {
          for (var f = 0; f < faces.count; f++) {
            var fm = null;
            try { fm = faces.get(f).getMesh(rhino.MeshType.Any); } catch (err) { fm = null; }
            if (fm) got += push(fm, bucket, xf, solid, mat) ? 1 : 0;
          }
        }
      } else if (type === "Extrusion") {
        var em = null;
        try { em = geometry.getMesh(rhino.MeshType.Any); } catch (err) { em = null; }
        if (em) got += push(em, bucket, xf, true, mat) ? 1 : 0;
      } else if (type === "SubD") {
        var sm = null;
        try { sm = rhino.Mesh.createFromSubDControlNet(geometry, false); } catch (err) { sm = null; }
        if (sm) got += push(sm, bucket, xf, true, mat) ? 1 : 0;
      } else if (type === "Mesh") {
        got += push(geometry, bucket, xf, true, mat) ? 1 : 0;
      }
      return got;
    }

    function push(rhinoMesh, bucket, xf, solid, mat) {
      var json;
      try { json = rhinoMesh.toThreejsJSON(); } catch (err) { return false; }
      var attrs = json && json.data && json.data.attributes;
      if (!attrs || !attrs.position) return false;

      var P = attrs.position.array;
      var N = attrs.normal ? attrs.normal.array : null;
      var srcIdx = json.data.index ? json.data.index.array : null;
      var vCount = P.length / 3;
      if (!vCount) return false;

      var pos = new Float32Array(P.length);
      var nrm = new Float32Array(P.length);

      var minx = Infinity, miny = Infinity, minz = Infinity;
      var maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;

      for (var v = 0; v < vCount; v++) {
        var x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
        var nx = N ? N[v * 3] : 0, ny = N ? N[v * 3 + 1] : 0, nz = N ? N[v * 3 + 2] : 0;

        if (xf) {
          // xf is row-major, as THREE.Matrix4.set expects.
          var tx = xf[0] * x + xf[1] * y + xf[2] * z + xf[3];
          var ty = xf[4] * x + xf[5] * y + xf[6] * z + xf[7];
          var tz = xf[8] * x + xf[9] * y + xf[10] * z + xf[11];
          x = tx; y = ty; z = tz;
          if (N) {
            var rx = xf[0] * nx + xf[1] * ny + xf[2] * nz;
            var ry = xf[4] * nx + xf[5] * ny + xf[6] * nz;
            var rz = xf[8] * nx + xf[9] * ny + xf[10] * nz;
            var len = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
            nx = rx / len; ny = ry / len; nz = rz / len;
          }
        }

        pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
        nrm[v * 3] = nx; nrm[v * 3 + 1] = ny; nrm[v * 3 + 2] = nz;

        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        if (z < minz) minz = z; if (z > maxz) maxz = z;
      }

      var idx;
      if (srcIdx) {
        idx = new Uint32Array(srcIdx.length);
        for (var k = 0; k < srcIdx.length; k++) idx[k] = srcIdx[k];
      } else {
        idx = new Uint32Array(vCount);
        for (var k2 = 0; k2 < vCount; k2++) idx[k2] = k2;
      }

      chunks.push({
        bucket: bucket, pos: pos, nrm: nrm, idx: idx, hasNormals: !!N,
        solid: solid !== false, group: groupId,
        matName: mat ? mat.name : "", matHex: mat ? mat.hex : "#ffffff",
        matLayer: mat ? mat.layer || "" : "",
        minx: minx, miny: miny, minz: minz, maxx: maxx, maxy: maxy, maxz: maxz,
        tris: idx.length / 3
      });
      return true;
    }

    // ── walk the document ──
    for (var r = 0; r < records.length; r++) {
      var rec = records[r];
      if (rec.isDef) continue; // reached through its instance references

      var layer = layerTable[rec.layerIndex];
      if (!layer || !layer.visible) continue;
      var bucket = classify(layer.name);
      if (!bucket) continue;

      var geometry = rec.obj.geometry();
      var type = geometry.constructor.name;
      var mat = resolveMaterial(rec.obj.attributes(), layer);
      // Names carry the stone type when the material does not carry the colour.
      if (bucket === "gem") mat = tintGem(mat, layer);

      /*
       * Copy, and carry the layer along.
       *
       * The copy matters: resolveMaterial hands back the shared table entry, so
       * writing the layer onto it would smear one object's layer across every
       * other object using that material.
       *
       * The layer is carried because it is how a jeweller separates stones -
       * "Gem 01" the centre, "Gem 02" the melee - and grouping stones by colour
       * alone merges all of those into a single object that cannot be picked
       * apart. Selecting one stone type to recolour needs the jeweller's own
       * grouping, not ours.
       */
      mat = {
        name: mat.name,
        hex: mat.hex,
        chroma: mat.chroma,
        layer: layer ? layer.name || "" : ""
      };

      if (type === "InstanceReference") {
        var ids = idefMembers[geometry.parentIdefId];
        // On the live rhino3dm object the matrix comes from toFloatArray(true)
        // — row-major, translation in elements 3/7/11. There is no .array
        // property here; three's loader only sees one because it serialises
        // the object through extractProperties first. Reading .array returned
        // undefined, so every instanced stone lost its transform and collapsed
        // onto the origin — a pile of gems at the centre of the piece.
        var xform = null;
        if (geometry.xform) {
          if (typeof geometry.xform.toFloatArray === "function") {
            xform = geometry.xform.toFloatArray(true);
          } else if (geometry.xform.array) {
            xform = geometry.xform.array;
          }
        }
        if (ids) {
          for (var m = 0; m < ids.length; m++) {
            var member = byId[ids[m]];
            if (member) harvest(member.obj.geometry(), bucket, xform, mat);
          }
        }
      } else {
        var solid = type === "Brep" || type === "Extrusion" || type === "SubD";
        var got = harvest(geometry, bucket, null, mat);
        // Curves, points and annotations have no mesh by nature; only a solid
        // that yielded nothing means Rhino saved the file without render meshes.
        if (solid && got === 0) missingMesh++;
      }

      if ((r & 31) === 0) post({ type: "progress", done: r, total: total });
    }

    doc.delete();

    /*
     * ── make triangle winding consistent ──
     *
     * Rhino does not wind BRep faces consistently across a document. Measured
     * on a real file, 87 of 194 stones came through wound backwards. Nothing
     * downstream can recover from that: computeVertexNormals derives direction
     * from winding, so those stones get inward normals and render inside-out —
     * a stone that looks like it is sitting upside down in its setting. Face
     * culling and any ray tracing against the mesh disagree with the shading
     * for the same reason.
     *
     * A solid's faces should all point away from its interior, so the solid's
     * own centre is the reference. Faces that mostly point inward get reversed.
     */
    var groups = {};
    for (var gi = 0; gi < chunks.length; gi++) {
      var gc = chunks[gi];
      var slot = groups[gc.group];
      if (!slot) slot = groups[gc.group] = { sx: 0, sy: 0, sz: 0, n: 0, items: [] };
      slot.items.push(gc);
      for (var vp = 0; vp < gc.pos.length; vp += 3) {
        slot.sx += gc.pos[vp]; slot.sy += gc.pos[vp + 1]; slot.sz += gc.pos[vp + 2];
        slot.n++;
      }
    }

    for (var key in groups) {
      var grp = groups[key];
      if (!grp.n) continue;
      var cx = grp.sx / grp.n, cy = grp.sy / grp.n, cz = grp.sz / grp.n;

      for (var ci = 0; ci < grp.items.length; ci++) {
        var ch = grp.items[ci];
        var P = ch.pos, IDX = ch.idx;
        var inward = 0, outward = 0;

        for (var t = 0; t < IDX.length; t += 3) {
          var a = IDX[t] * 3, b = IDX[t + 1] * 3, c = IDX[t + 2] * 3;
          var ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
          var vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
          var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          var mx = (P[a] + P[b] + P[c]) / 3 - cx;
          var my = (P[a + 1] + P[b + 1] + P[c + 1]) / 3 - cy;
          var mz = (P[a + 2] + P[b + 2] + P[c + 2]) / 3 - cz;
          if (nx * mx + ny * my + nz * mz < 0) inward++; else outward++;
        }

        if (inward <= outward) continue;

        // Reverse each triangle, and the stored normals with it so the two
        // never disagree.
        for (var r = 0; r < IDX.length; r += 3) {
          var tmp = IDX[r + 1]; IDX[r + 1] = IDX[r + 2]; IDX[r + 2] = tmp;
        }
        for (var q = 0; q < ch.nrm.length; q++) ch.nrm[q] = -ch.nrm[q];
      }
    }

    // ── drop open construction surfaces, if real solids are present ──
    var anySolid = false;
    for (var q = 0; q < chunks.length; q++) if (chunks[q].solid) { anySolid = true; break; }
    if (anySolid) {
      var solidsOnly = [];
      for (var q2 = 0; q2 < chunks.length; q2++) if (chunks[q2].solid) solidsOnly.push(chunks[q2]);
      chunks = solidsOnly;
    }

    // ── drop backdrop slabs: huge, flat, barely tessellated ──
    var ex = { minx: Infinity, miny: Infinity, minz: Infinity, maxx: -Infinity, maxy: -Infinity, maxz: -Infinity };
    for (var c = 0; c < chunks.length; c++) {
      var ch = chunks[c];
      if (ch.minx < ex.minx) ex.minx = ch.minx; if (ch.maxx > ex.maxx) ex.maxx = ch.maxx;
      if (ch.miny < ex.miny) ex.miny = ch.miny; if (ch.maxy > ex.maxy) ex.maxy = ch.maxy;
      if (ch.minz < ex.minz) ex.minz = ch.minz; if (ch.maxz > ex.maxz) ex.maxz = ch.maxz;
    }
    var extent = Math.max(ex.maxx - ex.minx, ex.maxy - ex.miny, ex.maxz - ex.minz);
    var keep = [];
    for (var c2 = 0; c2 < chunks.length; c2++) {
      var k = chunks[c2];
      var sx = k.maxx - k.minx, sy = k.maxy - k.miny, sz = k.maxz - k.minz;
      var longest = Math.max(sx, sy, sz), thinnest = Math.min(sx, sy, sz);
      var slab = longest >= extent * 0.6 && thinnest <= longest * 0.02 && k.tris < 500;
      if (!slab) keep.push(k);
    }
    if (!keep.length) keep = chunks;
    if (!keep.some(function (x) { return x.bucket === "metal"; })) {
      keep = keep.concat(chunks.filter(function (x) { return x.bucket === "metal"; }));
    }

    // ── concatenate each bucket into one buffer ──
    function build(bucket) {
      var parts = keep.filter(function (x) { return x.bucket === bucket; });
      if (!parts.length) return null;
      var nv = 0, ni = 0;
      for (var i = 0; i < parts.length; i++) { nv += parts[i].pos.length; ni += parts[i].idx.length; }
      var position = new Float32Array(nv);
      var normal = new Float32Array(nv);
      var index = new Uint32Array(ni);
      var vo = 0, io = 0;
      for (var j = 0; j < parts.length; j++) {
        var p = parts[j];
        position.set(p.pos, vo);
        normal.set(p.nrm, vo);
        var base = vo / 3;
        for (var q = 0; q < p.idx.length; q++) index[io + q] = p.idx[q] + base;
        vo += p.pos.length;
        io += p.idx.length;
      }
      return { position: position, normal: normal, index: index };
    }

    var metal = build("metal");

    /*
     * ── group stones by colour ──
     *
     * A piece can carry diamond, ruby and sapphire at once. Merging every stone
     * into one mesh forces them all to share a material, so a coloured stone
     * comes out as a white diamond. Grouping by the Rhino render material keeps
     * each colour separate and lets the viewer give each its own gem material.
     */
    function buildGems() {
      /*
       * Split by the jeweller's own grouping, not only by colour.
       *
       * Grouping by colour alone merges every white stone in a piece into one
       * object, so there is nothing to point at: a centre diamond and two
       * hundred melee stones are indistinguishable. Rhino layers already carry
       * that distinction - "Gem 01" the centre, "Gem 02" the pave - so the
       * layer is part of the key. Stones of one colour on one layer still merge
       * into a single draw call, which is what keeps pave affordable.
       */
      var byColour = {};
      for (var i = 0; i < keep.length; i++) {
        var k = keep[i];
        if (k.bucket !== "gem") continue;
        var gkey = k.matHex + "|" + (k.matLayer || "");
        var slot = byColour[gkey];
        if (!slot) {
          slot = byColour[gkey] = {
            hex: k.matHex,
            name: k.matName,
            layer: k.matLayer || "",
            parts: []
          };
        }
        slot.parts.push(k);
      }

      var out = [];
      for (var hexKey in byColour) {
        var grp = byColour[hexKey];
        var nv = 0, ni = 0;
        for (var a = 0; a < grp.parts.length; a++) {
          nv += grp.parts[a].pos.length;
          ni += grp.parts[a].idx.length;
        }
        if (!nv) continue;

        var position = new Float32Array(nv);
        var normal = new Float32Array(nv);
        var index = new Uint32Array(ni);
        var vo = 0, io = 0;
        for (var b = 0; b < grp.parts.length; b++) {
          var pt = grp.parts[b];
          position.set(pt.pos, vo);
          normal.set(pt.nrm, vo);
          var base = vo / 3;
          for (var q = 0; q < pt.idx.length; q++) index[io + q] = pt.idx[q] + base;
          vo += pt.pos.length;
          io += pt.idx.length;
        }
        out.push({
          position: position,
          normal: normal,
          index: index,
          color: grp.hex,
          material: grp.name,
          layer: grp.layer,
          // Mesh chunks merged in - BRep faces, not stones. Not a stone count.
          parts: grp.parts.length
        });
      }
      return out;
    }

    var gems = buildGems();

    var transfer = [];
    if (metal) transfer.push(metal.position.buffer, metal.normal.buffer, metal.index.buffer);
    for (var gx = 0; gx < gems.length; gx++) {
      transfer.push(gems[gx].position.buffer, gems[gx].normal.buffer, gems[gx].index.buffer);
    }

    post({ type: "done", metal: metal, gems: gems, missingMesh: missingMesh }, transfer);
  }
};
`;

let workerUrl: string | undefined;
function getWorkerUrl(): string {
  if (!workerUrl) {
    workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" }));
  }
  return workerUrl;
}

export function decodeRhinoDocument(
  buffer: ArrayBuffer,
  libraryPath: string,
  rules: DecodeRules,
  onProgress?: (done: number, total: number) => void,
): Promise<DecodedDocument> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(getWorkerUrl());

    const finish = (fn: () => void) => {
      worker.terminate();
      fn();
    };

    worker.onerror = (e) =>
      finish(() => reject(new Error(e.message || "The Rhino decoder failed to start.")));

    worker.onmessage = (e: MessageEvent) => {
      const data = e.data;
      if (data.type === "progress") {
        onProgress?.(data.done, data.total);
        return;
      }
      if (data.type === "error") {
        finish(() => reject(new Error(data.message)));
        return;
      }
      if (data.type === "done") {
        const notices: string[] = [];
        if (data.missingMesh > 0) {
          notices.push(
            `${data.missingMesh} part${data.missingMesh === 1 ? "" : "s"} had no render mesh and ` +
              `could not be shown. In Rhino, select all and run Mesh, then re-save.`,
          );
        }
        finish(() =>
          resolve({
            metal: data.metal,
            gems: data.gems ?? [],
            notices,
            missingMesh: data.missingMesh,
          }),
        );
      }
    };

    // The buffer is transferred, so the caller must not reuse it afterwards.
    worker.postMessage({ type: "decode", buffer, libraryPath, rules }, [buffer]);
  });
}
