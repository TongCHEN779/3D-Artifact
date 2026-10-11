// where the browser finds the model runtime and weights (GitHub Pages: files in this repo)
const AI_CFG = {
  loadOrt: () => import(new URL('vendor/ort/ort.wasm.bundle.min.mjs', document.baseURI).href),
  model: name => 'models/' + name,
};
// ===== AI line art & one-line drawing =====
// Models run in the browser with onnxruntime-web (WASM):
//   PiDiNet  – edge detection (boundaries, not brightness)
//   U²-Netp  – main-subject mask → clean outer outline
//   YuNet    – face box + eyes / nose / mouth corners → more detail where it matters
const AI = { ort: null, sess: {}, loading: null };

async function aiInit(onStatus) {
  if (AI.ort) return AI.ort;
  if (!AI.loading) AI.loading = (async () => {
    onStatus && onStatus('载入模型运行环境…');
    const ort = await AI_CFG.loadOrt();
    ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    AI.ort = ort; return ort;
  })();
  return AI.loading;
}
async function aiSession(name, onStatus) {
  if (AI.sess[name]) return AI.sess[name];
  const ort = await aiInit(onStatus);
  onStatus && onStatus('下载模型 ' + name + '…');
  const buf = AI_CFG.fetchModel ? await AI_CFG.fetchModel(name) : await (await fetch(AI_CFG.model(name))).arrayBuffer();
  AI.sess[name] = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'] });
  return AI.sess[name];
}

function canvasRGB(src, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, w, h);
  return x.getImageData(0, 0, w, h).data;
}
function bilinear(src, sw, sh, W, H) {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sh / H - 0.5)), y0 = fy | 0, y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sw / W - 0.5)), x0 = fx | 0, x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      out[y * W + x] = (src[y0 * sw + x0] * (1 - tx) + src[y0 * sw + x1] * tx) * (1 - ty) + (src[y1 * sw + x0] * (1 - tx) + src[y1 * sw + x1] * tx) * ty;
    }
  }
  return out;
}

// Each model output is computed once per image/crop and cached by the caller.
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
async function aiPart(name, colorCanvas, W, H, onStatus) {
  const ort = await aiInit(onStatus);
  if (name === 'edge' || name === 'sketch') {
    const sess = await aiSession(name === 'edge' ? 'pidinet.onnx' : 'sketch.onnx', onStatus);
    onStatus && onStatus(name === 'edge' ? '识别边缘…' : 'AI 正在画速写（约 5–20 秒）…');
    const lim = name === 'edge' ? 640 : 768, k = Math.min(1, lim / Math.max(W, H));
    const pw = Math.max(32, Math.round(W * k / 4) * 4), ph = Math.max(32, Math.round(H * k / 4) * 4);
    const d = canvasRGB(colorCanvas, pw, ph), t = new Float32Array(3 * pw * ph);
    for (let i = 0; i < pw * ph; i++) for (let c = 0; c < 3; c++) t[c * pw * ph + i] = name === 'edge' ? (d[i * 4 + c] / 255 - MEAN[c]) / STD[c] : d[i * 4 + c] / 255;
    const out = await sess.run({ img: new ort.Tensor('float32', t, [1, 3, ph, pw]) });
    let r = out[sess.outputNames[0]].data;
    if (name === 'sketch') { const q = new Float32Array(r.length); for (let i = 0; i < r.length; i++) q[i] = 1 - r[i]; r = q; } // ink amount
    return bilinear(r, pw, ph, W, H);
  }
  if (name === 'subject') {
    const u2 = await aiSession('u2netp.onnx', onStatus);
    onStatus && onStatus('识别主体…');
    const d = canvasRGB(colorCanvas, 320, 320), t = new Float32Array(3 * 320 * 320);
    let mx = 1; for (let i = 0; i < 320 * 320; i++) for (let c = 0; c < 3; c++) mx = Math.max(mx, d[i * 4 + c]);
    for (let i = 0; i < 320 * 320; i++) for (let c = 0; c < 3; c++) t[c * 102400 + i] = (d[i * 4 + c] / mx - MEAN[c]) / STD[c];
    const out = await u2.run({ [u2.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, 320, 320]) });
    const m0 = out[u2.outputNames[0]].data; let lo = Infinity, hi = -Infinity;
    for (const v of m0) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const mn = new Float32Array(m0.length); for (let i = 0; i < m0.length; i++) mn[i] = (m0[i] - lo) / (hi - lo + 1e-6);
    return bilinear(mn, 320, 320, W, H);
  }
  if (name === 'face') {
    const yu = await aiSession('yunet.onnx', onStatus);
    onStatus && onStatus('定位五官…');
    const d = canvasRGB(colorCanvas, 640, 640), t = new Float32Array(3 * 640 * 640);
    for (let i = 0; i < 640 * 640; i++) { t[i] = d[i * 4 + 2]; t[409600 + i] = d[i * 4 + 1]; t[819200 + i] = d[i * 4]; } // BGR, 0..255
    const out = await yu.run({ input: new ort.Tensor('float32', t, [1, 3, 640, 640]) });
    let face = null;
    for (const s of [8, 16, 32]) {
      const n = 640 / s, cls = out['cls_' + s].data, obj = out['obj_' + s].data, bb = out['bbox_' + s].data, kp = out['kps_' + s].data;
      for (let i = 0; i < cls.length; i++) {
        const sc = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
        if (sc < 0.6 || (face && sc <= face.score)) continue;
        const r = (i / n) | 0, c = i % n, sx = W / 640, sy = H / 640;
        const cx = (c + bb[i * 4]) * s, cy = (r + bb[i * 4 + 1]) * s, w = Math.exp(bb[i * 4 + 2]) * s, h = Math.exp(bb[i * 4 + 3]) * s;
        const pts = []; for (let j = 0; j < 5; j++) pts.push([(c + kp[i * 10 + 2 * j]) * s * sx, (r + kp[i * 10 + 2 * j + 1]) * s * sy]);
        face = { score: sc, box: [(cx - w / 2) * sx, (cy - h / 2) * sy, w * sx, h * sy], kps: pts };
      }
    }
    return face;
  }
}

