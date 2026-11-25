import { $, $$, el, initShell, ctrl, group, toast, drawer, confirmDialog, download, debounce, clamp, bytes, slug, fileToText, sound } from '../ui.js';
import * as P from '../core/path.js';
import { glyphContours, buildFont, buildWoff, previewFace, fontCSS } from '../core/font.js';
import { importSVG, uid, sheetSVG, glyphSVG } from '../core/vector.js';
import * as PR from '../core/project.js';

const S = {
  cfg: null, project: null, key: 'A', tool: 'pen', quality: { tol: .5, seg: 20 },
  view: { k: .5, tx: 0, ty: 0 }, w: 0, h: 0, pointers: new Map(), drag: null,
  pen: null, free: null, shape: null, undo: [], redo: [], sel: null, node: null,
  pinching: null, dragObjId: null, lastShift: 0, lastScale: 100, sized: false
};
const stage = $('#stage'), world = $('#world');
const L = { grid: $('#gridLayer'), guide: $('#guideLayer'), ghost: $('#ghostLayer'), fill: $('#fillLayer'), stroke: $('#strokeLayer'), node: $('#nodeLayer') };
const glyph = () => S.project.glyphs[S.key];
const ed = () => S.project.editor;
const M = () => S.project.metrics;
const NS = 'http://www.w3.org/2000/svg';
const mk = (t, a) => { const n = document.createElementNS(NS, t); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };

(async function boot() {
  S.cfg = await initShell('editor');
  S.project = await PR.currentProject();
  S.key = S.project.order.find((k) => S.project.glyphs[k].objects.length) || 'A';
  if (!S.project.glyphs[S.key]) { S.project.glyphs[S.key] = PR.emptyGlyph(S.key); S.project.order.push(S.key); }
  applyQuality(ed().quality);
  buildTools(); buildCharset(); buildInspector(); fillMeta();
  bindStage(); bindKeys(); bindActions();
  new ResizeObserver(() => { sizeStage(); if (!S.sized && S.w > 0) { S.sized = true; fit(); } render(); }).observe(stage);
  sizeStage(); fit(); selectGlyph(S.key); saveNow();
})();

function fillMeta() {
  $('#familyInput').value = S.project.meta.family;
  $('#styleInput').value = S.project.meta.style;
  $('#designerInput').value = S.project.meta.designer;
  $('#projPill').textContent = `${S.project.meta.family} · ${PR.countDrawn(S.project)} glifos`;
}
function applyQuality(id) { const q = S.cfg.quality.find((x) => x.id === id) || S.cfg.quality[0]; S.quality = { tol: q.tol, seg: q.seg }; }

function buildTools() {
  const grid = $('#toolGrid'); grid.innerHTML = '';
  for (const t of S.cfg.tools) grid.append(el('button', { class: 'tool', 'aria-pressed': t.id === S.tool, dataset: { tool: t.id }, onclick: () => setTool(t.id) }, t.label, el('small', {}, t.key)));
  setTool(S.tool);
}
function setTool(id) {
  S.tool = id; S.pen = null; $('#commitPenBtn').hidden = true;
  $$('.tool').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === id));
  $('#toolHint').textContent = S.cfg.tools.find((t) => t.id === id)?.hint || '';
  stage.classList.toggle('panning', id === 'pan');
  stage.classList.toggle('erasing', id === 'erase');
  render();
}

function buildCharset() {
  const host = $('#charset'); host.innerHTML = '';
  for (const cs of S.cfg.charsets) {
    const g = el('div', { class: 'cs-group', title: cs.label });
    for (const ch of cs.chars) {
      if (!S.project.glyphs[ch]) { S.project.glyphs[ch] = PR.emptyGlyph(ch, ch === ' ' ? 280 : 600); S.project.order.push(ch); }
      g.append(el('button', {
        class: `chip ${S.project.glyphs[ch].objects.length ? 'done' : ''} ${ch === ' ' ? 'empty-char' : ''}`,
        role: 'tab', 'aria-current': ch === S.key, dataset: { ch },
        title: `${ch === ' ' ? 'espacio' : ch} · U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`,
        onclick: () => selectGlyph(ch)
      }, ch === ' ' ? '␣' : ch));
    }
    host.append(g);
  }
}
function refreshCharset() {
  $$('#charset .chip').forEach((b) => {
    b.classList.toggle('done', (S.project.glyphs[b.dataset.ch]?.objects.length || 0) > 0);
    b.setAttribute('aria-current', b.dataset.ch === S.key);
  });
}

