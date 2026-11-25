import { $, el, initShell, config, toast, drawer, confirmDialog, download, debounce, slug, fileToText } from '../ui.js';
import * as PR from '../core/project.js';
import { buildFont, previewFace } from '../core/font.js';

const S = { all: [], sel: new Set(), q: '', filter: '', sort: 'modified', order: [], views: [], dragId: null };

(async function boot() {
  await initShell('biblioteca');
  S.all = await PR.ensureSeeds();
  S.order = (await PR.store.kvGet('order')) || S.all.map((p) => p.id);
  S.views = (await PR.store.kvGet('views')) || [];
  paintViews(); bind(); await render();
})();

function bind() {
  $('#q').oninput = debounce((e) => { S.q = e.target.value.toLowerCase(); render(); }, 180);
  $('#filter').onchange = (e) => { S.filter = e.target.value; render(); };
  $('#sort').onchange = (e) => { S.sort = e.target.value; render(); };
  $('#view').onchange = (e) => {
    const v = S.views.find((x) => x.name === e.target.value);
    if (!v) return;
    S.q = v.q; S.filter = v.filter; S.sort = v.sort;
    $('#q').value = v.q; $('#filter').value = v.filter; $('#sort').value = v.sort;
    render(); toast(`Vista «${v.name}» aplicada.`, 'ok');
  };
  $('#saveView').onclick = () => drawer('Guardar vista', (body, close) => {
    const name = el('input', { placeholder: 'Mis display con kerning', maxlength: 40 });
    body.append(el('p', { class: 'tiny muted' }, `Se guardará: búsqueda «${S.q || '—'}», filtro «${S.filter || 'todas'}», orden «${S.sort}».`), name);
    body.append(el('button', { class: 'btn primary block', onclick: async () => {
      const n = name.value.trim();
      if (!n) return toast('Ponle un nombre.', 'warn');
      S.views = S.views.filter((v) => v.name !== n).concat([{ name: n, q: S.q, filter: S.filter, sort: S.sort }]);
      await PR.store.kvSet('views', S.views); paintViews(); close(); toast('Vista guardada.', 'ok');
    } }, 'Guardar'));
  });
  $('#newBtn').onclick = async () => {
    const cfg = await config();
    drawer('Nueva fuente', (body, close) => {
      const fam = el('input', { value: 'Mi Fuente', maxlength: 42 });
      const des = el('input', { value: localStorage.getItem('punzon.designer') || 'Leonel', maxlength: 42 });
      const preset = el('select');
      cfg.metricsPresets.forEach((p) => preset.append(el('option', { value: p.id }, p.label)));
      body.append(
        el('div', { class: 'field' }, el('span', {}, 'Familia'), fam),
        el('div', { class: 'field' }, el('span', {}, 'Diseñador'), des),
        el('div', { class: 'field' }, el('span', {}, 'Métricas'), preset),
        el('button', { class: 'btn primary block', onclick: async () => {
          const p = PR.newProject(fam.value.trim() || 'Mi Fuente', des.value.trim() || 'Anónimo');
          try { localStorage.setItem('punzon.designer', p.meta.designer); } catch {}
          const pr = cfg.metricsPresets.find((x) => x.id === preset.value);
          if (pr) Object.assign(p.metrics, { unitsPerEm: pr.unitsPerEm, ascender: pr.ascender, descender: pr.descender, capHeight: pr.capHeight, xHeight: pr.xHeight, lineGap: pr.lineGap });
          for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ') { p.glyphs[ch] = PR.emptyGlyph(ch, ch === ' ' ? 280 : 600); p.order.push(ch); }
          await PR.store.put(p);
          S.order.push(p.id); await PR.store.kvSet('order', S.order);
          S.all = await PR.store.all(); close(); await render();
          toast(`«${p.meta.family}» creada con 63 caracteres en blanco.`, 'ok');
        } }, 'Crear fuente')
      );
    });
  };
  $('#importBtn').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = async (e) => {
    let n = 0;
    for (const f of e.target.files) {
      try {
        const p = PR.normalize(JSON.parse(await fileToText(f)));
        p.id = Math.random().toString(36).slice(2, 9);
        await PR.store.put(p); S.order.push(p.id); n++;
      } catch { toast(`«${f.name}» no es un proyecto Punzón válido.`, 'error'); }
    }
    e.target.value = '';
    if (n) { await PR.store.kvSet('order', S.order); S.all = await PR.store.all(); await render(); toast(`${n} proyecto(s) importados.`, 'ok'); }
  };
}