// ---- stroke skeleton from the model outputs ----
function aiStrokeSkeleton(A, W, H, s, p, edits, ec) {
  const det = p.detail;                       // 0..1
  const sk = p.method === 'sketch';
  const hi = sk ? 0.75 - 0.35 * det : 0.85 - 0.5 * det, lo = hi * (sk ? 0.5 : 0.55);
  const useSubj = p.outline;
  const subj = new Uint8Array(W * H); for (let i = 0; i < subj.length; i++) subj[i] = !useSubj || A.subject[i] > 0.5 ? 1 : 0;
  const body = useSubj ? opening(subj, W, H, Math.round(0.4 / s)) : subj;
  const inner = useSubj ? erode(body, W, H, Math.round(1.9 / s)) : body;
  // feature zones: eyes (most detail) and mouth (lips only)
  const feat = new Uint8Array(W * H);
  if (A.face && p.face) {
    const [e1, e2, , m1, m2] = A.face.kps, ed = Math.hypot(e1[0] - e2[0], e1[1] - e2[1]);
    const ell = (c, ax, ay, v) => { for (let y = Math.max(0, c[1] - ay | 0); y < Math.min(H, c[1] + ay + 1); y++) for (let x = Math.max(0, c[0] - ax | 0); x < Math.min(W, c[0] + ax + 1); x++) { const q = ((x - c[0]) / ax) ** 2 + ((y - c[1]) / ay) ** 2; if (q < 1) feat[y * W + x] = v; } };
    ell(e1, ed * 0.33, ed * 0.2, 1); ell(e2, ed * 0.33, ed * 0.2, 1);
    const mw = Math.hypot(m1[0] - m2[0], m1[1] - m2[1]); ell([(m1[0] + m2[0]) / 2, (m1[1] + m2[1]) / 2], mw * 0.62, mw * 0.32, 2);
  }
  const fhi = sk ? hi * 0.85 : Math.max(0.12, 0.3 - 0.15 * det), flo = sk ? fhi * 0.5 : Math.max(0.06, 0.12 - 0.06 * det);
  const weak = new Uint8Array(W * H), strong = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (!inner[i]) continue;
    const f = feat[i], h = f === 1 ? fhi : f === 2 ? Math.max(fhi, hi * 0.9) : hi, l = f === 1 ? flo : lo;
    if (A.edge[i] > l) weak[i] = 1; if (A.edge[i] > h) strong[i] = 1;
  }
  const { lab, n } = label(weak, W, H), ok = new Uint8Array(n + 1);
  for (let i = 0; i < W * H; i++) if (strong[i]) ok[lab[i]] = 1;
  let lines = new Uint8Array(W * H); for (let i = 0; i < W * H; i++) lines[i] = weak[i] && ok[lab[i]] ? 1 : 0;
  if (!sk) lines = dilate(lines, W, H, 1);   // bridge pixel gaps in edge maps; sketch strokes are already continuous
  if (useSubj) {   // outline band of the subject, open where the photo is cut
    const a = dilate(body, W, H, 1), b = erode(body, W, H, 1), bd = Math.round(0.8 / s);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x; if (a[i] && !b[i] && x > bd && y > bd && x < W - bd && y < H - bd) lines[i] = 1; }
  }
  applyEdits(lines, W, H, s, ec, edits);
  // fill pinholes inside strokes so thinning does not leave little loops ("beads")
  const bg = new Uint8Array(W * H); for (let i = 0; i < bg.length; i++) bg[i] = lines[i] ? 0 : 1;
  const B = label(bg, W, H), edge = new Uint8Array(B.n + 1), maxHole = (1.0 / s) ** 2;
  for (let x = 0; x < W; x++) { edge[B.lab[x]] = 1; edge[B.lab[(H - 1) * W + x]] = 1; }
  for (let y = 0; y < H; y++) { edge[B.lab[y * W]] = 1; edge[B.lab[y * W + W - 1]] = 1; }
  for (let i = 0; i < bg.length; i++) { const l = B.lab[i]; if (l && !edge[l] && B.areas[l] < maxHole) lines[i] = 1; }
  const skel = thin(lines, W, H);
  // drop scraps: strokes shorter than ~2.5 mm (1.2 mm around eyes and mouth)
  const L = label(skel, W, H), bx = new Int32Array((L.n + 1) * 4).fill(-1), inFeat = new Uint8Array(L.n + 1);
  for (let i = 0; i < W * H; i++) { const l = L.lab[i]; if (!l) continue; const x = i % W, y = (i / W) | 0, o = l * 4;
    if (bx[o] < 0) { bx[o] = bx[o + 2] = x; bx[o + 1] = bx[o + 3] = y; } else { bx[o] = Math.min(bx[o], x); bx[o + 1] = Math.min(bx[o + 1], y); bx[o + 2] = Math.max(bx[o + 2], x); bx[o + 3] = Math.max(bx[o + 3], y); }
    if (feat[i]) inFeat[l] = 1; }
  for (let i = 0; i < W * H; i++) { const l = L.lab[i]; if (!l) continue; const o = l * 4, ext = Math.max(bx[o + 2] - bx[o], bx[o + 3] - bx[o + 1]) * s;
    if (ext < (inFeat[l] ? 1.2 : 2.5)) skel[i] = 0; }
  return skel;
}

