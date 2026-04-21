/* ================================================================
   neocitiesUpdater — tool de sync y mantenimiento
   - fuente única: master JSON en localStorage
   - parser: neocities index.html → master
   - exporters: neocities html, clouds proyectos.json, archive-data.json
   ================================================================ */

const LS_KEY = 'neocitiesUpdater.v1';
const LS_RULES = 'neocitiesUpdater.rules';
const LS_HEALTH = 'neocitiesUpdater.health';
const LS_THEME = 'neocitiesUpdater.theme';

const DEFAULT_CATEGORIES = [
  'main quests', 'side quests', 'WIP', "meowrhino's world",
  'tools', 'games', 'experiments', 'social apps',
  'unfinished apps', 'texts', 'misc', 'hidden'
];

// map clouds category → archive category
const ARCHIVE_CAT_MAP = {
  "main quests": "mainQuests",
  "side quests": "sideQuests",
  "WIP": "wip",
  "meowrhino's world": "meowrhino",
  "tools": "tools",
  "games": "games",
  "experiments": "experiments",
  "social apps": "social",
  "unfinished apps": "unfinished",
  "texts": "texts",
  "misc": "misc",
  "hidden": "hidden",
};

const GH_API_BASE = 'https://api.github.com/users/meowrhino/repos?per_page=100';

/* -------------------- state -------------------- */

let state = loadState() || makeEmptyState();
let ghRepos = [];      // from last fetch
let ghFetchedAt = null;
let healthCache = loadJSON(LS_HEALTH) || {};
let rules = loadJSON(LS_RULES) || {
  forks: true, archived: true, deprecated: true, test: false, whitelist: ''
};
let currentExportTab = 'neocities';
let editingId = null;

function makeEmptyState() {
  return {
    version: 1,
    categories: [...DEFAULT_CATEGORIES],
    projects: [],
    nav: defaultNav(),
    meta: { createdAt: new Date().toISOString(), lastGhFetch: null }
  };
}

function defaultNav() {
  // capturado del index.html actual, editable a mano en el JSON master
  return [
    { label: 'CV',           url: '/CVs/cast.pdf',   target: '_blank' },
    { label: 'CV2',          url: '/CVs/eng.pdf',    target: '_blank' },
    { label: 'portfolio',    url: 'https://www.figma.com/proto/jYLcGbiaKX2eT2hBY5OsXw/portfolio?page-id=0%3A1&type=design&node-id=1-2&viewport=464%2C100%2C0.08&t=wFIYHU81EJvHIpGv-1&scaling=contain&starting-point-node-id=1%3A2', target: '_blank' },
    { label: 'portfolio_old',url: 'https://meowrhino.cargo.site/portfolio_esp', target: '_blank' },
    { label: 'about me',     url: 'about.html',      target: '_blank' },
    { label: 'twitter',      url: 'https://twitter.com/meowrhino', target: '_blank' },
    { label: 'bsky',         url: 'https://bsky.app/profile/meowrhino.bsky.social', target: '_blank' },
    { label: 'instagram ',   url: 'https://www.instagram.com/meowrhino/', target: '_blank' },
    { label: 'email ',       url: 'mailto:manuellatourf@gmail.com',       target: '_blank' },
    { label: 'paypal',       url: 'https://www.paypal.me/manuellatourf',  target: '_blank' },
  ];
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.projects)) return null;
    return s;
  } catch (_) { return null; }
}

function saveState() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  updateStatusLine();
  updateDashboard();
}

function loadJSON(k) {
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; }
  catch (_) { return null; }
}
function saveJSON(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

/* -------------------- helpers -------------------- */

function $(sel, root = document) { return root.querySelector(sel); }
function $$(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}
function uid(base = '') {
  const s = (base || 'p').toString().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let id = s || 'p', i = 2;
  while (state.projects.some(p => p.id === id)) { id = `${s}-${i++}`; }
  return id;
}
function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function toast(msg, ms = 2000) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast._id);
  toast._id = setTimeout(() => { t.hidden = true; }, ms);
}

/* -------------------- type inference -------------------- */

function inferLinkType(url) {
  if (!url) return 'unknown';
  const u = String(url).trim();
  if (u.startsWith('mailto:') || u.startsWith('tel:')) return 'contact';
  if (!/^https?:/i.test(u) && !u.startsWith('/')) {
    if (/\.(png|jpe?g|gif|svg|webp|pdf|mp4|webm|mp3|wav)$/i.test(u)) return 'neocities-asset';
    return 'local-page';
  }
  try {
    const parsed = new URL(u, 'https://meowrhino.neocities.org/');
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;
    if (host === 'meowrhino.github.io') return 'github-pages';
    if (host === 'meowrhino.gitlab.io') return 'gitlab-pages';
    if (host === 'meowrhino.neocities.org') {
      if (path === '/' || path === '') return 'external';
      return 'neocities-asset';
    }
    if (host.endsWith('mega.nz')) return 'mega';
    if (host.includes('figma.com')) return 'figma';
    if (host.includes('cargo.site')) return 'cargo';
    if (host.includes('indiexpo.net')) return 'indiexpo';
    if (host.includes('youtube.com') || host === 'youtu.be') return 'youtube';
    if (host.includes('manus.space')) return 'manus';
    if (host.includes('onrender.com')) return 'render';
    if (host.includes('workers.dev')) return 'cloudflare';
    if (host.includes('tumblr.com')) return 'tumblr';
    if (host.includes('blogspot.com')) return 'blogspot';
    if (host.includes('hotglue.me')) return 'hotglue';
    if (host === 'localhost') return 'local';
    return 'custom-domain'; // dominio propio
  } catch (_) {
    return 'unknown';
  }
}

function ghRepoFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'meowrhino.github.io') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[0] || null;
  } catch (_) { return null; }
}

function inferProjectType(project) {
  // prioridad: github-pages > custom-domain > external > local-page > neocities-asset
  const types = project.links.map(l => inferLinkType(l.url));
  const priority = ['github-pages', 'gitlab-pages', 'custom-domain', 'external', 'neocities-asset', 'local-page'];
  for (const t of priority) {
    if (types.includes(t)) return t === 'gitlab-pages' ? 'external' : t;
  }
  // fallback: el primer tipo conocido
  const known = types.find(t => t !== 'unknown' && t !== 'contact');
  return known || 'external';
}

/* -------------------- HTML parser (neocities index → master) -------------------- */

function parseNeocitiesHtml(htmlString) {
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  const container = doc.querySelector('#proyectes') || doc.body;
  if (!container) throw new Error('No se encontró #proyectes.');

  const projects = [];
  const seenIds = new Set();
  let currentCategory = 'uncategorized';
  let cur = null;  // proyecto acumulando

  function flush() {
    if (!cur) return;
    if (!cur.links.length && !cur.name) { cur = null; return; }
    // id único
    let base = (cur.id || cur.name || 'p').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let id = base || 'p', i = 2;
    while (seenIds.has(id)) id = `${base}-${i++}`;
    seenIds.add(id);
    cur.id = id;
    cur.type = inferProjectType(cur);
    // derivar ghRepo si corresponde
    const ghLink = cur.links.find(l => inferLinkType(l.url) === 'github-pages');
    if (ghLink) cur.ghRepo = ghRepoFromUrl(ghLink.url);
    projects.push(cur);
    cur = null;
  }

  // recorrer hijos en orden
  for (const node of container.childNodes) {
    const isComment = node.nodeType === Node.COMMENT_NODE;
    const isElement = node.nodeType === Node.ELEMENT_NODE;

    if (isComment) {
      const text = node.textContent.trim();
      if (text) {
        // canonicalizar contra DEFAULT_CATEGORIES (case-insensitive)
        const canon = DEFAULT_CATEGORIES.find(c => c.toLowerCase() === text.toLowerCase());
        currentCategory = canon || text;
      }
      continue;
    }
    if (!isElement) continue;

    const tag = node.tagName.toLowerCase();

    if (tag === 'ainfo') {
      flush();
      const style = node.getAttribute('style') || '';
      const highlight = /#FFD66B/i.test(style);
      const isHiddenStyle = /cursor:\s*default/i.test(style) || /color:\s*black/i.test(style);
      cur = {
        id: '',
        name: node.textContent.trim(),
        highlight,
        category: isHiddenStyle ? 'hidden' : currentCategory,
        type: 'external',
        subtype: '',
        status: 'live',
        client: '',
        hidden: false,
        notes: '',
        sup: '',
        showIn: { neocities: true, clouds: currentCategory !== 'hidden', archive: currentCategory !== 'hidden' },
        links: [],
        ghRepo: null,
        hiddenStyle: isHiddenStyle, // preserva el inline style en export
      };
      continue;
    }

    if (tag === 'a' && cur) {
      const href = node.getAttribute('href') || '';
      if (!href) continue;
      cur.links.push({
        label: (node.textContent || '').trim() || 'link',
        url: href,
      });
      continue;
    }

    if (tag === 'sup' && cur) {
      cur.sup = (cur.sup ? cur.sup + ' ' : '') + (node.textContent || '').trim();
      continue;
    }

    if (tag === 'br') continue;
  }
  flush();

  // status inferido
  for (const p of projects) {
    if (p.links.some(l => /_DEPRECATED\/?$/i.test(l.url)) || /deprecated/i.test(p.name)) p.status = 'deprecated';
    else if (p.links.some(l => /\bWIP\b/i.test(l.label))) p.status = 'wip';
    else if (p.links.some(l => /\balpha\b/i.test(l.label))) p.status = 'alpha';
    else if (p.links.some(l => /\bbeta\b/i.test(l.label))) p.status = 'beta';
    if (p.type === 'custom-domain') p.client = p.name;
  }

  return {
    version: 1,
    categories: [...DEFAULT_CATEGORIES],
    projects,
    nav: defaultNav(),
    meta: { createdAt: new Date().toISOString(), lastGhFetch: null, importedFrom: 'neocities-html' }
  };
}

/* -------------------- exporters -------------------- */

