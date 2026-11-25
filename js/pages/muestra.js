import { $, el, initShell, ctrl, group, toast, download, slug, bytes } from '../ui.js';
import * as PR from '../core/project.js';
import { buildFont, previewFace, glyphContours } from '../core/font.js';
import { specimenSVG, svgToPng } from '../core/vector.js';

const S = {
  cfg: null, project: null, all: [], fam: '', bytes: null,
  opts: { size: 88, tracking: 0, leading: 1.15, color: '#F3EAD9', bg: '#0B0F16', align: 'left', invert: false, quality: 'alta' }
};

(async function boot() {
  S.cfg = await initShell('muestra');
  S.all = await PR.ensureSeeds();
  S.project = await PR.currentProject();
  const sel = $('#projSel');
  S.all.forEach((p) => sel.append(el('option', { value: p.id, selected: p.id === S.project.id }, `${p.meta.family} · ${p.meta.style}`)));
  sel.onchange = async (e) => {
    const found = await PR.store.get(e.target.value);
    S.project = PR.normalize(found || S.project);
    await PR.setCurrent(S.project.id);
    S.bytes = null;
    buildControls();
    await rebuild();
  };
  buildControls();
  bind();
  await rebuild();
})();

function buildControls() {
  const host = $('#controls'); host.innerHTML = '';
  host.append(
    group('Composición',
      ctrl({ id: 'size', label: 'Tamaño', type: 'range', min: 18, max: 200, step: 1, unit: ' px' }, S.opts.size, (v) => set('size', v)),
      ctrl({ id: 'tracking', label: 'Tracking', type: 'range', min: -60, max: 120, step: 1, unit: ' /1000em' }, S.opts.tracking, (v) => set('tracking', v)),
      ctrl({ id: 'leading', label: 'Interlineado', type: 'range', min: .8, max: 2.2, step: .05 }, S.opts.leading, (v) => set('leading', v)),
      ctrl({
        id: 'align', label: 'Alineación', type: 'select',
        options: [{ id: 'left', label: 'Izquierda' }, { id: 'center', label: 'Centro' }, { id: 'right', label: 'Derecha' }]
      }, S.opts.align, (v) => set('align', v))
    ),
    group('Color',
      ctrl({ id: 'color', label: 'Tinta', type: 'color' }, S.opts.color, (v) => set('color', v)),
      ctrl({ id: 'bg', label: 'Papel', type: 'color' }, S.opts.bg, (v) => set('bg', v)),
      ctrl({ id: 'invert', label: 'Invertir', type: 'toggle' }, S.opts.invert, (v) => {
        S.opts.invert = v;
        const c = S.opts.color; S.opts.color = S.opts.bg; S.opts.bg = c;
        buildControls(); paint();
      })
    ),
    group('Calidad y acciones',
      ctrl({ id: 'quality', label: 'Calidad del TTF', type: 'select', options: S.cfg.quality }, S.opts.quality, (v) => { S.opts.quality = v; rebuild(); }),
      el('div', { class: 'row' },
        el('button', {
          class: 'btn sm', onclick: () => {
            Object.assign(S.opts, { size: 88, tracking: 0, leading: 1.15, color: '#F3EAD9', bg: '#0B0F16', align: 'left', invert: false });
            buildControls(); paint();
          }
        }, 'Reiniciar'),
        el('button', {
          class: 'btn sm', onclick: () => {
            Object.assign(S.opts, {
              size: 40 + Math.round(Math.random() * 130),
              tracking: Math.round(Math.random() * 60 - 20),
              color: ['#F2A03D', '#2BD9E8', '#FF3D8B', '#A8E85C', '#F3EAD9'][Math.floor(Math.random() * 5)]
            });
            buildControls(); paint();
          }
        }, 'Aleatorio'),
        el('button', {
          class: 'btn sm primary', onclick: () => {
            if (!S.bytes) return toast('Este proyecto todavía no genera un TTF: dibuja algún glifo primero.', 'warn');
            download(S.bytes, `${slug(S.project.meta.family)}.ttf`, 'font/ttf');
          }
        }, 'TTF')
      ),
      el('p', { class: 'tiny muted', style: 'margin-top:8px' }, 'La calidad cambia la tolerancia al convertir cúbicas en cuadráticas: más calidad, más puntos y archivo mayor.')
    )
  );
}
const set = (k, v) => { S.opts[k] = v; paint(); };

