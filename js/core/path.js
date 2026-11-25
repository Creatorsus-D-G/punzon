const NUM = /-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g;

export function parsePath(d) {
  const out = [];
  if (!d) return out;
  const tokens = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d))) tokens.push(m[1] ? m[1] : parseFloat(m[2]));
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, prevC = null, prevQ = null, cmd = null;
  const num = () => (typeof tokens[i] === 'number' ? tokens[i++] : 0);
  while (i < tokens.length) {
    if (typeof tokens[i] === 'string') cmd = tokens[i++];
    if (cmd == null) break;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const bx = rel ? cx : 0, by = rel ? cy : 0;
    if (C === 'M') {
      cx = bx + num(); cy = by + num(); sx = cx; sy = cy;
      out.push({ cmd: 'M', x: cx, y: cy }); prevC = prevQ = null; cmd = rel ? 'l' : 'L';
    } else if (C === 'L') {
      cx = bx + num(); cy = by + num();
      out.push({ cmd: 'L', x: cx, y: cy }); prevC = prevQ = null;
    } else if (C === 'H') {
      cx = bx + num(); out.push({ cmd: 'L', x: cx, y: cy }); prevC = prevQ = null;
    } else if (C === 'V') {
      cy = by + num(); out.push({ cmd: 'L', x: cx, y: cy }); prevC = prevQ = null;
    } else if (C === 'C') {
      const x1 = bx + num(), y1 = by + num(), x2 = bx + num(), y2 = by + num(), x = bx + num(), y = by + num();
      out.push({ cmd: 'C', x1, y1, x2, y2, x, y }); prevC = { x: x2, y: y2 }; prevQ = null; cx = x; cy = y;
    } else if (C === 'S') {
      const x2 = bx + num(), y2 = by + num(), x = bx + num(), y = by + num();
      const x1 = prevC ? 2 * cx - prevC.x : cx, y1 = prevC ? 2 * cy - prevC.y : cy;
      out.push({ cmd: 'C', x1, y1, x2, y2, x, y }); prevC = { x: x2, y: y2 }; prevQ = null; cx = x; cy = y;
    } else if (C === 'Q') {
      const x1 = bx + num(), y1 = by + num(), x = bx + num(), y = by + num();
      out.push({ cmd: 'Q', x1, y1, x, y }); prevQ = { x: x1, y: y1 }; prevC = null; cx = x; cy = y;
    } else if (C === 'T') {
      const x = bx + num(), y = by + num();
      const x1 = prevQ ? 2 * cx - prevQ.x : cx, y1 = prevQ ? 2 * cy - prevQ.y : cy;
      out.push({ cmd: 'Q', x1, y1, x, y }); prevQ = { x: x1, y: y1 }; prevC = null; cx = x; cy = y;
    } else if (C === 'A') {
      const rx = Math.abs(num()), ry = Math.abs(num()), rot = num(), laf = num(), sf = num();
      const x = bx + num(), y = by + num();
      for (const c of arcToCubics(cx, cy, rx, ry, rot, laf, sf, x, y)) out.push(c);
      cx = x; cy = y; prevC = null; prevQ = null;
    } else if (C === 'Z') {
      out.push({ cmd: 'Z' }); cx = sx; cy = sy; prevC = prevQ = null;
    } else { i++; }
  }
  return out;
}

export function arcToCubics(x1, y1, rx, ry, deg, laf, sf, x2, y2) {
  if (!rx || !ry || (x1 === x2 && y1 === y2)) return [{ cmd: 'L', x: x2, y: y2 }];
  const phi = (deg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
  let rxs = rx * rx, rys = ry * ry;
  const lam = (x1p * x1p) / rxs + (y1p * y1p) / rys;
  if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; rxs = rx * rx; rys = ry * ry; }
  const sign = laf === sf ? -1 : 1;
  const den = rxs * y1p * y1p + rys * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, (rxs * rys - den) / (den || 1)));
  const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
  const ccx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const ccy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const d = ux * vx + uy * vy, l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    const a = Math.acos(Math.min(1, Math.max(-1, d / (l || 1))));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dth = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sf && dth > 0) dth -= 2 * Math.PI;
  if (sf && dth < 0) dth += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dth) / (Math.PI / 2)));
  const seg = dth / n, t = (4 / 3) * Math.tan(seg / 4);
  const pt = (a) => ({ x: ccx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, y: ccy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos });
  const dpt = (a) => ({ x: -rx * Math.sin(a) * cos - ry * Math.cos(a) * sin, y: -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos });
  const out = [];
  let a = th1, p = pt(a), dp = dpt(a);
  for (let k = 0; k < n; k++) {
    const a2 = a + seg, p2 = pt(a2), dp2 = dpt(a2);
    out.push({ cmd: 'C', x1: p.x + t * dp.x, y1: p.y + t * dp.y, x2: p2.x - t * dp2.x, y2: p2.y - t * dp2.y, x: p2.x, y: p2.y });
    a = a2; p = p2; dp = dp2;
  }
  return out;
}