function exportNeocitiesHtml() {
  const byCat = {};
  for (const cat of state.categories) byCat[cat] = [];
  for (const p of state.projects) {
    if (!p.showIn?.neocities) continue;
    if (!byCat[p.category]) byCat[p.category] = [];
    byCat[p.category].push(p);
  }

  const navHtml = state.nav.map(n => {
    const t = n.target ? ` target="${escapeHtml(n.target)}"` : '';
    return `      <a href="${escapeHtml(n.url)}"${t}>\n        <li>${escapeHtml(n.label)}</li>\n      </a>`;
  }).join('\n\n');

  const sectionsHtml = state.categories.map((cat, idx) => {
    const items = byCat[cat] || [];
    if (!items.length) return `      <!--${cat}-->\n`;
    const rows = items.map(p => projectToNeocitiesLine(p)).join('\n');
    const sep = idx < state.categories.length - 1 ? '      <br>\n' : '';
    return `      <!--${cat}-->\n\n${rows}\n${sep}`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>

<head>
  <meta charset="UTF-8">
  <link href="style.css" rel="stylesheet" type="text/css" media="all">
  <title>meowrhino</title>
</head>

<body>
  <div id="container">

    <div id="marqueebar">
      <marquee behavior="alternate"><a href="https://meowrhino.neocities.org/" target="_blank">
          <h1>meowrhino's world</h1>
        </a></marquee>
    </div>

    <div id="nav">

${navHtml}

      <br> <br>
    </div>


    <div id="proyectes">

${sectionsHtml}
    </div>

  </div>

</body>

</html>
`;
}

function projectToNeocitiesLine(p) {
  const ainfoStyle = p.hiddenStyle
    ? ' style="color:black; cursor: default"'
    : (p.highlight ? ' style="color: #FFD66B;"' : '');
  const supHtml = p.sup ? `<sup>${escapeHtml(p.sup)}</sup>` : '';
  const linkStylePrefix = p.hiddenStyle ? ' style="color:black; cursor: default;"' : '';
  const linksHtml = p.links.map(l =>
    `      <a${linkStylePrefix} href="${escapeHtml(l.url)}" target="_blank">${escapeHtml(l.label || 'link')}</a>`
  ).join('\n');
  return `      <ainfo${ainfoStyle}>${escapeHtml(p.name)}</ainfo>${supHtml}\n${linksHtml} <br>`;
}

function exportCloudsJson() {
  const out = {};
  for (const cat of state.categories) {
    const items = state.projects
      .filter(p => p.category === cat && p.showIn?.clouds !== false && !p.hidden);
    if (!items.length) continue;
    out[cat] = items.map(p => ({
      name: p.name,
      links: p.links.map(l => l.url),
    }));
  }
  return JSON.stringify(out, null, 2);
}

function exportArchiveJson() {
  const out = {
    welcome: {
      titulo: 'meowrhino archive',
      studioUrl: 'index.html',
    }
  };
  for (const cat of state.categories) {
    const key = ARCHIVE_CAT_MAP[cat] || cat.replace(/\s+/g, '');
    const items = state.projects
      .filter(p => p.category === cat && p.showIn?.archive !== false && !p.hidden);
    if (!items.length) continue;
    out[key] = items.map(p => {
      if (p.links.length === 1) {
        return { nombre: p.name, url: p.links[0].url };
      }
      return {
        nombre: p.name,
        links: p.links.map(l => ({ label: l.label || 'link', url: l.url }))
      };
    });
  }
  return JSON.stringify(out, null, 2);
}

/* -------------------- UI: tabs -------------------- */

function setupTabs() {
  for (const btn of $$('.tab-btn')) {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
      if (btn.dataset.tab === 'projects') renderProjects();
      if (btn.dataset.tab === 'auditor') renderAuditor();
      if (btn.dataset.tab === 'health') renderHealth();
      if (btn.dataset.tab === 'export') regenExport();
    });
  }
  for (const btn of $$('.export-tab-btn')) {
    btn.addEventListener('click', () => {
      currentExportTab = btn.dataset.etab;
      $$('.export-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      regenExport();
    });
  }
}

/* -------------------- UI: dashboard -------------------- */

function updateStatusLine() {
  const total = state.projects.length;
  const last = state.meta?.lastGhFetch ? ` · gh: ${new Date(state.meta.lastGhFetch).toLocaleString()}` : '';
  $('#status-line').textContent = `${total} proyectos${last}`;
}

function updateDashboard() {
  const projs = state.projects;
  $('#stat-total').textContent = projs.length;
  $('#stat-gh').textContent = projs.filter(p => p.type === 'github-pages').length;
  $('#stat-custom').textContent = projs.filter(p => p.type === 'custom-domain' || p.links.some(l => inferLinkType(l.url) === 'custom-domain')).length;
  $('#stat-external').textContent = projs.filter(p => p.type === 'external').length;
  $('#stat-hidden').textContent = projs.filter(p => p.hidden || p.category === 'hidden').length;

  // orphans/dead need GH data
  if (ghRepos.length) {
    const orphans = computeOrphans();
    $('#stat-orphans').textContent = orphans.length;
    const dead = computeDeadRepos();
    $('#stat-dead').textContent = dead.length;
  } else {
    $('#stat-orphans').textContent = '—';
    $('#stat-dead').textContent = '—';
  }

  // categorías
  const cats = $('#cat-overview');
  cats.innerHTML = '';
  for (const cat of state.categories) {
    const n = projs.filter(p => p.category === cat).length;
    cats.appendChild(el('div', { class: 'cat-card' },
      el('b', {}, cat),
      el('span', {}, `${n} proyectos`)
    ));
  }

  // filtro de categorías en projects
  const sel = $('#proj-filter-cat');
  if (sel) {
    const current = sel.value;
    sel.innerHTML = '<option value="">todas las categorías</option>';
    for (const cat of state.categories) {
      sel.appendChild(el('option', { value: cat }, cat));
    }
    sel.value = current;
  }

  // seed prompt
  $('#seed-prompt').hidden = projs.length > 0;
}

/* -------------------- UI: projects tab -------------------- */

function renderProjects() {
  const q = $('#proj-search').value.toLowerCase().trim();
  const fcat = $('#proj-filter-cat').value;
  const ftype = $('#proj-filter-type').value;
  const fstatus = $('#proj-filter-status').value;
  const showHidden = $('#proj-filter-hidden').checked;

  const root = $('#projects-list');
  root.innerHTML = '';

  // agrupar por categoría en el orden de state.categories
  const byCat = {};
  for (const cat of state.categories) byCat[cat] = [];
  for (const p of state.projects) {
    if (!byCat[p.category]) byCat[p.category] = [];
    byCat[p.category].push(p);
  }

  const passes = (p) => {
    if (!showHidden && (p.hidden || p.category === 'hidden')) return false;
    if (fcat && p.category !== fcat) return false;
    if (ftype && p.type !== ftype) return false;
    if (fstatus && p.status !== fstatus) return false;
    if (q) {
      const hay = [p.name, p.id, p.client, p.ghRepo, ...p.links.map(l => l.url), ...p.links.map(l => l.label)]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  };

  for (const cat of state.categories) {
    const items = (byCat[cat] || []).filter(passes);
    if (!items.length && (fcat || q || ftype || fstatus)) continue;

    const group = el('div', { class: 'cat-group', dataset: { category: cat } });
    const header = el('div', { class: 'cat-group-header' },
      el('b', {}, cat),
      el('span', {}, `${items.length} / ${(byCat[cat] || []).length}`)
    );
    group.appendChild(header);

    for (const p of items) group.appendChild(renderProjectRow(p));
    root.appendChild(group);
  }

  if (!root.children.length) {
    root.appendChild(el('div', { class: 'panel' }, el('p', { class: 'subtle' }, 'sin resultados con estos filtros.')));
  }
}

function renderProjectRow(p) {
  if (editingId === p.id) return renderProjectEdit(p);

  const row = el('div', {
    class: 'project-row' + ((p.hidden || p.category === 'hidden') ? ' hidden-row' : ''),
    draggable: 'true',
    dataset: { id: p.id, cat: p.category }
  });

  row.appendChild(el('span', { class: 'drag-handle', title: 'arrastrar para reordenar' }, '⋮⋮'));
  row.appendChild(el('div', {},
    el('div', { class: 'p-name' + (p.highlight ? ' highlight' : '') }, p.name),
    el('div', { class: 'p-slug' }, p.id + (p.ghRepo ? ` · gh:${p.ghRepo}` : ''))
  ));
  row.appendChild(el('div', { class: 'p-cat' }, p.category));
  row.appendChild(el('div', { class: 'p-type' }, p.type));
  row.appendChild(el('div', { class: 'p-status' }, p.status));

  const links = el('div', { class: 'p-links' });
  for (const l of p.links) {
    const cls = 'p-link' + (healthCache[l.url] === 'ok' ? ' ok' : (healthCache[l.url] === 'err' ? ' broken' : ''));
    links.appendChild(el('a', { class: cls, href: l.url, target: '_blank', rel: 'noopener' },
      el('span', { class: 'lbl' }, `[${l.label}]`), truncate(l.url, 50)
    ));
  }
  row.appendChild(links);

  row.appendChild(el('div', { class: 'p-actions' },
    el('button', { onclick: () => { editingId = p.id; renderProjects(); } }, 'edit'),
    el('button', { onclick: () => toggleHidden(p.id) }, (p.hidden ? 'unhide' : 'hide')),
    el('button', { onclick: () => deleteProject(p.id) }, 'del')
  ));

  wireDragRow(row);
  return row;
}

function renderProjectEdit(p) {
  const box = el('div', { class: 'project-edit', dataset: { id: p.id } });

  const input = (label, val, kind = 'text', opts = null) => {
    let input;
    if (kind === 'select') {
      input = el('select', {}, ...opts.map(o => el('option', { value: o, selected: val === o }, o)));
    } else if (kind === 'textarea') {
      input = el('textarea', {}, val || '');
    } else {
      input = el('input', { type: 'text', value: val || '' });
    }
    const lbl = el('label', {}, el('span', {}, label), input);
    return { lbl, input };
  };

  const f = {};
  f.name    = input('name', p.name);
  f.id      = input('id / slug', p.id);
  f.category= input('category', p.category, 'select', state.categories);
  f.type    = input('type', p.type, 'select', ['github-pages','custom-domain','external','neocities-asset','local-page']);
  f.status  = input('status', p.status, 'select', ['live','wip','alpha','beta','deprecated']);
  f.client  = input('client', p.client);
  f.ghRepo  = input('ghRepo', p.ghRepo || '');
  f.sup     = input('sup (nota pequeña)', p.sup || '');
  f.notes   = input('notas', p.notes || '', 'textarea');

  for (const k of ['name','id','category','type','status','client','ghRepo','sup']) box.appendChild(f[k].lbl);
  f.notes.lbl.classList.add('full'); box.appendChild(f.notes.lbl);

  // flags
  const chkbox = (label, checked) => {
    const inp = el('input', { type: 'checkbox' });
    if (checked) inp.checked = true;
    return { lbl: el('label', { class: 'chk' }, inp, el('span', {}, label)), input: inp };
  };
  f.highlight = chkbox('highlight (amarillo)', p.highlight);
  f.hidden    = chkbox('hidden (ocultar del tool + outputs)', p.hidden);
  f.siNeo     = chkbox('incluir en neocities', p.showIn?.neocities !== false);
  f.siCloud   = chkbox('incluir en clouds', p.showIn?.clouds !== false);
  f.siArch    = chkbox('incluir en archive', p.showIn?.archive !== false);
  const flagsBox = el('div', { class: 'full row' }, f.highlight.lbl, f.hidden.lbl, f.siNeo.lbl, f.siCloud.lbl, f.siArch.lbl);
  box.appendChild(flagsBox);

  // links editor
  const linksBox = el('div', { class: 'full links-editor' });
  linksBox.appendChild(el('b', {}, 'links'));
  const links = p.links.map(l => ({ ...l }));
  function redrawLinks() {
    $$('.link-row', linksBox).forEach(n => n.remove());
    links.forEach((l, i) => {
      const labelInp = el('input', { type: 'text', value: l.label || '' });
      const urlInp = el('input', { type: 'text', value: l.url || '' });
      const up = el('button', { onclick: () => { if (i > 0) { [links[i-1], links[i]] = [links[i], links[i-1]]; syncLinks(); redrawLinks(); } } }, '↑');
      const dn = el('button', { onclick: () => { if (i < links.length - 1) { [links[i+1], links[i]] = [links[i], links[i+1]]; syncLinks(); redrawLinks(); } } }, '↓');
      const del = el('button', { onclick: () => { links.splice(i, 1); syncLinks(); redrawLinks(); } }, '×');
      labelInp.addEventListener('input', () => { l.label = labelInp.value; syncLinks(); });
      urlInp.addEventListener('input', () => { l.url = urlInp.value; syncLinks(); });
      linksBox.appendChild(el('div', { class: 'link-row' }, labelInp, urlInp, el('div', { class: 'row' }, up, dn, del)));
    });
  }
  function syncLinks() { p.links = links.slice(); }
  redrawLinks();
  const addLink = el('button', { onclick: () => { links.push({ label: 'link', url: '' }); syncLinks(); redrawLinks(); } }, '+ add link');
  linksBox.appendChild(addLink);
  box.appendChild(linksBox);

  // save / cancel
  const save = () => {
    p.name = f.name.input.value.trim();
    const newId = f.id.input.value.trim();
    if (newId && newId !== p.id && !state.projects.some(x => x.id === newId)) p.id = newId;
    p.category = f.category.input.value;
    p.type = f.type.input.value;
    p.status = f.status.input.value;
    p.client = f.client.input.value.trim();
    p.ghRepo = f.ghRepo.input.value.trim() || null;
    p.sup = f.sup.input.value.trim();
    p.notes = f.notes.input.value;
    p.highlight = f.highlight.input.checked;
    p.hidden = f.hidden.input.checked;
    p.showIn = {
      neocities: f.siNeo.input.checked,
      clouds: f.siCloud.input.checked,
      archive: f.siArch.input.checked,
    };
    p.links = links.filter(l => l.url.trim());
    editingId = null;
    saveState();
    renderProjects();
    toast('guardado');
  };
  const cancel = () => { editingId = null; renderProjects(); };
  box.appendChild(el('div', { class: 'full row' },
    el('button', { onclick: save }, 'guardar'),
    el('button', { onclick: cancel }, 'cancelar')
  ));
  return box;
}

function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function toggleHidden(id) {
  const p = state.projects.find(x => x.id === id);
  if (!p) return;
  p.hidden = !p.hidden;
  saveState();
  renderProjects();
}

function deleteProject(id) {
  if (!confirm('¿borrar este proyecto?')) return;
  state.projects = state.projects.filter(x => x.id !== id);
  saveState();
  renderProjects();
}

function newProject() {
  const p = {
    id: uid('nuevo'),
    name: 'nuevo proyecto',
    highlight: false,
    category: state.categories[0],
    type: 'github-pages',
    subtype: '',
    status: 'live',
    client: '',
    hidden: false,
    notes: '',
    sup: '',
    showIn: { neocities: true, clouds: true, archive: true },
    links: [{ label: 'link', url: '' }],
    ghRepo: null,
    hiddenStyle: false,
  };
  state.projects.unshift(p);
  editingId = p.id;
  saveState();
  renderProjects();
}

/* -------------------- drag reorder -------------------- */

let dragState = null;

function wireDragRow(row) {
  row.addEventListener('dragstart', (e) => {
    dragState = { id: row.dataset.id };
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dataset.id);
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('dragging');
    $$('.project-row').forEach(r => r.classList.remove('drop-above', 'drop-below'));
  });
  row.addEventListener('dragover', (e) => {
    if (!dragState) return;
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const above = e.clientY < rect.top + rect.height / 2;
    row.classList.toggle('drop-above', above);
    row.classList.toggle('drop-below', !above);
  });
  row.addEventListener('dragleave', () => {
    row.classList.remove('drop-above', 'drop-below');
  });
  row.addEventListener('drop', (e) => {
    e.preventDefault();
    const fromId = dragState?.id;
    const toId = row.dataset.id;
    if (!fromId || fromId === toId) return;
    const above = row.classList.contains('drop-above');
    reorderProject(fromId, toId, above);
  });
}

function reorderProject(fromId, toId, before) {
  const from = state.projects.findIndex(p => p.id === fromId);
  const to = state.projects.findIndex(p => p.id === toId);
  if (from < 0 || to < 0) return;
  const moved = state.projects.splice(from, 1)[0];
  // si cambia categoría, adoptar la del destino
  moved.category = state.projects[to > from ? to - 1 : to].category;
  let newIdx = state.projects.findIndex(p => p.id === toId);
  if (!before) newIdx += 1;
  state.projects.splice(newIdx, 0, moved);
  saveState();
  renderProjects();
}

/* -------------------- auditor (GH fetch + diff) -------------------- */

async function fetchGh() {
  const statusEl = $('#gh-status');
  statusEl.textContent = 'fetching…';
  try {
    const page1 = await fetch(GH_API_BASE + '&page=1').then(r => r.json());
    let all = page1;
    if (page1.length === 100) {
      const page2 = await fetch(GH_API_BASE + '&page=2').then(r => r.json());
      all = all.concat(page2);
    }
    ghRepos = all;
    ghFetchedAt = new Date().toISOString();
    state.meta.lastGhFetch = ghFetchedAt;
    saveState();
    statusEl.textContent = `${all.length} repos · ${new Date().toLocaleTimeString()}`;
    renderAuditor();
    updateDashboard();
  } catch (e) {
    statusEl.textContent = 'error fetcheando: ' + e.message;
  }
}

function isIgnoredByRules(repo) {
  if (rules.forks && repo.fork) return true;
  if (rules.archived && repo.archived) return true;
  if (rules.deprecated && /_DEPRECATED\s*$/i.test(repo.name)) return true;
  if (rules.test && /(test|prueba|xxx)/i.test(repo.name)) return true;
  const wl = (rules.whitelist || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (wl.includes(repo.name.toLowerCase())) return true;
  return false;
}

function computeOrphans() {
  if (!ghRepos.length) return [];
  const used = new Set();
  for (const p of state.projects) {
    if (p.ghRepo) used.add(p.ghRepo.toLowerCase());
    for (const l of p.links) {
      const r = ghRepoFromUrl(l.url);
      if (r) used.add(r.toLowerCase());
    }
  }
  return ghRepos.filter(r => !used.has(r.name.toLowerCase()) && !isIgnoredByRules(r));
}

function computeDeadRepos() {
  if (!ghRepos.length) return [];
  const names = new Set(ghRepos.map(r => r.name.toLowerCase()));
  const dead = [];
  for (const p of state.projects) {
    for (const l of p.links) {
      const r = ghRepoFromUrl(l.url);
      if (r && !names.has(r.toLowerCase())) dead.push({ project: p, url: l.url, repo: r });
    }
  }
  return dead;
}

function renderAuditor() {
  // hydrate rules inputs
  $('#rule-forks').checked = rules.forks;
  $('#rule-archived').checked = rules.archived;
  $('#rule-deprecated').checked = rules.deprecated;
  $('#rule-test').checked = rules.test;
  $('#rule-whitelist').value = rules.whitelist || '';

  const orphansEl = $('#orphans-list');
  orphansEl.innerHTML = '';
  if (!ghRepos.length) {
    orphansEl.appendChild(el('p', { class: 'subtle' }, 'pulsa "fetch github repos" para empezar.'));
    $('#deadrepos-list').innerHTML = '';
    return;
  }
  const orphans = computeOrphans();
  if (!orphans.length) {
    orphansEl.appendChild(el('p', { class: 'subtle' }, '🎉 todos los repos están listados.'));
  }
  for (const repo of orphans) {
    const row = el('div', { class: 'orphan-row' });
    row.appendChild(el('div', {},
      el('div', { class: 'repo-name' }, repo.name),
      el('div', { class: 'meta' },
        (repo.fork ? 'fork · ' : '') +
        (repo.archived ? 'archived · ' : '') +
        (repo.language || '—') + ' · ★' + (repo.stargazers_count || 0)
      )
    ));
    row.appendChild(el('div', {},
      el('a', { href: repo.html_url, target: '_blank', class: 'p-link' }, repo.html_url),
      el('div', { class: 'meta' }, repo.description || '')
    ));
    const catSel = el('select', {},
      ...state.categories.map(c => el('option', { value: c }, c)));
    catSel.value = guessCategoryForRepo(repo);
    row.appendChild(catSel);
    row.appendChild(el('div', { class: 'row' },
      el('button', { onclick: () => { addProjectFromRepo(repo, catSel.value); row.remove(); } }, '+ añadir'),
      el('button', { onclick: () => addWhitelist(repo.name) }, 'ignorar')
    ));
    orphansEl.appendChild(row);
  }

  const deadEl = $('#deadrepos-list');
  deadEl.innerHTML = '';
  const dead = computeDeadRepos();
  if (!dead.length) deadEl.appendChild(el('p', { class: 'subtle' }, 'ningún link apunta a un repo gh muerto.'));
  for (const d of dead) {
    const row = el('div', { class: 'orphan-row' });
    row.appendChild(el('div', {},
      el('div', { class: 'repo-name' }, d.project.name),
      el('div', { class: 'meta' }, `cat: ${d.project.category} · slug: ${d.project.id}`)
    ));
    row.appendChild(el('div', {}, d.url));
    row.appendChild(el('div', { class: 'meta' }, 'repo: ' + d.repo));
    row.appendChild(el('div', { class: 'row' },
      el('button', { onclick: () => { editingId = d.project.id; goTab('projects'); } }, 'editar')
    ));
    deadEl.appendChild(row);
  }
}

function guessCategoryForRepo(repo) {
  const n = repo.name.toLowerCase();
  if (/_deprecated$/i.test(n)) return 'unfinished apps';
  if (/^notas/.test(n) || n === 'hopeko' || n === 'hopeko2' || n === 'somnis' || n === 'historias') return 'texts';
  if (/(chat|piuler|messagepark)/.test(n)) return 'social apps';
  if (/(cards|minesweeper|rockpaper|lettersoup|horselife|gameoflife|5cards)/.test(n)) return 'games';
  if (/(calc|generator|convert|converter|img|video|fcyp|checker|setup|trackr|navicon|tarifa|etymodict|writingapp|faqautonomos|encuesta|colorfun)/.test(n)) return 'tools';
  if (/test|_deprecated|safeamorx|plantitas|latrini|linktree|tinnitus|ableme|oca|tem|directorio|registro|quests|receptes|taxrhino|txttohtml|paintonline|pdfs|grid-web|xordxs|tarifas/.test(n)) return 'unfinished apps';
  return 'experiments';
}

function addProjectFromRepo(repo, category) {
  const p = {
    id: uid(repo.name),
    name: repo.name,
    highlight: false,
    category,
    type: 'github-pages',
    subtype: '',
    status: repo.archived ? 'deprecated' : 'live',
    client: '',
    hidden: false,
    notes: repo.description || '',
    sup: '',
    showIn: { neocities: true, clouds: true, archive: true },
    links: [{ label: 'link', url: `https://meowrhino.github.io/${repo.name}/` }],
    ghRepo: repo.name,
    hiddenStyle: false,
  };
  state.projects.push(p);
  saveState();
  toast(`añadido: ${repo.name}`);
}

function addWhitelist(name) {
  const list = (rules.whitelist || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!list.includes(name)) list.push(name);
  rules.whitelist = list.join(', ');
  $('#rule-whitelist').value = rules.whitelist;
  saveJSON(LS_RULES, rules);
  renderAuditor();
}

function wireAuditorRules() {
  const bind = (id, key) => $(id).addEventListener('change', (e) => {
    rules[key] = e.target.checked;
    saveJSON(LS_RULES, rules);
    renderAuditor();
    updateDashboard();
  });
  bind('#rule-forks', 'forks');
  bind('#rule-archived', 'archived');
  bind('#rule-deprecated', 'deprecated');
  bind('#rule-test', 'test');
  $('#rule-whitelist').addEventListener('input', (e) => {
    rules.whitelist = e.target.value;
    saveJSON(LS_RULES, rules);
    clearTimeout(wireAuditorRules._t);
    wireAuditorRules._t = setTimeout(() => { renderAuditor(); updateDashboard(); }, 300);
  });
}

function goTab(name) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'projects') renderProjects();
  if (name === 'auditor') renderAuditor();
  if (name === 'health') renderHealth();
  if (name === 'export') regenExport();
}