function bind() {
  $('#bigLine').addEventListener('input', paint);
  $('#pangramBtn').onclick = () => { $('#bigLine').textContent = S.cfg.pangrams[0]; paint(); };
  $('#abcBtn').onclick = () => { $('#bigLine').textContent = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'; paint(); };
  $('#numsBtn').onclick = () => { $('#bigLine').textContent = '0123456789 · ¡¿?!'; paint(); };
  $('#pngBtn').onclick = async (e) => {
    if (!PR.countDrawn(S.project)) return toast('No hay glifos que rasterizar en este proyecto.', 'warn');
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Rasterizando…';
    try {
      const svg = specimenSVG(S.project, (g) => glyphContours(g, q()), $('#bigLine').textContent || 'Punzón', S.opts.size * 1.4, S.opts.color, S.opts.bg);
      const blob = await svgToPng(svg, 2);
      download(blob, `${slug(S.project.meta.family)}-muestra.png`, 'image/png');
      toast('PNG rasterizado por el navegador a doble resolución.', 'ok');
    } catch (err) {
      toast(err.message || 'No se pudo rasterizar en este navegador.', 'error');
    } finally {
      btn.disabled = false; btn.textContent = 'PNG de la muestra';
    }
  };
  $('#svgBtn').onclick = () => {
    if (!PR.countDrawn(S.project)) return toast('No hay glifos que exportar en este proyecto.', 'warn');
    const svg = specimenSVG(S.project, (g) => glyphContours(g, q()), $('#bigLine').textContent || 'Punzón', S.opts.size * 1.4, S.opts.color, S.opts.bg);
    download(svg, `${slug(S.project.meta.family)}-muestra.svg`, 'image/svg+xml');
  };
}

const q = () => {
  const x = S.cfg.quality.find((y) => y.id === S.opts.quality) || S.cfg.quality[0];
  return { tol: x.tol, seg: x.seg };
};

async function rebuild() {
  const state = $('#fontState');
  try {
    if (!PR.countDrawn(S.project)) {
      state.textContent = 'este proyecto no tiene glifos';
      S.fam = ''; S.bytes = null;
      paint(); paintMap();
      return;
    }
    const { bytes: b, stats } = buildFont(S.project, { quality: q() });
    S.bytes = b;
    S.fam = await previewFace('specimen', b);
    state.textContent = `${stats.glyphs} glifos · ${bytes(b.length)}`;
    $('#projPill').textContent = S.project.meta.family;
  } catch (e) {
    state.textContent = e.message;
    S.fam = ''; S.bytes = null;
  }
  paint(); paintMap();
}

function paint() {
  const o = S.opts;
  const face = S.fam ? `"${S.fam}",` : '';
  $('#specimen').style.background = o.bg;
  const big = $('#bigLine');
  big.style.cssText = `font-family:${face}system-ui;font-size:${o.size}px;letter-spacing:${o.tracking / 1000}em;line-height:${o.leading};color:${o.color};text-align:${o.align}`;
  const text = big.textContent || 'Punzón';

  const wf = $('#waterfall'); wf.innerHTML = '';
  for (const s of [96, 64, 44, 32, 24, 18, 14]) {
    wf.append(el('div', { class: 'wf-row' },
      el('span', { class: 'wf-size' }, `${s}px`),
      el('span', { class: 'wf-text', style: `font-family:${face}system-ui;font-size:${s}px;letter-spacing:${o.tracking / 1000}em;color:${o.color}` }, text)
    ));
  }

  const para = $('#para');
  para.style.cssText = `font-family:${face}system-ui;font-size:19px;letter-spacing:${o.tracking / 1000}em;line-height:${o.leading};color:${o.color};background:${o.bg};padding:16px;border-radius:12px;text-align:${o.align}`;
  para.textContent = S.cfg.pangrams.slice(0, 3).join(' ');
}

function paintMap() {
  const host = $('#map'); host.innerHTML = '';
  const keys = S.project.order.filter((k) => S.project.glyphs[k].objects.length);
  if (!keys.length) {
    host.append(el('p', { class: 'tiny muted' }, 'Todavía no hay glifos dibujados en este proyecto.'));
    return;
  }
  const face = S.fam ? `"${S.fam}",` : '';
  for (const k of keys) {
    host.append(el('div', { class: 'glyph-cell', style: `background:${S.opts.bg}` },
      el('b', { style: `font-family:${face}system-ui;color:${S.opts.color}` }, k),
      el('span', {}, `U+${k.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)));
  }
}