function paintViews() {
  const sel = $('#view');
  sel.innerHTML = '<option value="">Vista…</option>';
  S.views.forEach((v) => sel.append(el('option', { value: v.name }, v.name)));
}

function visible() {
  let list = S.all.slice();
  if (S.q) list = list.filter((p) => `${p.meta.family} ${p.meta.designer} ${p.meta.style} ${(p.tags || []).join(' ')}`.toLowerCase().includes(S.q));
  if (S.filter === 'drawn') list = list.filter((p) => PR.countDrawn(p) > 0);
  if (S.filter === 'empty') list = list.filter((p) => PR.countDrawn(p) === 0);
  if (S.filter === 'kern') list = list.filter((p) => (p.kerning || []).length > 0);
  const by = {
    modified: (a, b) => b.meta.modified - a.meta.modified,
    name: (a, b) => a.meta.family.localeCompare(b.meta.family, 'es'),
    glyphs: (a, b) => PR.countDrawn(b) - PR.countDrawn(a),
    manual: (a, b) => (S.order.indexOf(a.id) + 1 || 999) - (S.order.indexOf(b.id) + 1 || 999)
  };
  return list.sort(by[S.sort]);
}

async function render() {
  const grid = $('#grid'); grid.innerHTML = '';
  const list = visible(), cur = localStorage.getItem('punzon.current');
  $('#counter').textContent = `${list.length} de ${S.all.length} proyectos`;
  $('#projPill').textContent = `${S.all.length} fuentes locales`;
  renderBulk();
  if (!list.length) { grid.append(el('div', { class: 'empty', style: 'grid-column:1/-1' }, 'Ningún proyecto coincide. Cambia la búsqueda o crea una fuente nueva.')); return; }
  for (const p of list) {
    const drawn = PR.countDrawn(p);
    const sample = p.order.filter((k) => p.glyphs[k].objects.length).slice(0, 9).join('') || 'Aa';
    const card = el('article', {
      class: `card proj ${S.sel.has(p.id) ? 'sel' : ''}`, draggable: true, dataset: { id: p.id }, tabindex: '0',
      onclick: (e) => { if (!e.target.closest('button,input')) openDetail(p); },
      onkeydown: (e) => { if (e.key === 'Enter') openDetail(p); }
    },
      el('div', { class: 'proj-head' },
        el('div', {}, el('h3', {}, p.meta.family), el('p', { class: 'tiny muted' }, `${p.meta.style} · ${p.meta.designer}`)),
        el('input', { type: 'checkbox', class: 'proj-check', 'aria-label': `Seleccionar ${p.meta.family}`, checked: S.sel.has(p.id), onchange: (e) => { e.stopPropagation(); S.sel[e.target.checked ? 'add' : 'delete'](p.id); render(); } })
      ),
      el('div', { class: 'proj-sample', dataset: { face: p.id } }, sample),
      el('div', { class: 'proj-meta' },
        el('span', {}, `${drawn}/${p.order.length} glifos`),
        el('span', {}, `${p.metrics.unitsPerEm} upem`),
        el('span', {}, new Date(p.meta.modified).toLocaleDateString('es')),
        p.id === cur ? el('span', { class: 'tag acid' }, 'abierta') : null
      ),
      el('div', { class: 'bar' }, el('i', { style: `width:${Math.round((drawn / Math.max(1, p.order.length)) * 100)}%` })),
      el('div', { class: 'row', style: 'margin-top:11px' },
        ...(p.tags || []).slice(0, 3).map((t) => el('span', { class: 'tag' }, t)),
        el('button', { class: 'btn sm primary', style: 'margin-left:auto', onclick: async (e) => { e.stopPropagation(); await PR.setCurrent(p.id); location.href = 'index.html'; } }, 'Abrir')
      )
    );
    card.addEventListener('dragstart', () => { S.dragId = p.id; card.classList.add('drag'); });
    card.addEventListener('dragend', () => card.classList.remove('drag'));
    card.addEventListener('dragover', (e) => e.preventDefault());
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      if (!S.dragId || S.dragId === p.id) return;
      const from = S.order.indexOf(S.dragId), to = S.order.indexOf(p.id);
      if (from < 0 || to < 0) return;
      S.order.splice(to, 0, S.order.splice(from, 1)[0]);
      await PR.store.kvSet('order', S.order);
      S.sort = 'manual'; $('#sort').value = 'manual';
      render(); toast('Orden actualizado.', 'ok');
    });
    grid.append(card);
    if (drawn) {
      try {
        const { bytes } = buildFont(p, { quality: { tol: 1.4, seg: 12 } });
        const fam = await previewFace(p.id, bytes);
        const node = grid.querySelector(`[data-face="${p.id}"]`);
        if (node) node.style.fontFamily = `"${fam}", system-ui`;
      } catch {}
    }
  }
}

