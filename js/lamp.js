// ===== Spherical lamp shade =====
// A lithophane wrapped around a sphere. The photo is mapped with a Mercator projection (shapes stay undistorted),
// the outer surface is carved inwards where the photo is bright, the inside is a smooth ball. The bottom is open:
// a neck tube with either an internal thread or a few snap hooks, plus a matching adapter ring to attach to a lamp base.
// Axis = z, bottom of the neck on z = 0.

const mercator = th => Math.log(Math.tan(th / 2));

// Thread profile in polar form: r(θ) = rBase + depth · f(θ). One lobe, 45° flanks, so one turn of twist = one pitch.
function threadRing(rBase, depth, pitch, crestAx) {
  const ang = ax => ax / pitch * 360, halfFlat = ang(crestAx) / 2, ramp = ang(depth), pts = [];
  for (let i = 0; i < 180; i++) {
    let th = i * 2 - 180;                                           // −180 … 178°
    const f = Math.max(0, Math.min(1, 1 - (Math.abs(th) - halfFlat) / ramp)), r = rBase + depth * f, a = th * Math.PI / 180;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

function lampGeometry(p) {
  const R = p.lampD / 2, Ri = R - p.tMax;
  let ai = Math.min(p.lampOpen / 2, Ri * 0.85);                      // bore radius (clear opening)
  const thread = p.fix === 'thread', pitch = p.pitch, dT = 0.25 * pitch, crest = 0.15 * pitch, gap = p.fitGap;
  const wall = thread ? dT + 2.2 : 2.4;
  const z0 = -Math.sqrt(Ri * Ri - ai * ai);                           // plane where the inner ball is exactly as wide as the bore
  const rOutPlane = Math.sqrt(R * R - z0 * z0);
  let Ro = ai + wall;
  if (Ro > rOutPlane - 0.3) Ro = rOutPlane - 0.3;
  return { R, Ri, ai, z0, rOutPlane, Ro, thread, pitch, dT, crest, gap, neckH: p.neckH, thetaP: Math.acos(z0 / R), thinWall: Ro - ai < wall - 0.01 };
}

function buildLamp(gray, W, H, p) {
  const { Manifold, CrossSection } = MF, warnings = [];
  const g = lampGeometry(p), { R, Ri, ai, z0, Ro, thread, pitch, dT, crest, gap, neckH } = g;
  if (g.thinWall) warnings.push('开口太大，颈部管壁变薄了。请加大球径或减小开口直径。');

  // ----- mapping photo → sphere -----
  const thA = Math.max(5, Math.min(p.lampTop, (g.thetaP * 180 / Math.PI) - 25)) * Math.PI / 180, thP = g.thetaP;
  const mA = mercator(thA), dm = mercator(thP) - mA, n = Math.max(1, Math.round(p.copies));
  const natural = dm * W / H, tile = 2 * Math.PI / n, span = Math.min(natural, tile);
  if (n > 1 && natural > tile + 1e-6) warnings.push(`${n} 张图排不下（每张最多 ${(tile * 180 / Math.PI).toFixed(0)}°，图片需要 ${(natural * 180 / Math.PI).toFixed(0)}°），图案被横向压窄了。减少张数或裁剪一下图片。`);
  const arcW = R * span * Math.sin((thA + thP) / 2);                 // tile width in mm around mid-height

  if (p.denoise > 0) {
    const r = Math.max(2, Math.min(20, Math.round(0.6 / (arcW / W))));
    gray = guidedDenoise(Float32Array.from(gray), W, H, r, 8 * p.denoise / 100);
  }
  // thickness grid of one tile, about 1.5 samples per mesh step
  const res = p.lampRes, wg = Math.max(48, Math.min(W, Math.round(arcW / (res * 0.7)))), k = wg / W, hg = Math.max(16, Math.round(H * k));
  const bl = gaussBlur(gray, W, H, Math.max(0.5, 0.5 / k)), Z = new Float32Array(wg * hg);
  for (let y = 0; y < hg; y++) for (let x = 0; x < wg; x++) {
    const v = bl[Math.min(H - 1, Math.round((y + 0.5) / k - 0.5)) * W + Math.min(W - 1, Math.round((x + 0.5) / k - 0.5))];
    Z[y * wg + x] = p.tMin + (p.tMax - p.tMin) * Math.pow(Math.min(1, Math.max(0, 1 - v / 255)), p.gamma);
  }
  const thickAt = (u, v) => {
    const fx = Math.min(wg - 1, Math.max(0, u * wg - 0.5)), fy = Math.min(hg - 1, Math.max(0, v * hg - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(wg - 1, x0 + 1), y1 = Math.min(hg - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    return (Z[y0 * wg + x0] * (1 - ax) + Z[y0 * wg + x1] * ax) * (1 - ay) + (Z[y1 * wg + x0] * (1 - ax) + Z[y1 * wg + x1] * ax) * ay;
  };
  const front = -Math.PI / 2, frame = p.frame;
  const radiusAt = (x, y, z) => {
    const r0 = Math.sqrt(x * x + y * y + z * z), th = Math.acos(Math.max(-1, Math.min(1, z / r0)));
    if (th <= thA || th >= thP) return R;
    let d = Math.atan2(y, x) - front; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));   // −π … π
    const kk = Math.round(d / tile), rel = d - kk * tile, u = rel / span + 0.5;
    if (u < 0 || u > 1) return R;
    const sn = Math.sin(th), eu = Math.min(u, 1 - u) * span * R * sn, ev = R * Math.min(th - thA, thP - th);
    if (Math.min(eu, ev) < frame) return R;
    return Ri + thickAt(u, (mercator(th) - mA) / dm);
  };

  // ----- shell: carved outer ball minus smooth inner ball -----
  const segs = Math.max(96, Math.min(1800, Math.round(2 * Math.PI * R / res)));
  const ball = G(Manifold.sphere(R, segs));
  const carved = G(ball.warp(v => { const r = radiusAt(v[0], v[1], v[2]) / Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); v[0] *= r; v[1] *= r; v[2] *= r; }));
  const cap = G(carved.trimByPlane([0, 0, 1], z0));
  const inner = G(Manifold.sphere(Ri, Math.max(96, Math.min(360, segs))));
  const shell = G(cap.subtract(inner));

  // ----- neck -----
  const zb = z0 - neckH, SEG = 120;
  const cyl = (h, r, z) => G(G(Manifold.cylinder(h, r, -1, SEG)).translate([0, 0, z]));
  let neck = G(cyl(neckH, Ro, zb).subtract(cyl(neckH + 2, ai, zb - 1)));
  if (thread) {
    const ring = threadRing(ai, dT, pitch, crest + 2 * gap), len = neckH + 1;
    const void_ = G(G(new CrossSection([ring], 'Positive')).extrude(len, Math.ceil(len / pitch * 72), -360 * len / pitch));
    neck = G(neck.subtract(G(void_.translate([0, 0, zb - 0.5]))));
  } else {
    const tabs = Math.max(3, Math.min(8, Math.round(p.snaps))), tabW = Math.max(6, Math.min(11, 2 * Math.PI * ai / tabs * 0.38)), slotW = 1.0, ring = 3.2;
    const hh = 0.9, hx = tabW - 0.6;
    const cuts = [], hooks = [];
    for (let i = 0; i < tabs; i++) {
      const a = i * 360 / tabs + 45;
      for (const s of [-1, 1]) {
        const c = G(G(Manifold.cube([slotW, Ro + 3, neckH - ring + 1], false)).translate([s * (tabW / 2 + slotW / 2) - slotW / 2, 0, zb - 1]));
        cuts.push(G(c.rotate([0, 0, a])));
      }
      // hook: inward wedge at the free (lower) end of the tab, with a ramp at the bottom and a retaining face on top
      const pr = [[ai + 0.4, zb], [ai - hh * 0.5, zb], [ai - hh, zb + 1.1], [ai - hh, zb + 1.6], [ai + 0.4, zb + 2.4]], pts = [];
      for (const x of [-hx / 2, hx / 2]) for (const [r, z] of pr) pts.push([x, r, z]);
      hooks.push(G(G(Manifold.hull(pts)).rotate([0, 0, a])));
    }
    neck = G(neck.subtract(G(Manifold.union(cuts))));
    neck = G(Manifold.union([neck, ...hooks]));
  }
  let shade = G(Manifold.union(shell, neck));
  shade = G(shade.translate([0, 0, -zb]));

  // ----- adapter ring: flange + collar that goes into the neck -----
  const rc = ai - gap, flangeR = Ro + 6, flangeT = 3, Lc = neckH - 0.4, rcoreT = ai - gap;
  let adapter;
  const flange = G(Manifold.cylinder(flangeT, flangeR, -1, SEG));
  if (thread) {
    const rb = rcoreT - 2.2, ring = threadRing(rcoreT, dT, pitch, crest), len = Lc;
    let col = G(G(new CrossSection([ring], 'Positive')).extrude(len, Math.ceil(len / pitch * 72), -360 * len / pitch));
    const cone = G(Manifold.union([cyl(len - dT - 0.6, ai + dT + 2, 0), G(G(Manifold.cylinder(dT + 0.6, ai + dT + 0.2, rcoreT - 0.3, SEG)).translate([0, 0, len - dT - 0.6]))]));
    col = G(col.intersect(cone));
    col = G(col.subtract(cyl(len + 2, rb, -1)));
    adapter = G(Manifold.union(flange, G(col.translate([0, 0, flangeT]))));
    adapter = G(adapter.subtract(cyl(flangeT + 2, rb, -1)));
  } else {
    const gd = 0.9 + 0.3, floor = rc - gd, rb = floor - 1.8, gh = 3.2, ch = 1.2;
    const L = Lc;
    // collar profile (r, z): straight wall with a groove right above the flange, a lead-in chamfer on top
    const poly = [[rb, 0], [floor, 0], [floor, gh], [rc, gh + gd * 0.8], [rc, L - ch], [rc - ch, L], [rb, L]];
    const col = G(G(new CrossSection([poly], 'Positive')).revolve(SEG));
    adapter = G(Manifold.union(G(flange.subtract(cyl(flangeT + 2, rb, -1))), G(col.translate([0, 0, flangeT]))));
  }
  // three screw holes in the flange
  const hole = (a) => G(G(G(Manifold.cylinder(flangeT + 2, 1.7, -1, 24)).translate([Ro + 3, 0, -1])).rotate([0, 0, a]));
  adapter = G(adapter.subtract(Manifold.union([hole(30), hole(150), hole(270)])));

  const tri = { grid: true, Z, w: wg, h: hg, widthMM: arcW };
  return { shade, adapter, tri, warnings, info: { R, Ri, ai, Ro, z0, neckH, span, natural, copies: n, flangeR, thread } };
}
