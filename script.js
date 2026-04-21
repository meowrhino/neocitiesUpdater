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
let ghRepos = [];
let ghFetchedAt = null;
let healthCache = loadJSON(LS_HEALTH) || {};
let rules = loadJSON(LS_RULES) || {
  forks: true, archived: true, deprecated: true, test: false, whitelist: ''
};
let currentExportTab = 'neocities';
let editingId = null;
let orphanSelection = new Set();
let catManagerOpen = false;
let studioTemplate = null; // plantilla de data.json (studio) — se carga de data/studio-snapshot.json

function makeEmptyState() {
  return {
    version: 2,
    categories: [...DEFAULT_CATEGORIES],
    projects: [],
    nav: defaultNav(),
    meta: { createdAt: new Date().toISOString(), lastGhFetch: null }
  };
}

function defaultNav() {
  return [
    { label: 'CV',            url: '/CVs/cast.pdf',   target: '_blank' },
    { label: 'CV2',           url: '/CVs/eng.pdf',    target: '_blank' },
    { label: 'portfolio',     url: 'https://www.figma.com/proto/jYLcGbiaKX2eT2hBY5OsXw/portfolio?page-id=0%3A1&type=design&node-id=1-2&viewport=464%2C100%2C0.08&t=wFIYHU81EJvHIpGv-1&scaling=contain&starting-point-node-id=1%3A2', target: '_blank' },
    { label: 'portfolio_old', url: 'https://meowrhino.cargo.site/portfolio_esp', target: '_blank' },
    { label: 'about me',      url: 'about.html',      target: '_blank' },
    { label: 'twitter',       url: 'https://twitter.com/meowrhino', target: '_blank' },
    { label: 'bsky',          url: 'https://bsky.app/profile/meowrhino.bsky.social', target: '_blank' },
    { label: 'instagram ',    url: 'https://www.instagram.com/meowrhino/', target: '_blank' },
    { label: 'email ',        url: 'mailto:manuellatourf@gmail.com', target: '_blank' },
    { label: 'paypal',        url: 'https://www.paypal.me/manuellatourf', target: '_blank' },
  ];
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !Array.isArray(s.projects)) return null;
    // migraciones suaves
    if (!s.categories) s.categories = [...DEFAULT_CATEGORIES];
    for (const p of s.projects) {
      p.links = p.links || [];
      if (!p.links.some(l => l.primary)) {
        const primIdx = p.links.findIndex(l => inferLinkType(l.url) === 'custom-domain');
        if (primIdx >= 0) p.links[primIdx].primary = true;
      }
      // migración: añadir nuevos flags de studio
      p.showIn = p.showIn || {};
      if (p.showIn.studioTools === undefined) p.showIn.studioTools = false;
      if (p.showIn.studioConvert === undefined) p.showIn.studioConvert = false;
      if (p.showIn.studioPortfolio === undefined) p.showIn.studioPortfolio = false;
      if (p.studioImage === undefined) p.studioImage = '';
      if (p.studioImageCount === undefined) p.studioImageCount = 0;
    }
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
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

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
    return 'custom-domain';
  } catch (_) { return 'unknown'; }
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
  const types = project.links.map(l => inferLinkType(l.url));
  const priority = ['custom-domain', 'github-pages', 'gitlab-pages', 'external', 'neocities-asset', 'local-page'];
  for (const t of priority) {
    if (types.includes(t)) return t === 'gitlab-pages' ? 'external' : t;
  }
  const known = types.find(t => t !== 'unknown' && t !== 'contact');
  return known || 'external';
}

/* -------------------- parser -------------------- */