function buildInspector() {
  const host = $('#inspector'); host.innerHTML = '';
  const g = glyph();
  host.append(
    group('Trazo',
      ctrl({ id: 'brush', label: 'Grosor', type: 'range', min: 4, max: 160, step: 1, unit: ' u' }, ed().brush, (v) => { ed().brush = v; if (S.node?.obj?.type === 'stroke') { S.node.obj.width = v; commit(); } else render(); save(); }),
      ctrl({ id: 'smooth', label: 'Suavizado', type: 'range', min: 0, max: 1, step: .05 }, ed().smooth, (v) => { ed().smooth = v; save(); }),
      ctrl({ id: 'simplify', label: 'Simplificar', type: 'range', min: .4, max: 12, step: .2, unit: ' u' }, ed().simplify, (v) => { ed().simplify = v; save(); })
    ),
    group('Glifo',
      ctrl({ id: 'advance', label: 'Ancho', type: 'range', min: 60, max: 1600, step: 5, unit: ' u' }, g.advance, (v) => { g.advance = v; $('#advOut').textContent = v; render(); save(); scheduleFont(); }),
      ctrl({ id: 'shift', label: 'Desplazar X', type: 'range', min: -300, max: 300, step: 1, unit: ' u' }, 0, (v) => { if (!S.lastShift) pushUndo(); shiftGlyph(v - S.lastShift); S.lastShift = v; }),
      ctrl({ id: 'scale', label: 'Escalar', type: 'range', min: 40, max: 180, step: 1, unit: '%' }, 100, (v) => { if (S.lastScale === 100) pushUndo(); scaleGlyph(v / S.lastScale); S.lastScale = v; })
    ),
    group('Métricas',
      ctrl({ id: 'preset', label: 'Preset', type: 'select', options: S.cfg.metricsPresets.map((p) => ({ id: p.id, label: p.label })) }, 'display', (id) => {
        const p = S.cfg.metricsPresets.find((x) => x.id === id);
        Object.assign(M(), { unitsPerEm: p.unitsPerEm, ascender: p.ascender, descender: p.descender, capHeight: p.capHeight, xHeight: p.xHeight, lineGap: p.lineGap });
        fit(); render(); save(); scheduleFont(); buildInspector();
      }),
      ctrl({ id: 'cap', label: 'Altura mayúsculas', type: 'range', min: 200, max: 1000, step: 10 }, M().capHeight, (v) => { M().capHeight = v; render(); save(); }),
      ctrl({ id: 'xh', label: 'Altura x', type: 'range', min: 120, max: 900, step: 10 }, M().xHeight, (v) => { M().xHeight = v; render(); save(); }),
      ctrl({ id: 'asc', label: 'Ascendente', type: 'range', min: 400, max: 1400, step: 10 }, M().ascender, (v) => { M().ascender = v; fit(); render(); save(); scheduleFont(); }),
      ctrl({ id: 'desc', label: 'Descendente', type: 'range', min: -600, max: 0, step: 10 }, M().descender, (v) => { M().descender = v; fit(); render(); save(); scheduleFont(); })
    ),
    group('Vista',
      ctrl({ id: 'zoom', label: 'Zoom', type: 'range', min: 15, max: 400, step: 1 }, Math.round(S.view.k * 200), (v) => zoomTo(v / 200)),
      ctrl({ id: 'grid', label: 'Cuadrícula', type: 'toggle' }, ed().grid, (v) => { ed().grid = v; render(); save(); }),
      ctrl({ id: 'guides', label: 'Guías', type: 'toggle' }, ed().guides, (v) => { ed().guides = v; render(); save(); }),
      ctrl({ id: 'snap', label: 'Ajustar a rejilla', type: 'toggle' }, ed().snap, (v) => { ed().snap = v; save(); }),
      ctrl({ id: 'fill', label: 'Ver relleno real', type: 'toggle' }, ed().fill, (v) => { ed().fill = v; render(); save(); }),
      ctrl({ id: 'ghost', label: 'Fantasma', type: 'select', options: [{ id: '', label: 'Ninguno' }, ...S.project.order.filter((k) => S.project.glyphs[k].objects.length && k !== S.key).map((k) => ({ id: k, label: k }))] }, ed().ghost, (v) => { ed().ghost = v; render(); save(); }),
      ctrl({ id: 'quality', label: 'Calidad', type: 'select', options: S.cfg.quality }, ed().quality, (v) => { applyQuality(v); ed().quality = v; render(); save(); scheduleFont(); }),
      ctrl({ id: 'tint', label: 'Tinta del glifo', type: 'color' }, ed().tint, (v) => { ed().tint = v; render(); save(); })
    ),
    group('Acciones',
      el('div', { class: 'row' },
        el('button', { class: 'btn sm', onclick: resetView }, 'Reiniciar vista'),
        el('button', { class: 'btn sm', onclick: randomGlyph }, 'Aleatorio'),
        el('button', { class: 'btn sm primary', onclick: openExport }, 'Exportar')
      ),
      el('div', { class: 'metrics-mini', style: 'margin-top:10px' },
        el('div', { class: 'stat' }, el('b', { id: 'statGlyphs' }, String(PR.countDrawn(S.project))), el('span', {}, 'glifos')),
        el('div', { class: 'stat' }, el('b', { id: 'statSize' }, '—'), el('span', {}, 'TTF'))
      )
    )
  );
}