function renderBulk() {
  const host = $('#bulk'); host.innerHTML = '';
  if (!S.sel.size) return;
  host.append(el('div', { class: 'bulk' },
    el('b', {}, `${S.sel.size} seleccionadas`),
    el('button', { class: 'btn sm', onclick: () => { visible().forEach((p) => S.sel.add(p.id)); render(); } }, 'Todas'),
    el('button', { class: 'btn sm', onclick: () => { S.sel.clear(); render(); } }, 'Ninguna'),
    el('button', { class: 'btn sm steel', onclick: exportSel }, 'Exportar JSON'),
    el('button', { class: 'btn sm', onclick: tagSel }, 'Etiquetar'),
    el('button', { class: 'btn sm danger', onclick: deleteSel }, 'Eliminar')
  ));
}
function exportSel() {
  const items = S.all.filter((p) => S.sel.has(p.id));
  download(JSON.stringify({ format: 'punzon.library', version: 1, projects: items }, null, 2), `punzon-biblioteca-${Date.now()}.json`, 'application/json');
}
function tagSel() {
  drawer('Etiquetar selección', (body, close) => {
    const inp = el('input', { placeholder: 'display, manuscrita, cliente-x' });
    body.append(el('p', { class: 'tiny muted' }, 'Separadas por coma. Se añaden a las etiquetas existentes.'), inp);
    body.append(el('button', { class: 'btn primary block', onclick: async () => {
      const tags = inp.value.split(',').map((t) => t.trim()).filter(Boolean);
      if (!tags.length) return toast('Escribe al menos una etiqueta.', 'warn');
      for (const p of S.all.filter((x) => S.sel.has(x.id))) { p.tags = [...new Set([...(p.tags || []), ...tags])]; await PR.store.put(p); }
      close(); render(); toast(`${tags.length} etiqueta(s) añadidas.`, 'ok');
    } }, 'Aplicar'));
  });
}
async function deleteSel() {
  const items = S.all.filter((p) => S.sel.has(p.id));
  if (!await confirmDialog('Eliminar proyectos', `Se eliminarán ${items.length} proyecto(s) de este dispositivo. Podrás deshacer durante unos segundos.`, 'Eliminar')) return;
  for (const p of items) await PR.store.del(p.id);
  S.sel.clear(); S.all = await PR.store.all(); await render();
  toast(`${items.length} proyecto(s) eliminados.`, 'warn', 9000, {
    label: 'Deshacer', run: async () => { for (const p of items) await PR.store.put(p); S.all = await PR.store.all(); render(); toast('Restaurados.', 'ok'); }
  });
}