function parseNeocitiesHtml(htmlString) {
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  const container = doc.querySelector('#proyectes') || doc.body;
  if (!container) throw new Error('No se encontró #proyectes.');

  const projects = [];
  const seenIds = new Set();
  let currentCategory = 'uncategorized';
  let cur = null;

  function flush() {
    if (!cur) return;
    if (!cur.links.length && !cur.name) { cur = null; return; }
    let base = (cur.name || 'p').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let id = base || 'p', i = 2;
    while (seenIds.has(id)) id = `${base}-${i++}`;
    seenIds.add(id);
    cur.id = id;
    cur.type = inferProjectType(cur);
    // primary: custom-domain link (si existe) es el principal; si no, el primer link
    const primIdx = cur.links.findIndex(l => inferLinkType(l.url) === 'custom-domain');
    if (primIdx >= 0) cur.links[primIdx].primary = true;
    const ghLink = cur.links.find(l => inferLinkType(l.url) === 'github-pages');
    if (ghLink) cur.ghRepo = ghRepoFromUrl(ghLink.url);
    projects.push(cur);
    cur = null;
  }

  for (const node of container.childNodes) {
    const isComment = node.nodeType === Node.COMMENT_NODE;
    const isElement = node.nodeType === Node.ELEMENT_NODE;

    if (isComment) {
      const text = node.textContent.trim();
      if (text) {
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
        showIn: {
          neocities: true,
          clouds: currentCategory !== 'hidden',
          archive: currentCategory !== 'hidden',
          studioTools: false,
          studioConvert: false,
          studioPortfolio: false,
        },
        studioImage: '',
        studioImageCount: 0,
        links: [],
        ghRepo: null,
        hiddenStyle: isHiddenStyle,
      };
      continue;
    }

    if (tag === 'a' && cur) {
      const href = node.getAttribute('href') || '';
      if (!href) continue;
      cur.links.push({
        label: (node.textContent || '').trim() || 'link',
        url: href,
        primary: false,
      });
      continue;
    }

    if (tag === 'sup' && cur) {
      cur.sup = (cur.sup ? cur.sup + ' ' : '') + (node.textContent || '').trim();
      continue;
    }
  }
  flush();

  for (const p of projects) {
    if (p.links.some(l => /_DEPRECATED\/?$/i.test(l.url)) || /deprecated/i.test(p.name)) p.status = 'deprecated';
    else if (p.links.some(l => /\bWIP\b/i.test(l.label))) p.status = 'wip';
    else if (p.links.some(l => /\balpha\b/i.test(l.label))) p.status = 'alpha';
    else if (p.links.some(l => /\bbeta\b/i.test(l.label))) p.status = 'beta';
    if (p.type === 'custom-domain') p.client = p.name;
  }

  return {
    version: 2,
    categories: [...DEFAULT_CATEGORIES],
    projects,
    nav: defaultNav(),
    meta: { createdAt: new Date().toISOString(), lastGhFetch: null, importedFrom: 'neocities-html' }
  };
}

/* -------------------- exporters -------------------- */

function sortedLinks(p) {
  // el link primary va primero. resto conserva orden.
  const out = [];
  const primary = p.links.find(l => l.primary);
  if (primary) out.push(primary);
  for (const l of p.links) if (!l.primary) out.push(l);
  return out;
}

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
  const linksHtml = sortedLinks(p).map(l =>
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
      links: sortedLinks(p).map(l => l.url),
    }));
  }
  return JSON.stringify(out, null, 2);
}

function exportStudioJson() {
  if (!studioTemplate) {
    return '// el template data/studio-snapshot.json no se ha cargado.\n// dale a "auto-cargar" en inicio, o importa manualmente.';
  }
  // deep clone el template
  const out = JSON.parse(JSON.stringify(studioTemplate));

  // tools.herramientas
  const herramientas = state.projects
    .filter(p => p.showIn?.studioTools && !p.hidden)
    .map(p => ({
      nombre: p.name,
      url: (p.links.find(l => l.primary) || p.links[0] || {}).url || '',
    }));
  out.tools = out.tools || {};
  out.tools.herramientas = herramientas;

  // tools.conversores
  const conversores = state.projects
    .filter(p => p.showIn?.studioConvert && !p.hidden)
    .map(p => ({
      nombre: p.name,
      url: (p.links.find(l => l.primary) || p.links[0] || {}).url || '',
    }));
  out.tools.conversores = conversores;

  // portfolio.proyectos
  const portfolio = state.projects
    .filter(p => p.showIn?.studioPortfolio && !p.hidden)
    .map(p => {
      // si el proyecto tiene varios dominios/urls custom, los incluimos como `urls`
      const customs = p.links.filter(l => inferLinkType(l.url) === 'custom-domain');
      const base = {
        nombre: p.name,
        imagen: p.studioImage || '',
        imagenesSecundarias: Number(p.studioImageCount) || 0,
      };
      if (customs.length >= 2) {
        base.urls = customs.map(l => ({ nombre: l.label || p.name, url: l.url }));
      } else {
        base.url = (customs[0] || p.links.find(l => l.primary) || p.links[0] || {}).url || '';
      }
      return base;
    });
  out.portfolio = out.portfolio || {};
  out.portfolio.proyectos = portfolio;

  return JSON.stringify(out, null, 2);
}

function exportArchiveJson() {
  const out = {
    welcome: { titulo: 'meowrhino archive', studioUrl: 'index.html' }
  };
  for (const cat of state.categories) {
    const key = ARCHIVE_CAT_MAP[cat] || cat.replace(/\s+/g, '');
    const items = state.projects
      .filter(p => p.category === cat && p.showIn?.archive !== false && !p.hidden);
    if (!items.length) continue;
    const links = sortedLinks;
    out[key] = items.map(p => {
      const ls = sortedLinks(p);
      if (ls.length === 1) return { nombre: p.name, url: ls[0].url };
      return { nombre: p.name, links: ls.map(l => ({ label: l.label || 'link', url: l.url })) };
    });
  }
  return JSON.stringify(out, null, 2);
}

/* -------------------- tabs -------------------- */

