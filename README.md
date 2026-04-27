# neocitiesUpdater

Tool single-page para mantener sincronizados los 4 sitios de meowrhino donde aparece la lista de proyectos.

```
github.com/meowrhino  ←(API)─┐
                              ├──→  master JSON  ──┬──→  neocities/index.html
data/*-snapshot.*  ─(seed)───┘   (localStorage)    ├──→  clouds/proyectos.json
                                                    ├──→  archive-data.json
                                                    └──→  studio/data.json
```

## Por qué existe

Un dev solo (meowrhino) que mantiene 4 sitios distintos con la misma lista de proyectos:

- **`meowrhino.neocities.org`** — portal histórico, hand-coded HTML
- **`meowrhino.github.io/clouds`** — la misma lista renderizada como nubes
- **`meowrhino.studio`** — landing del studio (con cupon, statement, portfolio)
- **`meowrhino.studio/archive`** — archive, pensado a largo plazo como sustituto del neocities

Cada vez que crea un proyecto nuevo, antes había que añadirlo a 4 sitios distintos a mano. Esto centraliza el mantenimiento: editas una vez, exportas a los 4.

## Stack

- HTML + CSS + JavaScript vanilla
- Sin framework, sin bundler, sin build step
- Persistencia: `localStorage`
- Backend: ninguno (la GH API se llama desde el cliente, sin auth, dentro del rate limit de 60 req/h)

## Cómo arrancarlo

Cualquiera de estas opciones funciona:

```bash
# opción 1 — python (lo más simple)
cd neocitiesUpdater && python3 -m http.server 5500

# opción 2 — Live Server de VSCode (botón "Go Live")

# opción 3 — abrir index.html directo (limitado: file:// no puede fetch los snapshots)

# opción 4 — GitHub Pages
# Settings → Pages → main branch → publica en meowrhino.github.io/neocitiesUpdater/
```

Y luego abrir `http://localhost:5500/`.

La primera vez detecta que `localStorage` está vacío y auto-carga `data/neocities-snapshot.html` parseándolo. También cruza los datos con `data/studio-snapshot.json` para vincular automáticamente los proyectos que ya están en `meowrhino.studio`.

## Las 5 pestañas

| pestaña | qué hace |
|---|---|
| **inicio** | dashboard con contadores, lista de categorías y ayuda |
| **proyectos** | lista editable estilo neocities. drag&drop para reordenar, multi-select para acciones en bloque (fusionar, mover, esconder, borrar) |
| **revisar github** | fetchea los repos de `github.com/meowrhino`, lista los que no están en el JSON ("me faltan por añadir") y los links que apuntan a repos que ya no existen |
| **chequear enlaces** | pinga todos los URLs y marca cuáles responden — útil para detectar dominios de cliente caídos |
| **publicar** | regenera los 4 outputs listos para copiar y pegar |

## El JSON canónico

Vive en `localStorage` bajo la key `neocitiesUpdater.v1`. Es la fuente única de verdad. Estructura:

```jsonc
{
  "version": 2,
  "categories": ["main quests", "side quests", "WIP", ...],
  "projects": [
    {
      "id": "rikamichie",
      "name": "rikamichie",
      "highlight": false,                // amarillo destacado en neocities
      "category": "side quests",
      "type": "custom-domain",           // github-pages | custom-domain | external | neocities-asset | local-page
      "status": "live",                  // live | wip | alpha | beta | deprecated
      "client": "rikamichie",
      "hidden": false,                   // true = no sale en NINGÚN output
      "notes": "",
      "sup": "",                         // nota pequeña <sup>
      "ghRepo": "rikamichie",            // nombre del repo en github.com/meowrhino
      "hiddenStyle": false,              // estilo "color:black; cursor:default" preservado del neocities
      "showIn": {
        "neocities": true,
        "clouds": true,
        "archive": true,
        "studioTools": false,            // data.json → tools.herramientas
        "studioConvert": false,          // data.json → tools.conversores
        "studioPortfolio": true          // data.json → portfolio.proyectos
      },
      "studioImage": "img/rikamichie/1.webp",  // relativo a becasDigMeow
      "studioImageCount": 2,                   // imagenesSecundarias del portfolio
      "links": [
        { "label": "web",  "url": "https://rikamichie.com",                 "primary": true  },
        { "label": "repo", "url": "https://meowrhino.github.io/rikamichie/", "primary": false }
      ]
    }
  ],
  "nav": [ /* enlaces del header del neocities */ ],
  "meta": { "createdAt": "...", "lastGhFetch": "..." }
}
```