function cubicToQuads(p0, p1, p2, p3, tol, out, depth) {
  const ax = (3 * p1.x - p0.x) / 2, ay = (3 * p1.y - p0.y) / 2;
  const bx = (3 * p2.x - p3.x) / 2, by = (3 * p2.y - p3.y) / 2;
  if (depth >= 9 || Math.hypot(ax - bx, ay - by) <= tol) {
    out.push({ x: (ax + bx) / 2, y: (ay + by) / 2, on: false }, { x: p3.x, y: p3.y, on: true });
    return;
  }
  const m = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const p01 = m(p0, p1), p12 = m(p1, p2), p23 = m(p2, p3);
  const p012 = m(p01, p12), p123 = m(p12, p23), mid = m(p012, p123);
  cubicToQuads(p0, p01, p012, mid, tol, out, depth + 1);
  cubicToQuads(mid, p123, p23, p3, tol, out, depth + 1);
}

export function segsToContours(segs, tol = 0.6) {
  const contours = [];
  let cur = null, cx = 0, cy = 0, sx = 0, sy = 0;
  const push = (p) => cur && cur.push(p);
  for (const s of segs) {
    if (s.cmd === 'M') {
      if (cur && cur.length > 1) contours.push(cur);
      cur = [{ x: s.x, y: s.y, on: true }]; cx = sx = s.x; cy = sy = s.y;
    } else if (!cur) { cur = [{ x: 0, y: 0, on: true }]; }
    if (s.cmd === 'L') { push({ x: s.x, y: s.y, on: true }); cx = s.x; cy = s.y; }
    else if (s.cmd === 'Q') { push({ x: s.x1, y: s.y1, on: false }, { x: s.x, y: s.y, on: true }); cx = s.x; cy = s.y; }
    else if (s.cmd === 'C') { cubicToQuads({ x: cx, y: cy }, { x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }, { x: s.x, y: s.y }, tol, cur, 0); cx = s.x; cy = s.y; }
    else if (s.cmd === 'Z') {
      if (cur && cur.length > 1) {
        const a = cur[0], b = cur[cur.length - 1];
        if (b.on && Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) cur.pop();
        contours.push(cur);
      }
      cur = null; cx = sx; cy = sy;
    }
  }
  if (cur && cur.length > 1) contours.push(cur);
  return contours.map(cleanContour).filter((c) => c.length > 2);
}

// Rota el contorno hasta que el primer punto sea on-curve. Imprescindible
// antes de emitir un M en SVG: un M sobre un punto de control deforma la curva.
function rotateToOn(c) {
  if (!c.length || c[0].on) return c;
  const i = c.findIndex((p) => p.on);
  if (i < 0) return c;
  return c.slice(i).concat(c.slice(0, i));
}

function cleanContour(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = out[out.length - 1];
    if (q && q.on && p.on && Math.hypot(p.x - q.x, p.y - q.y) < 1e-6) continue;
    if (q && !q.on && !p.on) out.push({ x: (q.x + p.x) / 2, y: (q.y + p.y) / 2, on: true });
    out.push(p);
  }
  const a = out[0], b = out[out.length - 1];
  if (a && b && a.on && b.on && Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) out.pop();
  return rotateToOn(out);
}

export function flatten(contour, steps = 6) {
  const poly = [];
  const n = contour.length;
  for (let i = 0; i < n; i++) {
    const p = contour[i], q = contour[(i + 1) % n];
    if (p.on) { poly.push({ x: p.x, y: p.y }); continue; }
    const prev = contour[(i - 1 + n) % n];
    const start = prev.on ? prev : { x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 };
    const end = q.on ? q : { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    for (let t = 1; t <= steps; t++) {
      const u = t / steps, v = 1 - u;
      poly.push({ x: v * v * start.x + 2 * v * u * p.x + u * u * end.x, y: v * v * start.y + 2 * v * u * p.y + u * u * end.y });
    }
  }
  return poly;
}

export const area = (poly) => {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) { const a = poly[i], b = poly[(i + 1) % n]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
};

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x) inside = !inside;
  }
  return inside;
}

