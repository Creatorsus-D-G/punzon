import {
  parsePath, applyMatrix, parseTransform, matMul, matIdentity,
  segsToD, segsToContours, contoursBBox, contoursToD,
  rectSegs, ellipseSegs, strokeContours, rdp, roundPolygon, area
} from './path.js';

export const uid = () => Math.random().toString(36).slice(2, 9);
export const escapeXML = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

/* ============================================================
   1. Raster → contornos
   ============================================================ */

export async function loadImage(file, max = 720) {
  let bmp = null;
  if ('createImageBitmap' in window) {
    try { bmp = await createImageBitmap(file); } catch { bmp = null; }
  }
  if (!bmp) {
    bmp = await new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('No se pudo leer la imagen.')); };
      img.src = url;
    });
  }
  const w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
  if (!w0 || !h0) throw new Error('La imagen no tiene dimensiones legibles.');
  const k = Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  return { data: ctx.getImageData(0, 0, w, h), w, h, canvas: cv, origW: w0, origH: h0 };
}

function binary(img, threshold, invert) {
  const { data, w, h } = img;
  const b = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < b.length; i++, p += 4) {
    const a = data[p + 3] / 255;
    const lum = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) * a + 255 * (1 - a);
    const on = lum < threshold;
    b[i] = invert ? (on ? 0 : 1) : (on ? 1 : 0);
  }
  return b;
}

// Recorre las aristas frontera de los píxeles encendidos manteniendo el relleno
// a la derecha del recorrido: los exteriores salen horarios y los huecos antihorarios.
function traceEdges(b, w, h) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : b[y * w + x]);
  const key = (x, y) => y * (w + 1) + x;
  const edges = new Map();
  const add = (x0, y0, x1, y1) => {
    const k = key(x0, y0);
    let arr = edges.get(k);
    if (!arr) edges.set(k, (arr = []));
    arr.push([x1, y1, false]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) add(x, y, x + 1, y);
    if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
    if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
    if (!at(x - 1, y)) add(x, y + 1, x, y);
  }
  const loops = [];
  for (const [startKey, list] of edges) {
    for (const start of list) {
      if (start[2]) continue;
      const sx = startKey % (w + 1), sy = Math.floor(startKey / (w + 1));
      const pts = [[sx, sy]];
      let cx = start[0], cy = start[1];
      start[2] = true;
      let guard = 0;
      while (!(cx === sx && cy === sy) && guard++ < 400000) {
        pts.push([cx, cy]);
        const cand = (edges.get(key(cx, cy)) || []).filter((e) => !e[2]);
        if (!cand.length) break;
        const px = pts[pts.length - 2][0], py = pts[pts.length - 2][1];
        const dx = cx - px, dy = cy - py;
        cand.sort((A, B) => (dx * (B[1] - cy) - dy * (B[0] - cx)) - (dx * (A[1] - cy) - dy * (A[0] - cx)));
        const nx = cand[0];
        nx[2] = true; cx = nx[0]; cy = nx[1];
      }
      if (pts.length > 3) loops.push(pts);
    }
  }
  return loops;
}

const collinear = (pts) => {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n], b = pts[i], c = pts[(i + 1) % n];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out.length > 2 ? out : pts;
};

export function trace(img, o) {
  const b = binary(img, o.threshold, o.invert);
  let loops = traceEdges(b, img.w, img.h).map(collinear);
  const minA = Math.max(0, o.despeckle);
  loops = loops.filter((p) => Math.abs(area(p.map(([x, y]) => ({ x, y })))) >= minA);
  const contours = loops.map((p) => {
    const closed = p.concat([p[0]]);
    const s = rdp(closed, Math.max(0.2, o.simplify)).slice(0, -1);
    return roundPolygon(s.length > 2 ? s : p, o.smooth);
  }).filter((c) => c.length > 2);
  const scale = o.height / Math.max(1, img.h);
  const moved = contours.map((c) => c.map((p) => ({
    x: (p.x - img.w / 2) * scale * (o.flipX ? -1 : 1) + o.dx + o.width / 2,
    y: (img.h - p.y) * scale + o.dy,
    on: p.on
  })));
  return { contours: moved, count: moved.length, points: moved.reduce((s, c) => s + c.length, 0) };
}

export function tracePreviewSVG(contours, box, color = '#F2A03D') {
  const d = contoursToD(contours);
  const w = Math.max(1, Math.round(box.w)), h = Math.max(1, Math.round(box.h));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${box.x} ${box.y} ${box.w} ${box.h}"><g transform="translate(0,${box.y * 2 + box.h}) scale(1,-1)"><path d="${d}" fill="${color}" fill-rule="nonzero"/></g></svg>`;
}