**Tipos de proyecto** (`type`): `github-pages`, `custom-domain`, `external` (gitlab, mega, figma, indiexpo, blogspot…), `neocities-asset` (PDFs/imágenes en el propio neocities), `local-page` (`barcelona.html`, `lafesta.html`).

**Estados** (`status`): `live`, `wip`, `alpha`, `beta`, `deprecated`.

**Flag `primary`** en un link: indica que ese es el principal. En los outputs se lista primero. Para clientes con dominio propio, el dominio es el primary; las versiones GitHub Pages quedan como backup visible.

## Flow típico — añadir un nuevo cliente con dominio

1. **revisar github** → `traer repos de github` → checkbox del nuevo repo (o varios si hay versiones `valentin`, `valentin2`, `valentin3`) → `añadir`. Crea el proyecto con todas las versiones como links etiquetados `[v3] [v2] [v1]`.
2. **proyectos** → `editar` → checkbox **studio · portfolio**. Auto-rellena `studioImage` con `img/${slug}/1.webp`.
3. Cuando llegue el dominio: edit → `+ añadir enlace` → `[web] cliente.com` → click ★ para marcarlo como principal.
4. **publicar** → 4 tabs con los outputs listos para copiar y pegar.

Para casos donde varios "clientes" comparten dominio (`mokakopa` + `ana lópez serrano` → `mokakopaTwins`), selecciona los proyectos con los checkboxes y dale a **fusionar** en la barra amarilla. El studio exporter detecta automáticamente cuando un proyecto tiene 2+ links de tipo custom-domain y lo exporta como `{nombre, urls: [{nombre, url}, ...]}`.

## Presets de proyecto nuevo

Botón `+ nuevo proyecto` abre un selector con presets que pre-rellenan categoría y flags:

- **cliente** (web a medida con dominio propio) → side quests + studio portfolio
- **cliente · en proceso** (sin dominio aún) → WIP
- **tool / utilidad** → tools + studio tools
- **tool · conversor** → tools + studio convert
- **juego / experimento / texto / app social** → la categoría correspondiente
- **en blanco** → solo defaults

## Atajos de teclado

| atajo | acción |
|---|---|
| `Esc` | cancela el edit form abierto / cierra el preset picker |
| `Cmd/Ctrl + S` | descarga un backup del master JSON |

## Estructura del repo

```
.
├── index.html               — UI con las 5 pestañas
├── style.css                — vars CSS, dark mode default, accent amarillo (#FFD66B)
├── script.js                — todo el código (≈1940 líneas comentadas en bloques numerados)
├── README.md                — este archivo
├── todo.md                  — pendientes futuros (no críticos)
├── brief.md                 — el brief original con que se kickeó el proyecto
├── data/
│   ├── neocities-snapshot.html   — copia del index.html actual del neocities (seed inicial)
│   ├── clouds-snapshot.json      — copia de clouds/proyectos.json (referencia)
│   ├── archive-snapshot.json     — copia de archive-data.json (referencia)
│   └── studio-snapshot.json      — template de data.json (se preserva en el export del studio)
└── favicon/                 — los mismos que meowrhino.studio
```

`script.js` está organizado en bloques con cabecera comentada:

```
1. CONSTANTES                  (categorías, mapas, presets, GH API URL)
2. STATE GLOBAL + LOCALSTORAGE
3. FACTORY makeProject()       ← la fuente de verdad del schema
4. HELPERS                     ($, $$, el, uid, escapeHtml, toast)
5. INFERENCIA DE TIPOS         (inferLinkType, ghRepoFromUrl)
6. PARSER                      (neocities html → master JSON)
7. EXPORTERS                   (4 funciones, una por destino)
8. RENDER                      (dashboard, projects, auditor, health, export)
9. MUTACIONES DE STATE         (CRUD proyectos, merge, drag, categorías)
10. AUDITOR                    (fetch GH + diff + reglas)
11. HEALTH CHECK               (ping de links)
12. EXPORT TAB                 (regenerar, copiar, descargar)
13. IMPORT/EXPORT MASTER JSON  (backup completo)
14. THEME                      (light/dark)
15. SEED                       (auto-load + paste HTML)
16. INIT                       (DOMContentLoaded handler)
```

Si tocas el schema, hazlo en `makeProject()` — todos los flows (parser, +nuevo, auditor, addFromRepo) lo respetan.

## Repos relacionados

- **`meowrhino/clouds`** — tiene una [GitHub Action semanal](https://github.com/meowrhino/clouds/blob/main/.github/workflows/sync-neocities.yml) que regenera `proyectos.json` parseando neocities directamente. Fallback automático: si el scrape falla, usa el `proyectos.json` versionado.
- **`meowrhino/becasDigMeow`** — el repo del studio. Aquí viven `data.json` (página principal) y `archive-data.json` (subpágina archive).
- **`meowrhino.neocities.org`** — el portal hand-coded. Es la fuente que parsea esta tool y la GH Action de clouds.

## Limitaciones conocidas

- **CORS y health-check** — el navegador no devuelve la respuesta real cuando llamas a otro dominio. El health-check solo detecta dominios completamente caídos (DNS muerto, servidor apagado), no errores 404 ni TLS expirados.
- **GitHub API rate limit** — sin auth son 60 req/h por IP. Cada fetch de repos consume 2 calls (148 repos = 2 páginas), así que ~30 fetches/h. Más que suficiente.
- **Snapshots manuales** — los archivos `data/*-snapshot.*` se actualizan a mano cuando cambia el HTML/JSON real de los sitios. La GH Action de clouds se ocupa de su `proyectos.json`, pero los demás snapshots son referencias estáticas.
- **`file://`** — si abres `index.html` con doble click el navegador bloquea los `fetch()` a los snapshots. Usa cualquier servidor estático (`python -m http.server`, Live Server de VSCode, GH Pages…).

## Estado actual

Funciona end-to-end:
- ✅ parser HTML → master (126 proyectos, 12 categorías, 202 enlaces)
- ✅ los 4 exporters (neocities html, clouds json, archive json, studio json)
- ✅ auditor con GH API (148 repos, ~35 huérfanos detectados con las reglas por defecto)
- ✅ health-check (limitado por CORS, ver más abajo)
- ✅ multi-select + fusionar + bulk actions
- ✅ presets para nuevo proyecto + auto-fill imagen del studio
- ✅ drag&drop reorder + CRUD categorías
- ✅ persistencia localStorage + import/export JSON

Pendientes futuros (no bloqueantes): ver [`todo.md`](todo.md).

## Por si vuelves a esto en 2 años

- Todo se persiste en `localStorage` con la key `neocitiesUpdater.v1`. Si rompes algo, abre devtools → Application → Local Storage → borra esa key y recarga; reseedará desde el snapshot.
- Hay un botón `↑ importar` arriba para cargar un backup `.json` que hayas exportado antes.
- Si el schema cambia (`version: 2` → `3`), añade la migración en `loadState()` (ya hay un par de migraciones suaves para los flags de studio).
- Si cambia el formato del HTML del neocities, el parser está en `parseNeocitiesHtml()` (sección 6 de `script.js`).