// Invertir el sentido de un contorno TrueType equivale a invertir la lista,
// pero hay que volver a empezar en un punto on-curve para que el M sea válido.
export function reverseContour(c) { return rotateToOn(c.slice().reverse()); }

export function orient(contours, mode = 'nest') {
  const polys = contours.map((c) => flatten(c, 5));
  const areas = polys.map(area);
  return contours.map((c, i) => {
    let want;
    if (mode === 'union') want = -1;
    else if (mode === 'hole') want = 1;
    else {
      let depth = 0;
      const probe = polys[i][0];
      for (let j = 0; j < polys.length; j++) {
        if (j !== i && Math.abs(areas[j]) > Math.abs(areas[i]) && pointInPoly(probe, polys[j])) depth++;
      }
      want = depth % 2 === 0 ? -1 : 1;
    }
    const sign = areas[i] >= 0 ? 1 : -1;
    return sign === want ? rotateToOn(c) : reverseContour(c);
  });
}

export function contoursBBox(contours) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of contours) for (const p of c) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
  return contours.length ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 } : { x0: 0, y0: 0, x1: 0, y1: 0, w: 0, h: 0 };
}

export function transformContours(contours, f) {
  return contours.map((c) => c.map((p) => { const q = f(p.x, p.y); return { x: q.x, y: q.y, on: p.on }; }));
}

export function contoursToD(contours) {
  return contours.map((raw) => {
    const c = rotateToOn(raw);
    if (c.length < 3 || !c[0].on) return '';
    const n = c.length;
    let d = `M${r2(c[0].x)} ${r2(c[0].y)}`;
    for (let i = 1; i <= n; i++) {
      const p = c[i % n];
      if (p.on) { d += `L${r2(p.x)} ${r2(p.y)}`; continue; }
      const nx = c[(i + 1) % n];
      const end = nx.on ? nx : { x: (p.x + nx.x) / 2, y: (p.y + nx.y) / 2 };
      d += `Q${r2(p.x)} ${r2(p.y)} ${r2(end.x)} ${r2(end.y)}`;
      if (!nx.on) i++;
    }
    return d + 'Z';
  }).filter(Boolean).join(' ');
}
export const r2 = (v) => Math.round(v * 100) / 100;

export function rdp(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const A = pts[a], B = pts[b];
    const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy) || 1e-9;
    let far = -1, dist = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - A[0]) * dy - (pts[i][1] - A[1]) * dx) / len;
      if (d > dist) { dist = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export function smoothPts(pts, amount) {
  if (amount <= 0 || pts.length < 3) return pts.slice();
  let out = pts.map((p) => p.slice());
  const passes = Math.max(1, Math.round(amount * 4));
  for (let k = 0; k < passes; k++) {
    const nx = out.map((p) => p.slice());
    for (let i = 1; i < out.length - 1; i++) {
      nx[i][0] = (out[i - 1][0] + 2 * out[i][0] + out[i + 1][0]) / 4;
      nx[i][1] = (out[i - 1][1] + 2 * out[i][1] + out[i + 1][1]) / 4;
    }
    out = nx;
  }
  return out;
}

export function strokeContours(pts, width, closed = false, seg = 14) {
  const contours = [];
  const w = Math.max(0.6, width) / 2;
  const P = pts.map((p) => ({ x: p[0], y: p[1] }));
  if (!P.length) return contours;
  if (P.length === 1) P.push({ x: P[0].x + 0.01, y: P[0].y });
  const list = closed ? P.concat([P[0]]) : P;
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i], b = list[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
    if (l < 1e-6) continue;
    const nx = (-dy / l) * w, ny = (dx / l) * w;
    contours.push([
      { x: a.x + nx, y: a.y + ny, on: true }, { x: b.x + nx, y: b.y + ny, on: true },
      { x: b.x - nx, y: b.y - ny, on: true }, { x: a.x - nx, y: a.y - ny, on: true }
    ]);
  }
  for (const p of P) {
    const ring = [];
    for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; ring.push({ x: p.x + Math.cos(a) * w, y: p.y + Math.sin(a) * w, on: true }); }
    contours.push(ring);
  }
  return contours;
}