/* -------------------- health check -------------------- */

function renderHealth() {
  const root = $('#health-list');
  root.innerHTML = '';
  const urls = collectUrls();
  for (const u of urls) {
    const status = healthCache[u] || 'unknown';
    root.appendChild(el('div', { class: 'health-row ' + status },
      el('span', { class: 'dot' }),
      el('span', {}, u.project),
      el('a', { href: u.url, target: '_blank' }, u.url),
      el('span', {}, status)
    ));
  }
}

function collectUrls(onlyCustom = false) {
  const out = [];
  for (const p of state.projects) {
    for (const l of p.links) {
      if (onlyCustom && inferLinkType(l.url) !== 'custom-domain') continue;
      if (!/^https?:/i.test(l.url)) continue;
      out.push({ project: p.name, url: l.url, type: inferLinkType(l.url) });
    }
  }
  return out;
}

async function pingUrl(url) {
  // CORS-safe ping: no-cors fetch returns opaque; error = real network failure
  try {
    await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
    return 'ok';
  } catch (_) {
    return 'err';
  }
}

async function checkAll(onlyCustom = false) {
  const urls = collectUrls(onlyCustom);
  const statusEl = $('#health-status');
  let i = 0;
  for (const u of urls) {
    i++;
    statusEl.textContent = `${i}/${urls.length} · ${truncate(u.url, 60)}`;
    const r = await pingUrl(u.url);
    healthCache[u.url] = r;
    saveJSON(LS_HEALTH, healthCache);
    renderHealth();
  }
  statusEl.textContent = `listo · ${urls.length} checks`;
}