/* ---------- vista ---------- */
function sizeStage() {
  const r = stage.getBoundingClientRect();
  S.w = Math.max(1, r.width); S.h = Math.max(1, r.height);
  stage.setAttribute('viewBox', `0 0 ${S.w} ${S.h}`);
}
function fit() {
  const m = M(), g = glyph();
  const k = Math.min(S.w / (g.advance + 260), S.h / (m.ascender - m.descender + 180));
  S.view.k = k;
  S.view.tx = (S.w - g.advance * k) / 2;
  S.view.ty = (S.h + k * (m.ascender + m.descender)) / 2;
  syncZoom();
}
function resetView() { fit(); render(); }
function zoomTo(k, cx = S.w / 2, cy = S.h / 2) {
  const old = S.view.k; k = clamp(k, .06, 4);
  S.view.tx = cx - ((cx - S.view.tx) / old) * k;
  S.view.ty = cy - ((cy - S.view.ty) / old) * k;
  S.view.k = k; syncZoom(); render();
}
function syncZoom() {
  $('#zoomOut').textContent = `${Math.round(S.view.k * 200)}%`;
  const z = $('#inspector input[id^=c_zoom]');
  if (z) { z.value = Math.round(S.view.k * 200); z.style.setProperty('--p', `${((z.value - 15) / 385) * 100}%`); }
}
const toFont = (evt) => {
  const m = world.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(evt.clientX, evt.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
};
const snap = (v) => (ed().snap ? Math.round(v / 25) * 25 : Math.round(v * 10) / 10);

/* ---------- render ---------- */
function render() {
  const m = M(), g = glyph(), k = S.view.k;
  world.setAttribute('transform', `translate(${S.view.tx},${S.view.ty}) scale(${k},${-k})`);
  for (const l of Object.values(L)) l.textContent = '';
  const x0 = -200, x1 = g.advance + 200, y0 = m.descender - 100, y1 = m.ascender + 100;

  if (ed().grid) {
    const step = k * 50 < 7 ? (k * 100 < 7 ? 200 : 100) : 50;
    let d = '';
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) d += `M${x} ${y0}V${y1}`;
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) d += `M${x0} ${y}H${x1}`;
    L.grid.append(mk('path', { d, stroke: '#1C2331', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke', fill: 'none' }));
  }
  L.grid.append(mk('rect', { x: 0, y: m.descender, width: g.advance, height: m.ascender - m.descender, fill: 'rgba(43,217,232,.035)', stroke: '#2C3648', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));

  const labels = $('#labels'); labels.textContent = '';
  if (ed().guides) {
    for (const [y, name, color] of [[0, 'base', '#F2A03D'], [m.xHeight, 'x', '#2BD9E8'], [m.capHeight, 'cap', '#FF3D8B'], [m.ascender, 'asc', '#5B8CFF'], [m.descender, 'desc', '#5B8CFF']]) {
      L.guide.append(mk('path', { d: `M${x0} ${y}H${x1}`, stroke: color, 'stroke-width': 1, opacity: y === 0 ? .95 : .5, 'vector-effect': 'non-scaling-stroke', 'stroke-dasharray': y === 0 ? '' : '6 5' }));
      const sy = S.view.ty - y * k;
      if (sy > 6 && sy < S.h - 6) labels.append(el('span', { style: `top:${sy}px;left:6px;color:${color}` }, `${name} ${y}`));
    }
    for (const x of [0, g.advance]) L.guide.append(mk('path', { d: `M${x} ${y0}V${y1}`, stroke: '#A8E85C', 'stroke-width': 1, opacity: .55, 'vector-effect': 'non-scaling-stroke' }));
  }

  if (ed().ghost && S.project.glyphs[ed().ghost]) {
    const gc = glyphContours(S.project.glyphs[ed().ghost], S.quality);
    if (gc.length) L.ghost.append(mk('path', { d: P.contoursToD(gc), fill: '#5B8CFF', opacity: .17, 'fill-rule': 'nonzero' }));
  }

  const cs = glyphContours(g, S.quality);
  if (ed().fill && cs.length) L.fill.append(mk('path', { d: P.contoursToD(cs), fill: ed().tint, 'fill-rule': 'nonzero', id: 'fillPath' }));
  for (const o of g.objects) {
    if (o.visible === false) continue;
    if (o.type === 'stroke') L.stroke.append(mk('path', { d: 'M' + o.pts.map((p) => `${p[0]} ${p[1]}`).join('L'), fill: 'none', stroke: '#2BD9E8', 'stroke-width': 1, opacity: .5, 'vector-effect': 'non-scaling-stroke' }));
    else if (!ed().fill) L.stroke.append(mk('path', { d: o.d, fill: 'none', stroke: ed().tint, 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' }));
  }

  const r = 5 / k, hr = 4 / k, nodes = collectNodes();
  for (const n of nodes) if (n.kind !== 'anchor' && n.kind !== 'pt') {
    L.node.append(mk('path', { d: `M${n.ax} ${n.ay}L${n.x} ${n.y}`, stroke: '#FF3D8B', 'stroke-width': 1, opacity: .7, 'vector-effect': 'non-scaling-stroke' }));
    L.node.append(mk('circle', { cx: n.x, cy: n.y, r: hr, fill: '#0B0F16', stroke: '#FF3D8B', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
  }
  for (const n of nodes) if (n.kind === 'anchor' || n.kind === 'pt') {
    const on = S.node && S.node.objId === n.objId && S.node.si === n.si && S.node.kind === n.kind;
    L.node.append(mk('rect', { x: n.x - r, y: n.y - r, width: r * 2, height: r * 2, fill: on ? '#A8E85C' : '#0B0F16', stroke: on ? '#A8E85C' : '#F3EAD9', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
  }
  if (S.pen) {
    L.node.append(mk('path', { d: P.segsToD(S.pen.segs), fill: 'none', stroke: '#A8E85C', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' }));
    const f = S.pen.segs[0];
    if (f) L.node.append(mk('circle', { cx: f.x, cy: f.y, r: r * 1.6, fill: 'none', stroke: '#A8E85C', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
  }
  if (S.free) L.node.append(mk('path', { d: 'M' + S.free.map((p) => `${p[0]} ${p[1]}`).join('L'), fill: 'none', stroke: '#A8E85C', 'stroke-width': ed().brush, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: .6 }));
  if (S.shape) L.node.append(mk('path', { d: P.segsToD(S.shape.segs), fill: 'rgba(168,232,92,.2)', stroke: '#A8E85C', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));

  $('#cCount').textContent = cs.length;
  $('#pCount').textContent = cs.reduce((s, c) => s + c.length, 0);
  $('#advOut').textContent = g.advance;
}

function collectNodes() {
  const out = [];
  for (const o of glyph().objects) {
    if (o.visible === false) continue;
    if (o.type === 'stroke') { o.pts.forEach((p, i) => out.push({ objId: o.id, obj: o, kind: 'pt', si: i, x: p[0], y: p[1] })); continue; }
    let prev = { x: 0, y: 0 };
    P.parsePath(o.d).forEach((s, i) => {
      if (s.cmd === 'Z') return;
      if (s.cmd === 'C') {
        out.push({ objId: o.id, obj: o, kind: 'c1', si: i, x: s.x1, y: s.y1, ax: prev.x, ay: prev.y });
        out.push({ objId: o.id, obj: o, kind: 'c2', si: i, x: s.x2, y: s.y2, ax: s.x, ay: s.y });
      } else if (s.cmd === 'Q') out.push({ objId: o.id, obj: o, kind: 'c1', si: i, x: s.x1, y: s.y1, ax: s.x, ay: s.y });
      out.push({ objId: o.id, obj: o, kind: 'anchor', si: i, x: s.x, y: s.y });
      prev = { x: s.x, y: s.y };
    });
  }
  return out;
}

/* ---------- interacción ---------- */
function bindStage() {
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (S.pointers.size === 2) {
      const [a, b] = [...S.pointers.values()];
      S.pinching = { d: Math.hypot(a.x - b.x, a.y - b.y), k: S.view.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx: S.view.tx, ty: S.view.ty };
      S.drag = null; S.free = null; return;
    }
    const p = toFont(e);
    if (S.tool === 'pan' || e.button === 1 || e.button === 2 || e.shiftKey) { S.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, tx: S.view.tx, ty: S.view.ty }; return; }
    if (S.tool === 'pen') return penDown(p);
    if (S.tool === 'free') { pushUndo(); S.free = [[snap(p.x), snap(p.y)]]; return; }
    if (S.tool === 'rect' || S.tool === 'ellipse') { S.shape = { x: snap(p.x), y: snap(p.y), segs: [] }; return; }
    if (S.tool === 'erase') return eraseAt(p, e);
    if (S.tool === 'node') {
      const hit = nearestNode(p, 12 / S.view.k);
      if (hit) { pushUndo(); S.node = hit; S.drag = { type: 'node', hit }; render(); return; }
      const obj = objectAt(e);
      if (obj) { pushUndo(); S.sel = obj.id; S.drag = { type: 'move', obj, start: p, orig: JSON.stringify(obj) }; renderObjects(); return; }
      S.sel = null; renderObjects(); render();
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (S.pointers.has(e.pointerId)) S.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (S.pinching && S.pointers.size === 2) {
      const [a, b] = [...S.pointers.values()], rect = stage.getBoundingClientRect();
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const k = clamp(S.pinching.k * (d / S.pinching.d), .06, 4);
      const cx = S.pinching.cx - rect.left, cy = S.pinching.cy - rect.top;
      S.view.tx = cx - ((cx - S.pinching.tx) / S.pinching.k) * k + ((a.x + b.x) / 2 - S.pinching.cx);
      S.view.ty = cy - ((cy - S.pinching.ty) / S.pinching.k) * k + ((a.y + b.y) / 2 - S.pinching.cy);
      S.view.k = k; syncZoom(); render(); return;
    }
    const p = toFont(e);
    if (S.drag?.type === 'pan') { S.view.tx = S.drag.tx + (e.clientX - S.drag.sx); S.view.ty = S.drag.ty + (e.clientY - S.drag.sy); render(); return; }
    if (S.drag?.type === 'node') {
      const h = S.drag.hit, o = h.obj, nx = snap(p.x), ny = snap(p.y);
      if (o.type === 'stroke') o.pts[h.si] = [nx, ny];
      else {
        const segs = P.parsePath(o.d), s = segs[h.si];
        if (h.kind === 'anchor') {
          const dx = nx - s.x, dy = ny - s.y;
          s.x = nx; s.y = ny;
          if (s.cmd === 'C') { s.x2 += dx; s.y2 += dy; }
          if (s.cmd === 'Q') { s.x1 += dx * .5; s.y1 += dy * .5; }
          const n2 = segs[h.si + 1];
          if (n2 && n2.cmd === 'C') { n2.x1 += dx; n2.y1 += dy; }
          if (n2 && n2.cmd === 'Q') { n2.x1 += dx * .5; n2.y1 += dy * .5; }
        } else if (h.kind === 'c1') { s.x1 = nx; s.y1 = ny; } else { s.x2 = nx; s.y2 = ny; }
        o.d = P.segsToD(segs);
      }
      commit(); return;
    }
    if (S.drag?.type === 'move') {
      const o = S.drag.obj, orig = JSON.parse(S.drag.orig);
      const dx = snap(p.x - S.drag.start.x), dy = snap(p.y - S.drag.start.y);
      if (o.type === 'stroke') o.pts = orig.pts.map(([x, y]) => [x + dx, y + dy]);
      else o.d = P.segsToD(P.applyMatrix(P.parsePath(orig.d), { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy }));
      commit(); return;
    }
    if (S.pen?.dragging) {
      const a = S.pen.anchor, dx = p.x - a.x, dy = p.y - a.y, last = S.pen.segs[S.pen.segs.length - 1];
      if (last && last.cmd === 'C') { last.x2 = a.x - dx; last.y2 = a.y - dy; }
      S.pen.out = { x: a.x + dx, y: a.y + dy }; render(); return;
    }
    if (S.free) {
      const last = S.free[S.free.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) * S.view.k > 2.2) { S.free.push([snap(p.x), snap(p.y)]); render(); }
      return;
    }
    if (S.shape) {
      const x = Math.min(S.shape.x, snap(p.x)), y = Math.min(S.shape.y, snap(p.y));
      const w = Math.abs(snap(p.x) - S.shape.x), h = Math.abs(snap(p.y) - S.shape.y);
      S.shape.segs = S.tool === 'rect' ? P.rectSegs(x, y, w, h) : P.ellipseSegs(x + w / 2, y + h / 2, w / 2, h / 2);
      render();
    }
  });

  const up = (e) => {
    S.pointers.delete(e.pointerId);
    if (S.pointers.size < 2) S.pinching = null;
    if (S.pen?.dragging) { S.pen.dragging = false; return; }
    if (S.free) {
      const pts = P.rdp(P.smoothPts(S.free, ed().smooth), ed().simplify);
      if (pts.length > 1) { glyph().objects.push({ id: uid(), type: 'stroke', pts, width: ed().brush, closed: false, visible: true }); sound.play('commit'); }
      S.free = null; commit(); return;
    }
    if (S.shape) {
      if (S.shape.segs.length) { pushUndo(); glyph().objects.push({ id: uid(), type: 'path', d: P.segsToD(S.shape.segs), mode: 'nest', visible: true }); sound.play('commit'); }
      S.shape = null; commit(); return;
    }
    if (S.drag) { S.drag = null; commit(); }
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('contextmenu', (e) => e.preventDefault());
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomTo(S.view.k * (e.deltaY < 0 ? 1.12 : .89), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  stage.addEventListener('dblclick', () => { if (S.pen) commitPen(); });

  const wrap = stage.parentElement;
  ['dragenter', 'dragover'].forEach((t) => wrap.addEventListener(t, (e) => { e.preventDefault(); $('#dropHint').classList.add('on'); }));
  ['dragleave', 'drop'].forEach((t) => wrap.addEventListener(t, (e) => { e.preventDefault(); $('#dropHint').classList.remove('on'); }));
  wrap.addEventListener('drop', (e) => { const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); });
}

function penDown(p) {
  const x = snap(p.x), y = snap(p.y);
  if (!S.pen) { pushUndo(); S.pen = { segs: [{ cmd: 'M', x, y }], out: null, anchor: { x, y }, dragging: true }; $('#commitPenBtn').hidden = false; render(); return; }
  const first = S.pen.segs[0];
  if (S.pen.segs.length > 2 && Math.hypot(x - first.x, y - first.y) * S.view.k < 13) {
    const o = S.pen.out || { x, y };
    S.pen.segs.push({ cmd: 'C', x1: o.x, y1: o.y, x2: first.x, y2: first.y, x: first.x, y: first.y }, { cmd: 'Z' });
    commitPen(); return;
  }
  const prev = S.pen.segs[S.pen.segs.length - 1], o = S.pen.out || { x: prev.x, y: prev.y };
  S.pen.segs.push({ cmd: 'C', x1: o.x, y1: o.y, x2: x, y2: y, x, y });
  S.pen.anchor = { x, y }; S.pen.out = null; S.pen.dragging = true; render();
}
function commitPen() {
  if (!S.pen) return;
  if (S.pen.segs.length > 1) { glyph().objects.push({ id: uid(), type: 'path', d: P.segsToD(S.pen.segs), mode: 'nest', visible: true }); sound.play('commit'); }
  S.pen = null; $('#commitPenBtn').hidden = true; commit();
}
function nearestNode(p, tol) {
  let best = null, bd = tol;
  for (const n of collectNodes()) { const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = n; } }
  return best;
}
function objectAt(e) {
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  if (!hit || hit.id !== 'fillPath') return null;
  const p = toFont(e), objs = glyph().objects.filter((o) => o.visible !== false);
  for (let i = objs.length - 1; i >= 0; i--) {
    const bb = P.contoursBBox(glyphContours({ objects: [objs[i]] }, S.quality));
    if (p.x >= bb.x0 - 6 && p.x <= bb.x1 + 6 && p.y >= bb.y0 - 6 && p.y <= bb.y1 + 6) return objs[i];
  }
  return objs[objs.length - 1] || null;
}
function eraseAt(p, e) {
  const o = objectAt(e) || nearestNode(p, 20 / S.view.k)?.obj;
  if (!o) return toast('No hay ninguna forma bajo el cursor.', 'info');
  pushUndo();
  const removed = JSON.parse(JSON.stringify(o));
  glyph().objects = glyph().objects.filter((x) => x.id !== o.id);
  commit();
  toast('Forma eliminada.', 'ok', 6000, { label: 'Deshacer', run: () => { glyph().objects.push(removed); commit(); } });
}

/* ---------- estado ---------- */
function pushUndo() { S.undo.push(JSON.stringify(glyph().objects)); if (S.undo.length > 80) S.undo.shift(); S.redo.length = 0; }
function undo() {
  if (!S.undo.length) return toast('Nada que deshacer.', 'info');
  S.redo.push(JSON.stringify(glyph().objects));
  glyph().objects = JSON.parse(S.undo.pop()); commit();
}
function redo() {
  if (!S.redo.length) return toast('Nada que rehacer.', 'info');
  S.undo.push(JSON.stringify(glyph().objects));
  glyph().objects = JSON.parse(S.redo.pop()); commit();
}
function commit() {
  glyph().modified = Date.now();
  render(); renderObjects(); refreshCharset(); save(); scheduleFont();
  const sg = $('#statGlyphs'); if (sg) sg.textContent = PR.countDrawn(S.project);
  $('#projPill').textContent = `${S.project.meta.family} · ${PR.countDrawn(S.project)} glifos`;
}
const save = debounce(() => saveNow(), 550);
async function saveNow() {
  $('#saveState').textContent = 'guardando…';
  const ok = await PR.store.put(S.project);
  $('#saveState').textContent = ok ? 'guardado' : 'sin almacén';
}
function selectGlyph(ch) {
  if (S.pen) commitPen();
  S.key = ch; S.undo.length = 0; S.redo.length = 0; S.node = null; S.sel = null; S.lastShift = 0; S.lastScale = 100;
  if (!S.project.glyphs[ch]) { S.project.glyphs[ch] = PR.emptyGlyph(ch); S.project.order.push(ch); }
  $('#glyphChar').textContent = ch === ' ' ? '␣' : ch;
  $('#glyphCode').textContent = `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  $('#glyphName').textContent = glyph().name;
  buildInspector(); refreshCharset(); fit(); render(); renderObjects(); scheduleFont();
}
function renderObjects() {
  const host = $('#objList'); host.innerHTML = '';
  const objs = glyph().objects;
  if (!objs.length) { host.append(el('p', { class: 'tiny muted' }, 'Sin formas. Dibuja con la pluma o el trazo.')); return; }
  objs.forEach((o, i) => {
    const row = el('div', { class: `obj ${S.sel === o.id ? 'sel' : ''}`, draggable: true, dataset: { id: o.id }, onclick: () => { S.sel = o.id; S.node = null; renderObjects(); render(); } },
      el('span', { class: 'grip' }, '⠿'),
      el('span', { class: 'name' }, `${i + 1}. ${o.type === 'stroke' ? `trazo ${Math.round(o.width)}u` : `path ${o.mode}`}`),
      el('button', { class: o.visible === false ? 'off' : '', title: 'Visibilidad', onclick: (e) => { e.stopPropagation(); pushUndo(); o.visible = o.visible === false; commit(); } }, o.visible === false ? '◌' : '◉'),
      el('button', { title: 'Eliminar', onclick: (e) => { e.stopPropagation(); pushUndo(); glyph().objects = objs.filter((x) => x.id !== o.id); commit(); } }, '×'));
    row.addEventListener('dragstart', () => { S.dragObjId = o.id; row.classList.add('drag'); });
    row.addEventListener('dragend', () => row.classList.remove('drag'));
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = objs.findIndex((x) => x.id === S.dragObjId), to = objs.findIndex((x) => x.id === o.id);
      if (from < 0 || from === to) return;
      pushUndo(); objs.splice(to, 0, objs.splice(from, 1)[0]); commit();
    });
    host.append(row);
  });
}
function shiftGlyph(dx) {
  if (!dx) return;
  for (const o of glyph().objects) {
    if (o.type === 'stroke') o.pts = o.pts.map(([x, y]) => [x + dx, y]);
    else o.d = P.segsToD(P.applyMatrix(P.parsePath(o.d), { a: 1, b: 0, c: 0, d: 1, e: dx, f: 0 }));
  }
  commit();
}
function scaleGlyph(f) {
  if (!f || Math.abs(f - 1) < 1e-6) return;
  const cx = glyph().advance / 2;
  for (const o of glyph().objects) {
    if (o.type === 'stroke') { o.pts = o.pts.map(([x, y]) => [(x - cx) * f + cx, y * f]); o.width *= f; }
    else o.d = P.segsToD(P.applyMatrix(P.parsePath(o.d), { a: f, b: 0, c: 0, d: f, e: cx - cx * f, f: 0 }));
  }
  commit();
}
function randomGlyph() {
  pushUndo();
  const g = glyph(), m = M(), kind = Math.floor(Math.random() * 3), objs = [];
  if (kind === 0) {
    for (let i = 0, n = 2 + Math.floor(Math.random() * 3); i < n; i++) objs.push({ id: uid(), type: 'path', d: P.segsToD(P.rectSegs(60 + Math.random() * 300, Math.random() * m.capHeight * .7, 60 + Math.random() * 120, 80 + Math.random() * 300)), mode: 'nest', visible: true });
  } else if (kind === 1) {
    const pts = Array.from({ length: 5 + Math.floor(Math.random() * 4) }, (_, i) => [80 + i * (g.advance - 160) / 6, 60 + Math.random() * m.capHeight * .85]);
    objs.push({ id: uid(), type: 'stroke', pts, width: 40 + Math.random() * 70, closed: false, visible: true });
  } else {
    const cx = g.advance / 2, cy = m.capHeight / 2, r = Math.min(g.advance, m.capHeight) * .42;
    objs.push({ id: uid(), type: 'path', d: P.segsToD(P.ellipseSegs(cx, cy, r, r)), mode: 'nest', visible: true });
    objs.push({ id: uid(), type: 'path', d: P.segsToD(P.ellipseSegs(cx, cy, r * .55, r * .55)), mode: 'hole', visible: true });
  }
  g.objects = objs; commit(); toast('Glifo generado. Edítalo o vuelve a tirar.', 'ok');
}

const scheduleFont = debounce(async () => {
  const state = $('#liveState');
  try {
    if (!PR.countDrawn(S.project)) { state.textContent = 'dibuja un glifo'; $('#liveOut').style.fontFamily = ''; return; }
    state.textContent = 'generando…';
    const { bytes: b, stats } = buildFont(S.project, { quality: S.quality });
    const fam = await previewFace('editor', b);
    $('#liveOut').style.fontFamily = `"${fam}", system-ui`;
    $('#liveOut').textContent = $('#liveText').value || S.project.meta.family;
    state.textContent = `${stats.glyphs} glifos · ${bytes(b.length)}`;
    const sz = $('#statSize'); if (sz) sz.textContent = bytes(b.length);
  } catch { state.textContent = 'error'; $('#liveOut').style.fontFamily = ''; }
}, 700);

/* ---------- acciones ---------- */
function bindActions() {
  $('#liveText').addEventListener('input', (e) => { $('#liveOut').textContent = e.target.value || ' '; });
  $('#undoBtn').onclick = undo; $('#redoBtn').onclick = redo; $('#fitBtn').onclick = resetView;
  $('#commitPenBtn').onclick = commitPen; $('#exportBtn').onclick = openExport;
  $('#openLibBtn').onclick = () => location.href = 'biblioteca.html';
  $('#familyInput').oninput = (e) => { S.project.meta.family = e.target.value || 'Punzón Sans'; fillMeta(); save(); scheduleFont(); };
  $('#styleInput').onchange = (e) => { S.project.meta.style = e.target.value; save(); scheduleFont(); };
  $('#designerInput').oninput = (e) => { S.project.meta.designer = e.target.value; save(); };
  $('#newProjectBtn').onclick = async () => {
    if (!await confirmDialog('Proyecto nuevo', 'Se creará un proyecto vacío y se abrirá en el editor. El actual queda guardado en la biblioteca.', 'Crear')) return;
    const p = PR.newProject(`Fuente ${new Date().toLocaleDateString('es')}`, S.project.meta.designer);
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ') { p.glyphs[ch] = PR.emptyGlyph(ch, ch === ' ' ? 280 : 600); p.order.push(ch); }
    await PR.store.put(p); await PR.setCurrent(p.id); location.reload();
  };
  $('#unionBtn').onclick = () => { pushUndo(); glyph().objects.forEach((o) => { if (o.type === 'path') o.mode = 'union'; }); commit(); toast('Modo unión: las formas se suman sin huecos.', 'ok'); };
  $('#holeBtn').onclick = () => {
    const o = glyph().objects.find((x) => x.id === S.sel);
    if (!o) return toast('Selecciona una forma en la lista.', 'info');
    pushUndo();
    if (o.type === 'path') o.mode = o.mode === 'hole' ? 'nest' : 'hole';
    commit(); toast(o.mode === 'hole' ? 'Ahora resta: úsalo para el interior de O, P, A…' : 'Vuelve a sumar.', 'ok');
  };
  $('#clearGlyphBtn').onclick = async () => {
    if (!glyph().objects.length) return;
    if (!await confirmDialog('Vaciar glifo', `Se borran las ${glyph().objects.length} formas de «${S.key}». Puedes deshacer con Ctrl+Z.`, 'Vaciar')) return;
    pushUndo(); glyph().objects = []; commit();
  };
  $('#importSvgBtn').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => { const f = e.target.files[0]; if (f) handleFile(f); e.target.value = ''; };
  $('#pasteSvgBtn').onclick = () => drawer('Pegar SVG', (body, close) => {
    const ta = el('textarea', { placeholder: '<svg viewBox="0 0 100 100"><path d="M10 90 L50 10 L90 90 Z"/></svg>', style: 'min-height:220px' });
    body.append(el('p', { class: 'tiny muted' }, 'Se convierten rect, circle, ellipse, line, polygon, path, transform y use. El texto debe estar convertido a trazados.'), ta);
    body.append(el('button', { class: 'btn primary block', onclick: () => { try { doImport(ta.value); close(); } catch (err) { toast(err.message, 'error'); } } }, 'Importar al glifo'));
  });
  $('#traceBtn').onclick = async () => { await saveNow(); location.href = `trazo.html?project=${S.project.id}&glyph=${encodeURIComponent(S.key)}`; };
}

async function handleFile(file) {
  if (/svg/.test(file.type) || /\.svg$/i.test(file.name)) {
    try { doImport(await fileToText(file)); } catch (err) { toast(err.message, 'error'); }
  } else if (/^image\//.test(file.type)) {
    const buf = await file.arrayBuffer();
    await PR.store.kvSet('handoff', { name: file.name, type: file.type, buf, project: S.project.id, glyph: S.key });
    await saveNow();
    location.href = `trazo.html?project=${S.project.id}&glyph=${encodeURIComponent(S.key)}&handoff=1`;
  } else toast('Formato no soportado. Usa SVG, PNG, JPG o WebP.', 'warn');
}
function doImport(text) {
  const res = importSVG(text, { height: M().capHeight, advance: glyph().advance });
  pushUndo();
  glyph().objects.push(...res.objects);
  glyph().advance = res.advance;
  commit(); buildInspector();
  res.warnings.forEach((w) => toast(w, 'warn', 6000));
  toast(`${res.objects.length} forma(s) importadas y escaladas a ${M().capHeight} unidades.`, 'ok');
}

function openExport() {
  drawer('Exportar fuente', (body) => {
    const issues = PR.validate(S.project);
    let result = null;
    try { result = buildFont(S.project, { quality: S.quality }); }
    catch (e) { body.append(el('div', { class: 'issue error' }, el('b', {}, 'error'), el('span', {}, e.message))); return; }
    const s = result.stats;
    body.append(el('div', { class: 'metrics-mini' },
      el('div', { class: 'stat' }, el('b', {}, String(s.glyphs)), el('span', {}, 'glifos')),
      el('div', { class: 'stat' }, el('b', {}, bytes(s.size)), el('span', {}, 'ttf')),
      el('div', { class: 'stat' }, el('b', {}, String(s.tables)), el('span', {}, 'tablas')),
      el('div', { class: 'stat' }, el('b', {}, String(s.pairs)), el('span', {}, 'kern'))
    ));
    const list = el('div', { class: 'export-list' });
    const all = [...issues, ...result.warnings.map((m) => ({ level: 'warn', msg: m }))];
    all.forEach((i) => list.append(el('div', { class: `issue ${i.level}` }, el('b', {}, i.level), el('span', {}, i.msg))));
    if (!all.length) list.append(el('div', { class: 'issue' }, el('b', {}, 'ok'), el('span', {}, 'Sin avisos. La fuente está lista para instalarse.')));
    body.append(el('h3', { class: 'ctrl-title' }, 'Validación'), list);
    const base = slug(S.project.meta.family);
    body.append(el('h3', { class: 'ctrl-title' }, 'Descargas'), el('div', { class: 'col' },
      el('button', { class: 'btn primary block', onclick: () => { download(result.bytes, `${base}.ttf`, 'font/ttf'); toast('TTF descargado. Instálalo o súbelo a tu repositorio.', 'ok'); } }, `TTF · ${bytes(s.size)}`),
      el('button', { class: 'btn steel block', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Comprimiendo…';
        try { const w = await buildWoff(result.bytes); download(w, `${base}.woff`, 'font/woff'); toast(`WOFF generado · ${bytes(w.length)}`, 'ok'); }
        catch { toast('No se pudo comprimir WOFF en este navegador.', 'error'); }
        b.disabled = false; b.textContent = 'WOFF (web)';
      } }, 'WOFF (web)'),
      el('button', { class: 'btn block', onclick: () => download(sheetSVG(S.project, (g) => glyphContours(g, S.quality)), `${base}-lamina.svg`, 'image/svg+xml') }, 'Lámina SVG de glifos'),
      el('button', { class: 'btn block', onclick: () => download(glyphSVG(glyph(), M(), ed().tint, glyphContours(glyph(), S.quality)), `${base}-${glyph().name}.svg`, 'image/svg+xml') }, `SVG del glifo «${S.key}»`),
      el('button', { class: 'btn block', onclick: () => download(JSON.stringify(S.project, null, 2), `${base}.punzon.json`, 'application/json') }, 'Proyecto JSON (editable)'),
      el('button', { class: 'btn ghost block', onclick: () => {
        const css = fontCSS(S.project.meta.family, base);
        drawer('CSS @font-face', (b2) => b2.append(el('textarea', { readonly: true, style: 'min-height:200px' }, css),
          el('button', { class: 'btn block', onclick: () => navigator.clipboard.writeText(css).then(() => toast('CSS copiado.', 'ok')).catch(() => toast('Selecciona y copia manualmente.', 'warn')) }, 'Copiar')));
      } }, 'CSS @font-face')
    ));
    body.append(el('p', { class: 'tiny muted' }, 'WOFF2 requiere Brotli y transformación de glyf: está en la hoja de ruta, no se simula aquí.'));
  });
}

function bindKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input,textarea,select')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); return redo(); }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveNow(); return toast('Proyecto guardado.', 'ok'); }
    if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); return openExport(); }
    const tool = S.cfg.tools.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (tool && !mod) { e.preventDefault(); return setTool(tool.id); }
    if (e.key === 'Enter') { e.preventDefault(); return commitPen(); }
    if (e.key === 'Escape') { S.pen = null; S.free = null; S.shape = null; $('#commitPenBtn').hidden = true; render(); return; }
    if (e.key === 'g' || e.key === 'G') { ed().grid = !ed().grid; buildInspector(); render(); return; }
    if (e.key === '0') return resetView();
    if (e.key === '+' || e.key === '=') return zoomTo(S.view.k * 1.15);
    if (e.key === '-' || e.key === '_') return zoomTo(S.view.k / 1.15);
    if (e.key === '[') { ed().brush = clamp(ed().brush - 4, 4, 160); buildInspector(); return; }
    if (e.key === ']') { ed().brush = clamp(ed().brush + 4, 4, 160); buildInspector(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (S.node) {
        pushUndo();
        const o = S.node.obj;
        if (o.type === 'stroke') { o.pts.splice(S.node.si, 1); if (o.pts.length < 2) glyph().objects = glyph().objects.filter((x) => x.id !== o.id); }
        else {
          const segs = P.parsePath(o.d);
          segs.splice(S.node.si, 1);
          if (segs[0] && segs[0].cmd !== 'M') segs[0] = { cmd: 'M', x: segs[0].x ?? 0, y: segs[0].y ?? 0 };
          if (segs.length < 2) glyph().objects = glyph().objects.filter((x) => x.id !== o.id);
          else o.d = P.segsToD(segs);
        }
        S.node = null; commit(); return;
      }
      if (S.sel) { pushUndo(); glyph().objects = glyph().objects.filter((x) => x.id !== S.sel); S.sel = null; commit(); }
      return;
    }
    if (e.key.startsWith('Arrow') && S.node) {
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
      const dy = e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0;
      const o = S.node.obj;
      if (o.type === 'stroke') { const p = o.pts[S.node.si]; o.pts[S.node.si] = [p[0] + dx, p[1] + dy]; }
      else {
        const segs = P.parsePath(o.d), s = segs[S.node.si];
        if (S.node.kind === 'anchor') { s.x += dx; s.y += dy; if (s.cmd === 'C') { s.x2 += dx; s.y2 += dy; } }
        else if (S.node.kind === 'c1') { s.x1 += dx; s.y1 += dy; } else { s.x2 += dx; s.y2 += dy; }
        o.d = P.segsToD(segs);
      }
      commit();
    }
  });
  }