export function roundPolygon(pts, amount) {
  if (amount <= 0.01 || pts.length < 3) return pts.map((p) => ({ x: p[0], y: p[1], on: true }));
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const d1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1e-9;
    const d2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1e-9;
    const r = Math.min(d1, d2) * 0.5 * amount;
    const a = { x: cur[0] + ((prev[0] - cur[0]) / d1) * r, y: cur[1] + ((prev[1] - cur[1]) / d1) * r };
    const b = { x: cur[0] + ((next[0] - cur[0]) / d2) * r, y: cur[1] + ((next[1] - cur[1]) / d2) * r };
    out.push({ x: a.x, y: a.y, on: true }, { x: cur[0], y: cur[1], on: false }, { x: b.x, y: b.y, on: true });
  }
  return out;
}

export function rectSegs(x, y, w, h) {
  return [{ cmd: 'M', x, y }, { cmd: 'L', x: x + w, y }, { cmd: 'L', x: x + w, y: y + h }, { cmd: 'L', x, y: y + h }, { cmd: 'Z' }];
}
export function ellipseSegs(cx, cy, rx, ry) {
  const k = 0.5522847498;
  return [
    { cmd: 'M', x: cx + rx, y: cy },
    { cmd: 'C', x1: cx + rx, y1: cy + ry * k, x2: cx + rx * k, y2: cy + ry, x: cx, y: cy + ry },
    { cmd: 'C', x1: cx - rx * k, y1: cy + ry, x2: cx - rx, y2: cy + ry * k, x: cx - rx, y: cy },
    { cmd: 'C', x1: cx - rx, y1: cy - ry * k, x2: cx - rx * k, y2: cy - ry, x: cx, y: cy - ry },
    { cmd: 'C', x1: cx + rx * k, y1: cy - ry, x2: cx + rx, y2: cy - ry * k, x: cx + rx, y: cy },
    { cmd: 'Z' }
  ];
}
export function segsToD(segs) {
  return segs.map((s) => {
    if (s.cmd === 'M' || s.cmd === 'L') return `${s.cmd}${r2(s.x)} ${r2(s.y)}`;
    if (s.cmd === 'Q') return `Q${r2(s.x1)} ${r2(s.y1)} ${r2(s.x)} ${r2(s.y)}`;
    if (s.cmd === 'C') return `C${r2(s.x1)} ${r2(s.y1)} ${r2(s.x2)} ${r2(s.y2)} ${r2(s.x)} ${r2(s.y)}`;
    return 'Z';
  }).join(' ');
}
export function applyMatrix(segs, m) {
  const t = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
  return segs.map((s) => {
    const o = { cmd: s.cmd };
    for (const key of ['x', 'x1', 'x2']) {
      if (s[key] === undefined) continue;
      const yKey = key.replace('x', 'y');
      const p = t(s[key], s[yKey]);
      o[key] = p.x; o[yKey] = p.y;
    }
    return o;
  });
}
export const matIdentity = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
export function matMul(m, n) {
  return {
    a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f
  };
}
export function parseTransform(str) {
  let m = matIdentity();
  if (!str) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let t;
  while ((t = re.exec(str))) {
    const v = (t[2].match(NUM) || []).map(Number);
    let n = matIdentity();
    if (t[1] === 'matrix' && v.length >= 6) n = { a: v[0], b: v[1], c: v[2], d: v[3], e: v[4], f: v[5] };
    else if (t[1] === 'translate') n = { a: 1, b: 0, c: 0, d: 1, e: v[0] || 0, f: v[1] || 0 };
    else if (t[1] === 'scale') n = { a: v[0] ?? 1, b: 0, c: 0, d: v[1] ?? v[0] ?? 1, e: 0, f: 0 };
    else if (t[1] === 'rotate') {
      const a = ((v[0] || 0) * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
      n = { a: co, b: si, c: -si, d: co, e: 0, f: 0 };
      if (v.length >= 3) {
        const cx = v[1], cy = v[2];
        n = matMul(matMul({ a: 1, b: 0, c: 0, d: 1, e: cx, f: cy }, n), { a: 1, b: 0, c: 0, d: 1, e: -cx, f: -cy });
      }
    } else if (t[1] === 'skewX') { const a = ((v[0] || 0) * Math.PI) / 180; n = { a: 1, b: 0, c: Math.tan(a), d: 1, e: 0, f: 0 }; }
    else if (t[1] === 'skewY') { const a = ((v[0] || 0) * Math.PI) / 180; n = { a: 1, b: Math.tan(a), c: 0, d: 1, e: 0, f: 0 }; }
    m = matMul(m, n);
  }
  return m;
        }