function setupTabs() {
  for (const btn of $$('.tab-btn')) {
    btn.addEventListener('click', () => goTab(btn.dataset.tab));
  }
  for (const btn of $$('.export-tab-btn')) {
    btn.addEventListener('click', () => {
      currentExportTab = btn.dataset.etab;
      $$('.export-tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      regenExport();
    });
  }
}
function goTab(name) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${name}`));
  if (name === 'projects') renderProjects();
  if (name === 'auditor') renderAuditor();
  if (name === 'health') renderHealth();
  if (name === 'export') regenExport();
}

/* -------------------- dashboard -------------------- */

function updateStatusLine() {
  const total = state.projects.length;
  const last = state.meta?.lastGhFetch ? ` · github: ${new Date(state.meta.lastGhFetch).toLocaleString()}` : '';
  $('#status-line').textContent = `${total} proyectos${last}`;
}

function updateDashboard() {
  const projs = state.projects;
  $('#stat-total').textContent = projs.length;
  $('#stat-gh').textContent = projs.filter(p => p.type === 'github-pages').length;
  $('#stat-custom').textContent = projs.filter(p => p.type === 'custom-domain' || p.links.some(l => inferLinkType(l.url) === 'custom-domain')).length;
  $('#stat-external').textContent = projs.filter(p => p.type === 'external').length;
  $('#stat-hidden').textContent = projs.filter(p => p.hidden || p.category === 'hidden').length;

  if (ghRepos.length) {
    $('#stat-orphans').textContent = computeOrphans().length;
    $('#stat-dead').textContent = computeDeadRepos().length;
  } else {
    $('#stat-orphans').textContent = '—';
    $('#stat-dead').textContent = '—';
  }

  const cats = $('#cat-overview');
  cats.innerHTML = '';
  for (const cat of state.categories) {
    const n = projs.filter(p => p.category === cat).length;
    cats.appendChild(el('div', { class: 'cat-card' },
      el('b', {}, cat),
      el('span', {}, `${n} proyectos`)
    ));
  }

  const sel = $('#proj-filter-cat');
  if (sel) {
    const current = sel.value;
    sel.innerHTML = '<option value="">todas las categorías</option>';
    for (const cat of state.categories) sel.appendChild(el('option', { value: cat }, cat));
    sel.value = current;
  }

  $('#seed-prompt').hidden = projs.length > 0;
}

/* -------------------- proyectos: render -------------------- */

function renderProjects() {
  const q = $('#proj-search').value.toLowerCase().trim();
  const fcat = $('#proj-filter-cat').value;
  const ftype = $('#proj-filter-type').value;
  const fstatus = $('#proj-filter-status').value;

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
      el('b', {}, '// ' + cat),
      el('span', {}, `${items.length} / ${(byCat[cat] || []).length}`),
      el('div', { class: 'cat-reorder' },
        el('button', { title: 'mover categoría arriba', onclick: () => moveCategory(cat, -1) }, '↑'),
        el('button', { title: 'mover categoría abajo', onclick: () => moveCategory(cat, +1) }, '↓'),
      )
    );
    group.appendChild(header);

    for (const p of items) group.appendChild(renderProjectRow(p));
    root.appendChild(group);
  }

  if (!root.children.length) {
    root.appendChild(el('div', { style: 'color: rgba(255,255,255,0.5); padding: 20px; text-align: center;' }, 'sin resultados con estos filtros.'));
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

  // name block (ainfo-style)
  const nameBlock = el('div', { class: 'p-name-block' });
  const primary = p.links.find(l => l.primary);
  const nameEl = primary
    ? el('a', { class: 'p-name' + (p.highlight ? ' highlight' : ''), href: primary.url, target: '_blank', rel: 'noopener' }, p.name)
    : el('span', { class: 'p-name' + (p.highlight ? ' highlight' : '') }, p.name);
  nameBlock.appendChild(nameEl);
  if (p.sup) nameBlock.appendChild(el('span', { class: 'p-name-sup' }, p.sup));
  nameBlock.appendChild(el('div', { class: 'p-meta' }, `${p.type} · ${p.status}${p.client ? ' · ' + p.client : ''}`));
  row.appendChild(nameBlock);

  // links (neocities-style: [label] text)
  const linksBox = el('div', { class: 'p-links' });
  for (const l of sortedLinks(p)) {
    const cls = 'p-link'
      + (l.primary ? ' primary' : '')
      + (healthCache[l.url] === 'ok' ? ' ok' : (healthCache[l.url] === 'err' ? ' broken' : ''));
    linksBox.appendChild(el('a', { class: cls, href: l.url, target: '_blank', rel: 'noopener' },
      el('span', { class: 'lbl' }, `[${l.label}]`), ' ', truncate(l.url.replace(/^https?:\/\//, ''), 38)
    ));
  }
  row.appendChild(linksBox);

  row.appendChild(el('div', { class: 'p-actions' },
    el('button', { onclick: () => { editingId = p.id; renderProjects(); } }, 'editar'),
    el('button', { onclick: () => toggleHidden(p.id) }, (p.hidden ? 'mostrar' : 'esconder')),
    el('button', { onclick: () => deleteProject(p.id) }, 'borrar')
  ));

  wireDragRow(row);
  return row;
}

function renderProjectEdit(p) {
  const box = el('div', { class: 'project-edit', dataset: { id: p.id } });

  const makeInput = (label, val, kind = 'text', opts = null) => {
    let input;
    if (kind === 'select') {
      input = el('select', {}, ...opts.map(o => el('option', { value: o, selected: val === o }, o)));
    } else if (kind === 'textarea') {
      input = el('textarea', {}, val || '');
    } else {
      input = el('input', { type: 'text', value: val || '' });
    }
    return { lbl: el('label', {}, el('span', {}, label), input), input };
  };

  const f = {};
  f.name     = makeInput('nombre', p.name);
  f.id       = makeInput('slug (id)', p.id);
  f.category = makeInput('categoría', p.category, 'select', state.categories);
  f.type     = makeInput('tipo', p.type, 'select', ['github-pages','custom-domain','external','neocities-asset','local-page']);
  f.status   = makeInput('estado', p.status, 'select', ['live','wip','alpha','beta','deprecated']);
  f.client   = makeInput('cliente', p.client);
  f.ghRepo   = makeInput('repo de github', p.ghRepo || '');
  f.sup      = makeInput('nota pequeña (sup)', p.sup || '');
  f.notes    = makeInput('notas', p.notes || '', 'textarea');

  for (const k of ['name','id','category','type','status','client','ghRepo','sup']) box.appendChild(f[k].lbl);
  f.notes.lbl.classList.add('full'); box.appendChild(f.notes.lbl);

  // flags
  const chkbox = (label, checked) => {
    const inp = el('input', { type: 'checkbox' });
    if (checked) inp.checked = true;
    return { lbl: el('label', { class: 'chk' }, inp, el('span', {}, label)), input: inp };
  };
  f.highlight = chkbox('destacar (amarillo)', p.highlight);
  f.hidden    = chkbox('esconder de listas', p.hidden);
  f.siNeo     = chkbox('publicar en neocities', p.showIn?.neocities !== false);
  f.siCloud   = chkbox('publicar en clouds', p.showIn?.clouds !== false);
  f.siArch    = chkbox('publicar en archive', p.showIn?.archive !== false);
  f.siStTool  = chkbox('studio · tools (herramientas)', !!p.showIn?.studioTools);
  f.siStConv  = chkbox('studio · tools (conversores)', !!p.showIn?.studioConvert);
  f.siStPort  = chkbox('studio · portfolio', !!p.showIn?.studioPortfolio);
  box.appendChild(el('div', { class: 'full row' }, f.highlight.lbl, f.hidden.lbl, f.siNeo.lbl, f.siCloud.lbl, f.siArch.lbl));
  box.appendChild(el('div', { class: 'full row' }, f.siStTool.lbl, f.siStConv.lbl, f.siStPort.lbl));

  // campos específicos de studio portfolio
  f.stImg     = makeInput('studio portfolio · imagen (ej. img/slug/1.webp)', p.studioImage || '');
  f.stImgN    = makeInput('studio portfolio · nº imágenes secundarias', String(p.studioImageCount || 0));
  const stBox = el('div', { class: 'full row' }, f.stImg.lbl, f.stImgN.lbl);
  f.stImg.lbl.style.flex = '2';
  f.stImgN.lbl.style.flex = '1';
  box.appendChild(stBox);

  // links editor
  const linksBox = el('div', { class: 'full links-editor' });
  linksBox.appendChild(el('b', {}, 'enlaces (★ = principal · si el principal cae, se muestra el siguiente)'));
  const links = p.links.map(l => ({ ...l }));
  function setPrimary(i) {
    for (let j = 0; j < links.length; j++) links[j].primary = (j === i);
    syncLinks(); redrawLinks();
  }
  function redrawLinks() {
    $$('.link-row', linksBox).forEach(n => n.remove());
    links.forEach((l, i) => {
      const star = el('span', { class: 'primary-chk' + (l.primary ? ' active' : ''), title: 'marcar como principal', onclick: () => setPrimary(i) }, l.primary ? '★' : '☆');
      const labelInp = el('input', { type: 'text', value: l.label || '', placeholder: 'etiqueta' });
      const urlInp = el('input', { type: 'text', value: l.url || '', placeholder: 'url' });
      const up = el('button', { onclick: () => { if (i > 0) { [links[i-1], links[i]] = [links[i], links[i-1]]; syncLinks(); redrawLinks(); } } }, '↑');
      const dn = el('button', { onclick: () => { if (i < links.length - 1) { [links[i+1], links[i]] = [links[i], links[i+1]]; syncLinks(); redrawLinks(); } } }, '↓');
      const del = el('button', { onclick: () => { links.splice(i, 1); syncLinks(); redrawLinks(); } }, '×');
      labelInp.addEventListener('input', () => { l.label = labelInp.value; syncLinks(); });
      urlInp.addEventListener('input', () => { l.url = urlInp.value; syncLinks(); });
      const row = el('div', { class: 'link-row' });
      row.appendChild(el('div', {}, labelInp));
      row.appendChild(el('div', {}, urlInp));
      row.appendChild(star);
      row.appendChild(el('div', { class: 'row', style: 'grid-column: span 2' }, up, dn, del));
      // ajustamos las columnas para que queden label | url | star | botones
      row.style.gridTemplateColumns = '100px 1fr 24px auto';
      linksBox.appendChild(row);
    });
  }
  function syncLinks() { p.links = links.slice(); }
  redrawLinks();
  const addLink = el('button', { onclick: () => { links.push({ label: 'link', url: '', primary: false }); syncLinks(); redrawLinks(); } }, '+ añadir enlace');
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
      studioTools: f.siStTool.input.checked,
      studioConvert: f.siStConv.input.checked,
      studioPortfolio: f.siStPort.input.checked,
    };
    p.studioImage = f.stImg.input.value.trim();
    p.studioImageCount = parseInt(f.stImgN.input.value, 10) || 0;
    p.links = links.filter(l => l.url.trim());
    if (!p.links.some(l => l.primary) && p.links.length) p.links[0].primary = true;
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
    showIn: { neocities: true, clouds: true, archive: true, studioTools: false, studioConvert: false, studioPortfolio: false },
    studioImage: '',
    studioImageCount: 0,
    links: [{ label: 'link', url: '', primary: true }],
    ghRepo: null,
    hiddenStyle: false,
  };
  state.projects.unshift(p);
  editingId = p.id;
  saveState();
  renderProjects();
  // scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* -------------------- categorías CRUD -------------------- */

function toggleCatManager() {
  catManagerOpen = !catManagerOpen;
  renderCatManager();
}

function renderCatManager() {
  const root = $('#cat-manager');
  root.hidden = !catManagerOpen;
  if (!catManagerOpen) return;
  root.innerHTML = '';
  root.appendChild(el('h2', {}, 'gestionar categorías'));
  root.appendChild(el('p', { class: 'subtle' }, 'puedes renombrar, reordenar, añadir o borrar categorías. si borras una que tiene proyectos, te pedirá confirmar y moverá los proyectos a "misc".'));

  state.categories.forEach((cat, i) => {
    const count = state.projects.filter(p => p.category === cat).length;
    const input = el('input', { type: 'text', value: cat });
    const row = el('div', { class: 'cat-row' },
      el('span', {}, `${i + 1}.`),
      input,
      el('span', { class: 'subtle' }, `${count} proyectos`),
      el('button', { onclick: () => moveCategory(cat, -1) }, '↑'),
      el('button', { onclick: () => moveCategory(cat, +1) }, '↓'),
      el('button', { onclick: () => {
        const newName = input.value.trim();
        if (!newName || newName === cat) return;
        if (state.categories.includes(newName)) { alert('ya existe esa categoría'); return; }
        renameCategory(cat, newName);
      } }, 'renombrar'),
    );
    row.appendChild(el('button', { onclick: () => deleteCategory(cat) }, 'borrar'));
    root.appendChild(row);
  });

  // añadir
  const newInp = el('input', { type: 'text', placeholder: 'nombre de la nueva categoría' });
  const addBtn = el('button', { onclick: () => {
    const name = newInp.value.trim();
    if (!name) return;
    if (state.categories.includes(name)) { alert('ya existe'); return; }
    state.categories.push(name);
    saveState();
    renderCatManager();
    renderProjects();
  } }, '+ añadir categoría');
  root.appendChild(el('div', { class: 'row' }, newInp, addBtn));
}

function moveCategory(cat, delta) {
  const i = state.categories.indexOf(cat);
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= state.categories.length) return;
  [state.categories[i], state.categories[j]] = [state.categories[j], state.categories[i]];
  saveState();
  renderProjects();
  if (catManagerOpen) renderCatManager();
}

function renameCategory(oldName, newName) {
  const i = state.categories.indexOf(oldName);
  if (i < 0) return;
  state.categories[i] = newName;
  for (const p of state.projects) if (p.category === oldName) p.category = newName;
  saveState();
  renderCatManager();
  renderProjects();
}

function deleteCategory(cat) {
  const count = state.projects.filter(p => p.category === cat).length;
  const msg = count > 0
    ? `hay ${count} proyectos en "${cat}". se moverán a "misc". ¿continuar?`
    : `borrar "${cat}"?`;
  if (!confirm(msg)) return;
  for (const p of state.projects) if (p.category === cat) p.category = 'misc';
  state.categories = state.categories.filter(c => c !== cat);
  if (!state.categories.includes('misc')) state.categories.push('misc');
  saveState();
  renderCatManager();
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
  const target = state.projects[to > from ? to - 1 : to];
  if (target) moved.category = target.category;
  let newIdx = state.projects.findIndex(p => p.id === toId);
  if (!before) newIdx += 1;
  state.projects.splice(newIdx, 0, moved);
  saveState();
  renderProjects();
}

/* -------------------- auditor -------------------- */

async function fetchGh() {
  const statusEl = $('#gh-status');
  statusEl.textContent = 'cargando…';
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
    statusEl.textContent = 'error: ' + e.message;
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
  $('#rule-forks').checked = rules.forks;
  $('#rule-archived').checked = rules.archived;
  $('#rule-deprecated').checked = rules.deprecated;
  $('#rule-test').checked = rules.test;
  $('#rule-whitelist').value = rules.whitelist || '';

  const orphansEl = $('#orphans-list');
  orphansEl.innerHTML = '';
  $('#deadrepos-list').innerHTML = '';

  if (!ghRepos.length) {
    orphansEl.appendChild(el('p', {}, 'pulsa "traer repos de github" para empezar.'));
    $('#orphan-count').textContent = '0';
    $('#dead-count').textContent = '0';
    $('#orphan-batch-bar').hidden = true;
    return;
  }

  const orphans = computeOrphans();
  $('#orphan-count').textContent = orphans.length;
  if (!orphans.length) {
    orphansEl.appendChild(el('p', {}, '🎉 todos los repos están listados.'));
  }

  renderOrphanBatchBar(orphans);

  for (const repo of orphans) {
    const selected = orphanSelection.has(repo.name);
    const chk = el('input', { type: 'checkbox' });
    if (selected) chk.checked = true;
    chk.addEventListener('change', () => {
      if (chk.checked) orphanSelection.add(repo.name);
      else orphanSelection.delete(repo.name);
      renderOrphanBatchBar(orphans);
    });

    const row = el('div', { class: 'orphan-row' });
    row.appendChild(chk);
    row.appendChild(el('div', {},
      el('div', { class: 'repo-name' }, repo.name),
      el('div', { class: 'meta' },
        (repo.fork ? 'fork · ' : '') +
        (repo.archived ? 'archivado · ' : '') +
        (repo.language || '—') + ' · ★' + (repo.stargazers_count || 0)
      )
    ));
    row.appendChild(el('div', {},
      el('a', { href: repo.html_url, target: '_blank' }, repo.html_url),
      el('div', { class: 'meta' }, repo.description || '')
    ));
    const catSel = el('select', {}, ...state.categories.map(c => el('option', { value: c }, c)));
    catSel.value = guessCategoryForRepo(repo);
    row.appendChild(catSel);
    row.appendChild(el('div', { class: 'row' },
      el('button', { onclick: () => { addProjectFromRepo(repo, catSel.value); orphanSelection.delete(repo.name); renderAuditor(); } }, '+ añadir'),
      el('button', { onclick: () => { addWhitelist(repo.name); orphanSelection.delete(repo.name); } }, 'ignorar')
    ));
    orphansEl.appendChild(row);
  }

  const dead = computeDeadRepos();
  $('#dead-count').textContent = dead.length;
  const deadEl = $('#deadrepos-list');
  if (!dead.length) deadEl.appendChild(el('p', {}, 'ningún enlace apunta a un repo que ya no existe.'));
  for (const d of dead) {
    const row = el('div', { class: 'orphan-row' });
    row.appendChild(el('div', {}));
    row.appendChild(el('div', {},
      el('div', { class: 'repo-name' }, d.project.name),
      el('div', { class: 'meta' }, `${d.project.category} · slug: ${d.project.id}`)
    ));
    row.appendChild(el('div', { class: 'meta' }, d.url));
    row.appendChild(el('div', { class: 'meta' }, 'repo: ' + d.repo));
    row.appendChild(el('div', { class: 'row' },
      el('button', { onclick: () => { editingId = d.project.id; goTab('projects'); } }, 'editar')
    ));
    deadEl.appendChild(row);
  }
}

function renderOrphanBatchBar(orphans) {
  const bar = $('#orphan-batch-bar');
  const n = orphanSelection.size;
  bar.hidden = n === 0;
  if (!n) return;
  $('#orphan-selected-count').textContent = `${n} seleccionado${n !== 1 ? 's' : ''}`;

  // target project dropdown
  const target = $('#orphan-batch-target');
  const cur = target.value || '__new__';
  target.innerHTML = '<option value="__new__">crear proyecto nuevo</option>';
  const sorted = [...state.projects].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of sorted) {
    target.appendChild(el('option', { value: p.id }, `→ añadir enlaces a: ${p.name} (${p.category})`));
  }
  target.value = sorted.find(p => p.id === cur) ? cur : '__new__';

  const catSel = $('#orphan-batch-cat');
  catSel.innerHTML = '';
  for (const c of state.categories) catSel.appendChild(el('option', { value: c }, c));
  const guessed = guessCategoryForRepo({ name: [...orphanSelection][0] || '' });
  catSel.value = guessed;

  const nameInp = $('#orphan-batch-name');
  if (!nameInp.value) nameInp.value = [...orphanSelection][0] || '';
}

function applyOrphanBatch() {
  if (!orphanSelection.size) return;
  const target = $('#orphan-batch-target').value;
  const reposSelected = [...orphanSelection].map(n => ghRepos.find(r => r.name === n)).filter(Boolean);

  if (target === '__new__') {
    const name = $('#orphan-batch-name').value.trim() || reposSelected[0].name;
    const cat = $('#orphan-batch-cat').value;
    const links = reposSelected.map((r, i) => ({
      label: reposSelected.length > 1 ? `v${reposSelected.length - i}` : 'link',
      url: `https://meowrhino.github.io/${r.name}/`,
      primary: i === 0,
    }));
    const p = {
      id: uid(name),
      name,
      highlight: false,
      category: cat,
      type: 'github-pages',
      subtype: '',
      status: 'live',
      client: '',
      hidden: false,
      notes: reposSelected.map(r => `${r.name}: ${r.description || ''}`).filter(Boolean).join('\n'),
      sup: '',
      showIn: { neocities: true, clouds: true, archive: true },
      links,
      ghRepo: reposSelected[0].name,
      hiddenStyle: false,
    };
    state.projects.push(p);
    toast(`creado "${name}" con ${reposSelected.length} enlaces`);
  } else {
    const p = state.projects.find(x => x.id === target);
    if (!p) return;
    for (const r of reposSelected) {
      // label: v1, v2, v3 automáticamente si hay más de uno
      const versionLabel = /^v\d+$/i.test(r.name.replace(p.name, '').replace(/[^\w]/g, ''))
        ? r.name.replace(p.name, '').replace(/[^\w]/g, '').toLowerCase()
        : r.name;
      p.links.push({ label: versionLabel || 'link', url: `https://meowrhino.github.io/${r.name}/`, primary: false });
    }
    toast(`añadidos ${reposSelected.length} enlaces a "${p.name}"`);
  }

  orphanSelection.clear();
  saveState();
  renderAuditor();
}