/* ============================================================
   2. SVG → contornos
   ============================================================ */

const shapeToSegs = (el) => {
  const n = (a, d = 0) => parseFloat(el.getAttribute(a) ?? d) || 0;
  const t = el.tagName.toLowerCase();
  if (t === 'path') return parsePath(el.getAttribute('d') || '');
  if (t === 'rect') return rectSegs(n('x'), n('y'), n('width'), n('height'));
  if (t === 'circle') return ellipseSegs(n('cx'), n('cy'), n('r'), n('r'));
  if (t === 'ellipse') return ellipseSegs(n('cx'), n('cy'), n('rx'), n('ry'));
  if (t === 'line') return [{ cmd: 'M', x: n('x1'), y: n('y1') }, { cmd: 'L', x: n('x2'), y: n('y2') }];
  if (t === 'polygon' || t === 'polyline') {
    const nums = (el.getAttribute('points') || '').match(/-?(?:\d*\.\d+|\d+)/g)?.map(Number) || [];
    const segs = [];
    for (let i = 0; i + 1 < nums.length; i += 2) segs.push({ cmd: i ? 'L' : 'M', x: nums[i], y: nums[i + 1] });
    if (t === 'polygon' && segs.length) segs.push({ cmd: 'Z' });
    return segs;
  }
  return null;
};