// ---- one-line drawing: route a single pen stroke over the stroke graph ----
function oneLinePath(sk, W, H, s, p, face) {
  const g = skeletonGraph(sk, W, H);
  let edges = simplifyGraph(g, Math.max(4, Math.round((2.7 - 1.2 * p.detail) / s)));
  // nodes: give every edge end a node id with a position
  let nid = 0; const pos = [], key = new Map();
  const nodeAt = (id, pix) => {
    if (id >= 0 && key.has(id)) return key.get(id);
    const k = nid++; pos.push([(pix % W) + 0.5, ((pix / W) | 0) + 0.5]); if (id >= 0) key.set(id, k); return k;
  };
  const E = [];
  for (const e of edges) {
    const xy = e.pts.map(i => [(i % W) + 0.5, ((i / W) | 0) + 0.5]);
    if (xy.length < 2) continue;
    const a = e.closed ? nodeAt(-1, e.pts[0]) : nodeAt(e.a, e.pts[0]);
    const b = e.closed ? a : nodeAt(e.b, e.pts[e.pts.length - 1]);
    E.push({ a, b, pts: xy, w: plen(xy) });
  }
  if (!E.length) return null;
  // components (union-find); drop tiny scraps
  const par = pos.map((_, i) => i), find = i => par[i] === i ? i : (par[i] = find(par[i]));
  for (const e of E) par[find(e.a)] = find(e.b);
  const compLen = new Map(); for (const e of E) { const r = find(e.a); compLen.set(r, (compLen.get(r) || 0) + e.w); }
  const minLen = 2 * Math.max(4, Math.round(2.7 / s));
  let edgesKept = E.filter(e => compLen.get(find(e.a)) >= minLen || compLen.size === 1);
  if (!edgesKept.length) edgesKept = E;
  const adj = () => { const A = pos.map(() => []); edgesKept.forEach((e, i) => { A[e.a].push(i); if (e.b !== e.a) A[e.b].push(i); }); return A; };
  let A = adj();
  const deg = i => A[i].reduce((d, ei) => d + (edgesKept[ei].a === edgesKept[ei].b ? 2 : 1), 0);
  // face ellipse for connector penalty
  const fc = face ? [face.box[0] + face.box[2] / 2, face.box[1] + face.box[3] / 2] : null, fa = face ? [face.box[2] * 0.48, face.box[3] * 0.5] : null;
  const inFace = q => fc && ((q[0] - fc[0]) / fa[0]) ** 2 + ((q[1] - fc[1]) / fa[1]) ** 2 < 1;
  const tangent = n => {
    if (deg(n) !== 1) return null; const e = edgesKept[A[n][0]]; let q = e.pts; if (e.b === n && e.a !== n) q = q.slice().reverse();
    const k = Math.min(q.length - 1, 8), tx = q[0][0] - q[k][0], ty = q[0][1] - q[k][1], l = Math.hypot(tx, ty); return l ? [tx / l, ty / l] : null;
  };
  const curve = (a, b) => {
    const pa = pos[a], pb = pos[b], L = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) || 1e-6, d = [(pb[0] - pa[0]) / L, (pb[1] - pa[1]) / L];
    const ta = tangent(a), tb = tangent(b), m0 = (ta || d).map(v => v * L * 0.6), m1 = (tb ? tb.map(v => -v) : d).map(v => v * L * 0.6);
    const n = Math.max(3, Math.round(L)), out = [];
    for (let i = 0; i < n; i++) { const t = i / (n - 1), h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
      out.push([Math.min(W - 2, Math.max(1, h00 * pa[0] + h10 * m0[0] + h01 * pb[0] + h11 * m1[0])), Math.min(H - 2, Math.max(1, h00 * pa[1] + h10 * m0[1] + h01 * pb[1] + h11 * m1[1]))]); }
    return out;
  };
  // Prim: join islands with the cheapest (short, off-face, end-to-end) curved connector
  const used = new Set(edgesKept.flatMap(e => [e.a, e.b]));
  const par2 = pos.map((_, i) => i), f2 = i => par2[i] === i ? i : (par2[i] = f2(par2[i]));
  for (const e of edgesKept) par2[f2(e.a)] = f2(e.b);
  const nodes = [...used];
  let roots = new Set(nodes.map(f2));
  let mainRoot = null, best = -1;
  const cl = new Map(); for (const e of edgesKept) { const r = f2(e.a); cl.set(r, (cl.get(r) || 0) + e.w); }
  for (const [r, l] of cl) if (l > best) { best = l; mainRoot = r; }
  const inTree = new Set([mainRoot]);
  while (inTree.size < roots.size) {
    const T = nodes.filter(n => inTree.has(f2(n))), O = nodes.filter(n => !inTree.has(f2(n)));
    const cand = [];
    for (const a of O) for (const b of T) cand.push([Math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]), a, b]);
    cand.sort((u, v) => u[0] - v[0]);
    let pick = null;
    for (const [d0, a, b] of cand.slice(0, 60)) {
      if (pick && d0 > pick[0]) break;
      const c = curve(a, b), L = plen(c), fr = fc ? c.filter(inFace).length / c.length : 0;
      const ends = (deg(a) === 1) + (deg(b) === 1), cost = L * (1 + 3 * fr) * (1 - 0.15 * ends);
      if (!pick || cost < pick[0]) pick = [cost, a, b, c];
    }
    const [, a, b, c] = pick;
    edgesKept.push({ a, b, pts: c, w: plen(c), conn: true });
    inTree.add(f2(a)); A = adj();
  }
  // make it traversable in one stroke: double shortest paths between odd nodes (pen re-traces lines)
  const odd = nodes.filter(n => deg(n) % 2);
  const dij = src => {
    const dist = new Float64Array(pos.length).fill(Infinity), via = new Int32Array(pos.length).fill(-1), done = new Uint8Array(pos.length);
    dist[src] = 0; const heap = [[0, src]];
    while (heap.length) {
      let bi = 0; for (let i = 1; i < heap.length; i++) if (heap[i][0] < heap[bi][0]) bi = i;
      const [du, u] = heap.splice(bi, 1)[0]; if (done[u]) continue; done[u] = 1;
      for (const ei of A[u]) { const e = edgesKept[ei], v = e.a === u ? e.b : e.a, nd = du + e.w; if (nd < dist[v]) { dist[v] = nd; via[v] = ei; heap.push([nd, v]); } }
    }
    return { dist, via };
  };
  const D = new Map(); for (const o of odd) D.set(o, dij(o));
  const pairs = []; for (let i = 0; i < odd.length; i++) for (let j = i + 1; j < odd.length; j++) pairs.push([D.get(odd[i]).dist[odd[j]], odd[i], odd[j]]);
  pairs.sort((u, v) => u[0] - v[0]);
  const paired = new Set(), multi = edgesKept.map(e => ({ ...e })); let left = odd.length;
  for (const [d0, a, b] of pairs) {
    if (left <= 2 || paired.has(a) || paired.has(b) || !isFinite(d0)) continue;
    let v = b; const via = D.get(a).via;
    while (v !== a) { const e = edgesKept[via[v]]; multi.push({ ...e }); v = e.a === v ? e.b : e.a; }
    paired.add(a); paired.add(b); left -= 2;
  }
  // Hierholzer
  const MA = pos.map(() => []); multi.forEach((e, i) => { MA[e.a].push(i); if (e.b !== e.a) MA[e.b].push(i); });
  const usedE = new Uint8Array(multi.length), ptr = new Int32Array(pos.length);
  const start = odd.find(o => !paired.has(o)) ?? multi[0].a;
  const stack = [[start, -1]], circuit = [];
  while (stack.length) {
    const [u] = stack[stack.length - 1];
    while (ptr[u] < MA[u].length && usedE[MA[u][ptr[u]]]) ptr[u]++;
    if (ptr[u] === MA[u].length) circuit.push(stack.pop());
    else { const ei = MA[u][ptr[u]]; usedE[ei] = 1; const e = multi[ei]; stack.push([e.a === u ? e.b : e.a, ei]); }
  }
  circuit.reverse();
  let path = [];
  for (let i = 1; i < circuit.length; i++) {
    const [v, ei] = circuit[i], u = circuit[i - 1][0], e = multi[ei];
    let q = e.pts; const d0 = Math.hypot(q[0][0] - pos[u][0], q[0][1] - pos[u][1]), d1 = Math.hypot(q[q.length - 1][0] - pos[u][0], q[q.length - 1][1] - pos[u][1]);
    if (d1 < d0) q = q.slice().reverse();
    path.push(pos[u], ...q); void v;
  }
  // resample + light smoothing
  path = resamplePath(path, 0.15 / s);
  return smoothPath(path, 0.18 / s, false);
}
function plen(q) { let L = 0; for (let i = 1; i < q.length; i++) L += Math.hypot(q[i][0] - q[i - 1][0], q[i][1] - q[i - 1][1]); return L; }
function resamplePath(q, step) {
  if (q.length < 2) return q;
  const out = [q[0]]; let carry = 0;
  for (let i = 1; i < q.length; i++) {
    const a = q[i - 1], b = q[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let t = step - carry;
    while (t <= L) { out.push([a[0] + (b[0] - a[0]) * t / L, a[1] + (b[1] - a[1]) * t / L]); t += step; }
    carry = L - (t - step);
  }
  out.push(q[q.length - 1]); return out;
}
// render a pen path with uniform width into a 0..1 field
function pathField(path, W, H, widthPx) {
  const SS = 2, cv = document.createElement('canvas'); cv.width = W * SS; cv.height = H * SS;
  const x = cv.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#000'; x.fillRect(0, 0, cv.width, cv.height);
  x.strokeStyle = '#fff'; x.lineWidth = widthPx * SS; x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath(); x.moveTo(path[0][0] * SS, path[0][1] * SS); for (let i = 1; i < path.length; i++) x.lineTo(path[i][0] * SS, path[i][1] * SS); x.stroke();
  const d = x.getImageData(0, 0, cv.width, cv.height).data, f = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) { let a = 0; for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) a += d[((y * SS + j) * cv.width + xx * SS + i) * 4]; f[y * W + xx] = a / (255 * SS * SS); }
  return f;
}