function openDetail(p) {
  drawer(p.meta.family, (body, close) => {
    const drawn = PR.countDrawn(p);
    const fam = el('input', { value: p.meta.family, maxlength: 42 });
    const des = el('input', { value: p.meta.designer, maxlength: 42 });
    const tags = el('input', { value: (p.tags || []).join(', ') });
    const style = el('select');
    ['Regular', 'Bold', 'Light', 'Italic', 'Bold Italic', 'Black'].forEach((s) => style.append(el('option', { selected: s === p.meta.style }, s)));
    body.append(
      el('div', { class: 'metrics-mini' },
        el('div', { class: 'stat' }, el('b', {}, String(drawn)), el('span', {}, 'glifos')),
        el('div', { class: 'stat' }, el('b', {}, String(p.order.length)), el('span', {}, 'caracteres')),
        el('div', { class: 'stat' }, el('b', {}, String((p.kerning || []).length)), el('span', {}, 'pares kern')),
        el('div', { class: 'stat' }, el('b', {}, String(p.metrics.unitsPerEm)), el('span', {}, 'upem'))
      ),
      el('div', { class: 'field' }, el('span', {}, 'Familia'), fam),
      el('div', { class: 'field' }, el('span', {}, 'Estilo'), style),
      el('div', { class: 'field' }, el('span', {}, 'Diseñador'), des),
      el('div', { class: 'field' }, el('span', {}, 'Etiquetas'), tags),
      el('button', { class: 'btn primary block', onclick: async () => {
        p.meta.family = fam.value.trim() || p.meta.family;
        p.meta.style = style.value; p.meta.designer = des.value;
        p.tags = tags.value.split(',').map((t) => t.trim()).filter(Boolean);
        await PR.store.put(p); S.all = await PR.store.all(); close(); render(); toast('Cambios guardados.', 'ok');
      } }, 'Guardar cambios'),
      el('div', { class: 'sep' }),
      el('h3', { class: 'ctrl-title' }, 'Glifos dibujados'),
      drawn
        ? el('div', { class: 'glyph-grid' }, ...p.order.filter((k) => p.glyphs[k].objects.length).map((k) => el('div', { class: 'glyph-cell' }, el('b', {}, k === ' ' ? '␣' : k), el('span', {}, `${p.glyphs[k].advance}u`))))
        : el('p', { class: 'tiny muted' }, 'Este proyecto todavía no tiene glifos dibujados.'),
      el('div', { class: 'sep' }),
      el('div', { class: 'col' },
        el('button', { class: 'btn steel block', onclick: async () => { await PR.setCurrent(p.id); location.href = 'index.html'; } }, 'Abrir en el editor'),
        el('button', { class: 'btn block', onclick: async () => { await PR.setCurrent(p.id); location.href = 'muestra.html'; } }, 'Ver muestra tipográfica'),
        el('button', { class: 'btn block', onclick: () => download(JSON.stringify(p, null, 2), `${slug(p.meta.family)}.punzon.json`, 'application/json') }, 'Exportar JSON'),
        el('button', { class: 'btn block', onclick: async () => {
          const c = PR.normalize(JSON.parse(JSON.stringify(p)));
          c.id = Math.random().toString(36).slice(2, 9); c.meta.family += ' copia';
          await PR.store.put(c); S.order.push(c.id); await PR.store.kvSet('order', S.order);
          S.all = await PR.store.all(); close(); render(); toast('Proyecto duplicado.', 'ok');
        } }, 'Duplicar'),
        el('button', { class: 'btn danger block', onclick: async () => {
          if (!await confirmDialog('Eliminar', `«${p.meta.family}» se eliminará de este dispositivo.`, 'Eliminar')) return;
          await PR.store.del(p.id); S.all = await PR.store.all(); close(); render();
          toast('Proyecto eliminado.', 'warn', 9000, { label: 'Deshacer', run: async () => { await PR.store.put(p); S.all = await PR.store.all(); render(); } });
        } }, 'Eliminar')
      )
    );
  });
}