function ignoreOrphanBatch() {
  const names = [...orphanSelection];
  const wl = (rules.whitelist || '').split(',').map(s => s.trim()).filter(Boolean);
  for (const n of names) if (!wl.includes(n)) wl.push(n);
  rules.whitelist = wl.join(', ');
  saveJSON(LS_RULES, rules);
  $('#rule-whitelist').value = rules.whitelist;
  orphanSelection.clear();
  renderAuditor();
  toast(`ignorados ${names.length}`);
}

function guessCategoryForRepo(repo) {
  const n = (repo.name || '').toLowerCase();
  if (!n) return state.categories[0] || 'misc';
  if (/_deprecated$/i.test(n)) return 'unfinished apps';
  if (/^notas/.test(n) || n === 'hopeko' || n === 'hopeko2' || n === 'somnis' || n === 'historias') return 'texts';
  if (/(chat|piuler|messagepark)/.test(n)) return 'social apps';
  if (/(cards|minesweeper|rockpaper|lettersoup|horselife|gameoflife|5cards)/.test(n)) return 'games';
  if (/(calc|generator|convert|converter|img|video|fcyp|checker|setup|trackr|navicon|tarifa|etymodict|writingapp|faqautonomos|encuesta|colorfun)/.test(n)) return 'tools';
  if (/test|safeamorx|plantitas|latrini|linktree|tinnitus|ableme|oca|tem|directorio|registro|quests|receptes|taxrhino|txttohtml|paintonline|pdfs|grid-web|xordxs|tarifas/.test(n)) return 'unfinished apps';
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
    showIn: { neocities: true, clouds: true, archive: true, studioTools: false, studioConvert: false, studioPortfolio: false },
    studioImage: '',
    studioImageCount: 0,
    links: [{ label: 'link', url: `https://meowrhino.github.io/${repo.name}/`, primary: true }],
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

/* -------------------- health -------------------- */

function renderHealth() {
  const root = $('#health-list');
  root.innerHTML = '';
  const urls = collectUrls();
  for (const u of urls) {
    const status = healthCache[u.url] || 'unknown';
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
  try {
    await fetch(url, { method: 'GET', mode: 'no-cors', cache: 'no-store' });
    return 'ok';
  } catch (_) { return 'err'; }
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
  statusEl.textContent = `listo · ${urls.length} chequeos`;
}

/* -------------------- export -------------------- */

function regenExport() {
  let out = '';
  let help = '';
  if (currentExportTab === 'neocities') { out = exportNeocitiesHtml(); help = 'pega el contenido entero en el editor del neocities y dale a save.'; }
  else if (currentExportTab === 'clouds') { out = exportCloudsJson(); help = 'sobreescribe clouds/proyectos.json (o deja que la GH Action lo haga cada semana).'; }
  else if (currentExportTab === 'archive') { out = exportArchiveJson(); help = 'sobreescribe becasDigMeow/archive-data.json.'; }
  else if (currentExportTab === 'studio')  { out = exportStudioJson();  help = 'sobreescribe becasDigMeow/data.json. preserva cupon, statement, metodología, políticas, contacto.'; }
  $('#export-output').textContent = out;
  const h = $('#export-help'); if (h) h.textContent = help;
}

async function copyExport() {
  try {
    await navigator.clipboard.writeText($('#export-output').textContent);
    toast('copiado');
  } catch (_) { toast('no se pudo copiar · selecciona y copia manual'); }
}

function downloadExport() {
  const content = $('#export-output').textContent;
  const name = currentExportTab === 'neocities' ? 'index.html'
    : currentExportTab === 'clouds' ? 'proyectos.json'
    : currentExportTab === 'archive' ? 'archive-data.json'
    : 'data.json';
  const type = currentExportTab === 'neocities' ? 'text/html' : 'application/json';
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}

/* -------------------- master JSON import/export -------------------- */

function exportMasterJson() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `master-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
}

function triggerImport() { $('#file-input').click(); }

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
      toast('datos importados');
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

async function loadStudioTemplate() {
  try {
    const r = await fetch('data/studio-snapshot.json', { cache: 'no-store' });
    if (!r.ok) return;
    studioTemplate = await r.json();
  } catch (_) { /* ignore */ }
}

function mergeStudioFlags() {
  if (!studioTemplate) return 0;
  let hits = 0;
  const byUrl = new Map(); // url.toLowerCase() → {section, entry}
  const add = (section, entry, url) => {
    if (!url) return;
    byUrl.set(String(url).toLowerCase(), { section, entry });
  };
  for (const e of studioTemplate.tools?.herramientas || []) add('studioTools', e, e.url);
  for (const e of studioTemplate.tools?.conversores || []) add('studioConvert', e, e.url);
  for (const e of studioTemplate.portfolio?.proyectos || []) {
    if (e.url) add('studioPortfolio', e, e.url);
    if (Array.isArray(e.urls)) for (const u of e.urls) add('studioPortfolio', e, u.url);
  }
  for (const p of state.projects) {
    for (const l of p.links) {
      const key = String(l.url).toLowerCase();
      if (byUrl.has(key)) {
        const { section, entry } = byUrl.get(key);
        p.showIn[section] = true;
        if (section === 'studioPortfolio' && entry.imagen && !p.studioImage) {
          p.studioImage = entry.imagen;
          p.studioImageCount = Number(entry.imagenesSecundarias) || 0;
        }
        hits++;
      }
    }
  }
  return hits;
}

async function tryFetchSeed() {
  // template de studio primero (para poder mergear después)
  await loadStudioTemplate();

  try {
    const r = await fetch('data/seed.json', { cache: 'no-store' });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data.projects)) {
        state = data;
        saveState();
        updateDashboard();
        renderProjects();
        toast('datos cargados');
        return;
      }
    }
  } catch (_) { /* ignore */ }
  try {
    const r = await fetch('data/neocities-snapshot.html', { cache: 'no-store' });
    if (!r.ok) throw new Error('no snapshot');
    const html = await r.text();
    const s = parseNeocitiesHtml(html);
    state = s;
    const hits = mergeStudioFlags();
    saveState();
    updateDashboard();
    renderProjects();
    toast(`${s.projects.length} proyectos · ${hits} vinculados a studio`);
  } catch (e) {
    toast('pega el HTML del neocities o importa un .json');
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
  } catch (e) { alert('error: ' + e.message); }
}

/* -------------------- init -------------------- */

function init() {
  setTheme(localStorage.getItem(LS_THEME) || 'dark');
  setupTabs();
  updateStatusLine();
  updateDashboard();
  wireAuditorRules();
  // template de studio en background (aunque ya haya state)
  loadStudioTemplate();

  $('#btn-parse-html').addEventListener('click', parseHtmlFromTextarea);
  $('#btn-fetch-seed').addEventListener('click', tryFetchSeed);
  $('#btn-empty').addEventListener('click', () => { state = makeEmptyState(); saveState(); updateDashboard(); toast('listo'); });

  ['proj-search','proj-filter-cat','proj-filter-type','proj-filter-status']
    .forEach(id => $('#'+id).addEventListener('input', renderProjects));
  $('#btn-new-project').addEventListener('click', newProject);
  $('#btn-manage-cats').addEventListener('click', toggleCatManager);

  $('#btn-fetch-gh').addEventListener('click', fetchGh);
  $('#btn-orphan-batch-add').addEventListener('click', applyOrphanBatch);
  $('#btn-orphan-batch-ignore').addEventListener('click', ignoreOrphanBatch);

  $('#btn-check-all').addEventListener('click', () => checkAll(false));
  $('#btn-check-custom').addEventListener('click', () => checkAll(true));

  $('#btn-regen').addEventListener('click', regenExport);
  $('#btn-copy').addEventListener('click', copyExport);
  $('#btn-download').addEventListener('click', downloadExport);

  $('#btn-import').addEventListener('click', triggerImport);
  $('#btn-export-json').addEventListener('click', exportMasterJson);
  $('#file-input').addEventListener('change', (e) => {
    if (e.target.files?.[0]) handleImportFile(e.target.files[0]);
    e.target.value = '';
  });

  $('#btn-theme').addEventListener('click', toggleTheme);

  if (!state.projects.length) tryFetchSeed();
}

document.addEventListener('DOMContentLoaded', init);