/* -------------------- export tab -------------------- */

function regenExport() {
  let out = '';
  if (currentExportTab === 'neocities') out = exportNeocitiesHtml();
  else if (currentExportTab === 'clouds') out = exportCloudsJson();
  else if (currentExportTab === 'archive') out = exportArchiveJson();
  $('#export-output').textContent = out;
}

async function copyExport() {
  try {
    await navigator.clipboard.writeText($('#export-output').textContent);
    toast('copiado al portapapeles');
  } catch (_) {
    toast('no se pudo copiar · selecciona y copia manual');
  }
}

function downloadExport() {
  const content = $('#export-output').textContent;
  const ext = currentExportTab === 'neocities' ? 'html' : 'json';
  const name = currentExportTab === 'neocities' ? 'index.html'
    : currentExportTab === 'clouds' ? 'proyectos.json'
    : 'archive-data.json';
  const blob = new Blob([content], { type: ext === 'html' ? 'text/html' : 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

/* -------------------- import/export master JSON -------------------- */

function exportMasterJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `master-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

function triggerImport() {
  $('#file-input').click();
}

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data.projects)) throw new Error('no parece un master JSON.');
      state = data;
      saveState();
      updateDashboard();
      renderProjects();
      toast('master JSON importado');
    } catch (err) { alert('error: ' + err.message); }
  };
  reader.readAsText(file);
}

/* -------------------- theme -------------------- */

function setTheme(t) {
  document.body.dataset.theme = t;
  localStorage.setItem(LS_THEME, t);
}
function toggleTheme() {
  setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
}

/* -------------------- seed -------------------- */

async function tryFetchSeed() {
  // 1) si hay un master JSON previamente guardado en data/seed.json, úsalo
  try {
    const r = await fetch('data/seed.json', { cache: 'no-store' });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data.projects)) {
        state = data;
        saveState();
        updateDashboard();
        renderProjects();
        toast('seed.json cargado');
        return;
      }
    }
  } catch (_) { /* ignore */ }

  // 2) fallback: parsear data/neocities-snapshot.html
  try {
    const r = await fetch('data/neocities-snapshot.html', { cache: 'no-store' });
    if (!r.ok) throw new Error('no snapshot');
    const html = await r.text();
    const s = parseNeocitiesHtml(html);
    state = s;
    saveState();
    updateDashboard();
    renderProjects();
    toast(`snapshot parseado · ${s.projects.length} proyectos`);
  } catch (e) {
    toast('no hay seed ni snapshot · pega el HTML o importa JSON');
  }
}

function parseHtmlFromTextarea() {
  const html = $('#seed-html').value.trim();
  if (!html) { alert('pega el HTML primero.'); return; }
  try {
    const s = parseNeocitiesHtml(html);
    state = s;
    saveState();
    updateDashboard();
    renderProjects();
    toast(`parseados ${s.projects.length} proyectos`);
  } catch (e) { alert('error parseando: ' + e.message); }
}

/* -------------------- init -------------------- */

function init() {
  setTheme(localStorage.getItem(LS_THEME) || 'dark');
  setupTabs();
  updateStatusLine();
  updateDashboard();
  wireAuditorRules();

  // dashboard actions
  $('#btn-parse-html').addEventListener('click', parseHtmlFromTextarea);
  $('#btn-fetch-seed').addEventListener('click', tryFetchSeed);
  $('#btn-empty').addEventListener('click', () => { state = makeEmptyState(); saveState(); updateDashboard(); toast('vacío'); });

  // projects filters
  ['proj-search','proj-filter-cat','proj-filter-type','proj-filter-status','proj-filter-hidden']
    .forEach(id => $('#'+id).addEventListener('input', renderProjects));
  $('#btn-new-project').addEventListener('click', newProject);

  // auditor
  $('#btn-fetch-gh').addEventListener('click', fetchGh);

  // health
  $('#btn-check-all').addEventListener('click', () => checkAll(false));
  $('#btn-check-custom').addEventListener('click', () => checkAll(true));

  // export
  $('#btn-regen').addEventListener('click', regenExport);
  $('#btn-copy').addEventListener('click', copyExport);
  $('#btn-download').addEventListener('click', downloadExport);

  // master JSON import/export
  $('#btn-import').addEventListener('click', triggerImport);
  $('#btn-export-json').addEventListener('click', exportMasterJson);
  $('#file-input').addEventListener('change', (e) => {
    if (e.target.files?.[0]) handleImportFile(e.target.files[0]);
    e.target.value = '';
  });

  // theme
  $('#btn-theme').addEventListener('click', toggleTheme);

  // intentar auto-carga de seed si no hay state
  if (!state.projects.length) tryFetchSeed();
}

document.addEventListener('DOMContentLoaded', init);