export function importSVG(text, opts = {}) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror')) throw new Error('El SVG no se pudo analizar: XML inválido.');
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') throw new Error('El documento no tiene un <svg> raíz.');
  const warnings = [];
  const objects = [];
  const defs = new Map();
  root.querySelectorAll('[id]').forEach((e) => defs.set(e.id, e));

  const styleOf = (el, prop) => {
    const st = el.getAttribute('style');
    if (st) { const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`).exec(st); if (m) return m[1].trim(); }
    let cur = el;
    while (cur && cur.getAttribute) { const v = cur.getAttribute(prop); if (v) return v; cur = cur.parentElement; }
    return null;
  };

  const walk = (el, mat, depth) => {
    if (depth > 24) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'defs' || tag === 'metadata' || tag === 'title' || tag === 'desc' || tag === 'style') return;
    if (styleOf(el, 'display') === 'none') return;
    const m = matMul(mat, parseTransform(el.getAttribute('transform')));

    if (tag === 'use') {
      const id = (el.getAttribute('href') || el.getAttribute('xlink:href') || '').replace('#', '');
      const ref = defs.get(id);
      if (ref) {
        walk(ref, matMul(m, { a: 1, b: 0, c: 0, d: 1, e: parseFloat(el.getAttribute('x')) || 0, f: parseFloat(el.getAttribute('y')) || 0 }), depth + 1);
      } else warnings.push(`<use> sin destino: ${id || 'vacío'}.`);
      return;
    }
    if (tag === 'image') { warnings.push('Hay una imagen raster incrustada: usa el laboratorio de Trazo para vectorizarla.'); return; }
    if (tag === 'text' || tag === 'tspan') { warnings.push('Hay <text>: convierte el texto a trazados antes de importar.'); return; }

    const segs = shapeToSegs(el);
    if (segs && segs.length) {
      const moved = applyMatrix(segs, m);
      const fill = styleOf(el, 'fill');
      const stroke = styleOf(el, 'stroke');
      const sw = parseFloat(styleOf(el, 'stroke-width') || '1');
      const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
      const strokeOnly = fill === 'none' && stroke && stroke !== 'none';
      if (strokeOnly) {
        // Un objeto de trazo por subcontorno: antes se mezclaban todos en una polilínea.
        for (const c of segsToContours(moved, 0.6)) {
          const pts = c.filter((p) => p.on).map((p) => [p.x, p.y]);
          if (pts.length > 1) objects.push({ id: uid(), type: 'stroke', pts, width: Math.max(2, sw * scale), closed: false, visible: true });
        }
      } else if (fill !== 'none') {
        objects.push({ id: uid(), type: 'path', d: segsToD(moved), mode: 'nest', visible: true });
      }
      return;
    }
    for (const child of el.children) walk(child, m, depth + 1);
  };
  walk(root, matIdentity(), 0);
  if (!objects.length) throw new Error('No se encontraron formas vectoriales importables.');

  let contours = [];
  for (const o of objects) {
    if (o.type === 'path') contours.push(...segsToContours(parsePath(o.d), 0.6));
    else contours.push(...strokeContours(o.pts, o.width, false, 12));
  }
  const bb = contoursBBox(contours);
  const target = opts.height || 700;
  const k = bb.h > 0 ? target / bb.h : 1;
  const advance = opts.advance || 600;
  const dx = -(bb.x0 + bb.w / 2) * k + advance / 2;
  const dy = -bb.y0 * k;
  for (const o of objects) {
    if (o.type === 'path') o.d = segsToD(applyMatrix(parsePath(o.d), { a: k, b: 0, c: 0, d: k, e: dx, f: dy }));
    else { o.pts = o.pts.map(([x, y]) => [x * k + dx, y * k + dy]); o.width *= k; }
  }
  return { objects, warnings, bbox: bb, scale: k, advance: Math.round(Math.max(advance, bb.w * k + 80)) };
}

/* ============================================================
   3. Contornos → SVG
   ============================================================ */

// El glifo vive en coordenadas de fuente (y hacia arriba). Para llevarlo al
// viewBox se traslada al ascender y se invierte el eje: y=asc → 0, y=desc → alto.
export function glyphSVG(glyph, metrics, color = '#F2A03D', contours = []) {
  const d = contoursToD(contours);
  const w = Math.max(1, Math.round(glyph.advance || 600));
  const h = Math.max(1, Math.round(metrics.ascender - metrics.descender));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><g transform="translate(0,${metrics.ascender}) scale(1,-1)"><path d="${d}" fill="${color}" fill-rule="nonzero"/></g></svg>`;
}

export function sheetSVG(project, contoursOf, cols = 8) {
  const keys = (project.order || []).filter((k) => project.glyphs[k]?.objects?.length);
  const cell = 1000, pad = 60;
  const rows = Math.max(1, Math.ceil(keys.length / cols));
  const W = cols * cell + pad * 2, H = rows * (cell + 120) + pad * 2 + 140;
  let body = '';
  keys.forEach((k, i) => {
    const g = project.glyphs[k];
    const cx = pad + (i % cols) * cell, cy = pad + 140 + Math.floor(i / cols) * (cell + 120);
    const d = contoursToD(contoursOf(g));
    body += `<g transform="translate(${cx},${cy})"><rect x="0" y="0" width="${cell - 20}" height="${cell}" rx="18" fill="#12161F" stroke="#2C3648"/><g transform="translate(${(cell - 20 - g.advance) / 2},${cell * 0.78}) scale(1,-1)"><path d="${d}" fill="#F2A03D" fill-rule="nonzero"/></g><text x="14" y="${cell + 46}" font-family="monospace" font-size="42" fill="#8D97A8">${escapeXML(g.char)} · U+${(g.unicode || 0).toString(16).toUpperCase().padStart(4, '0')}</text></g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#07090E"/><text x="${pad}" y="${pad + 60}" font-family="system-ui,sans-serif" font-size="64" font-weight="700" fill="#F3EAD9">${escapeXML(project.meta.family)}</text><text x="${pad}" y="${pad + 110}" font-family="monospace" font-size="34" fill="#2BD9E8">${keys.length} glifos · ${project.metrics.unitsPerEm} upem · Punzón</text>${body}</svg>`;
}

export function specimenSVG(project, contoursOf, text, size, color, bg) {
  const k = size / project.metrics.unitsPerEm;
  let x = 40, body = '';
  for (const ch of String(text)) {
    const g = project.glyphs[ch];
    if (!g) { x += size * 0.3; continue; }
    body += `<g transform="translate(${x},${size * 1.1}) scale(${k},${-k})"><path d="${contoursToD(contoursOf(g))}" fill="${color}" fill-rule="nonzero"/></g>`;
    x += g.advance * k;
  }
  const W = Math.max(320, Math.round(x + 40)), H = Math.round(size * 1.7);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${bg}"/>${body}</svg>`;
}

/* ============================================================
   4. Rasterizado con el motor del navegador
   ============================================================ */

export async function svgToPng(svgText, scale = 2) {
  const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('El navegador no pudo rasterizar el SVG.'));
      i.src = url;
    });
    const vb = /viewBox="([^"]+)"/.exec(svgText)?.[1].trim().split(/[\s,]+/).map(Number);
    const w = img.naturalWidth || img.width || (vb && vb[2]) || 1024;
    const h = img.naturalHeight || img.height || (vb && vb[3]) || 1024;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * scale));
    cv.height = Math.max(1, Math.round(h * scale));
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    const blob = await new Promise((res) => cv.toBlob(res, 'image/png'));
    if (!blob) throw new Error('El canvas no produjo un PNG.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}
