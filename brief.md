# Brief — tool de sync entre GitHub y meowrhino.neocities.org

## Contexto

Soy meowrhino, programo webs JAMstack (HTML+CSS+JS vanilla). Tengo dos cosas que se me están desincronizando:

- **GitHub**: `github.com/meowrhino` → 148 repos públicos.
- **Neocities**: `meowrhino.neocities.org` → un índice hecho a mano donde listo ~110 proyectos agrupados en secciones. Cada proyecto aparece con un nombre y uno o varios links (al repo en `meowrhino.github.io/<slug>/`, a veces también a un dominio propio del cliente, PDFs, Figma, mega.nz, etc).

Algunos proyectos son míos, otros son de clientes con **dominio propio** (ej: `rikamichie.com`, `mirandaperezhita.com`, `mokakopa.com`…). Quiero que si ese dominio cae siga habiendo una versión mía accesible en GH Pages.

Además, otras webs mías (por ejemplo **meowrhino clouds**) *scrapean* este neocities para actualizarse. O sea que el HTML generado no puede romper esos consumidores.

## Objetivo

Una **tool single-file** (HTML + CSS + JS vanilla, sin framework) que haga tres cosas:

1. **Auditor** → llama a `https://api.github.com/users/meowrhino/repos?per_page=100` (paginado, sin auth, 2 requests), parsea el index de neocities actual y me escupe el diff:
   - Repos en GH que NO están en neocities (huérfanos).
   - Links en neocities que apuntan a repos que ya no existen (muertos).
   - Links a dominios custom que están caídos (opcional — ver pregunta 8).

2. **Editor de metadata** → UI para añadir/editar por proyecto: slug, displayName, categoría, cliente, estado (live / WIP / alpha / beta / deprecated), dominio propio, links extra (versiones v0/v1/v2, PDFs, figma…), flag `showInNeocities`.

3. **Generador** → output del `index.html` actualizado respetando el formato que scrapea clouds. Botón de copiar al portapapeles.

## Arquitectura propuesta

**JSON como única fuente de verdad.** Se persiste en `localStorage` + botones de export/import JSON. El neocities actual se importa **una sola vez** (parser que lee el HTML existente → JSON). A partir de ahí, el JSON manda y el HTML se regenera desde él.

Schema propuesto:

```json
{
  "categories": [
    { "id": "studio", "label": "" },
    { "id": "clients-live", "label": "" },
    { "id": "clients-wip", "label": "" },
    { "id": "personal", "label": "" },
    { "id": "tools", "label": "" },
    { "id": "games", "label": "" },
    { "id": "experiments", "label": "" },
    { "id": "chat", "label": "" },
    { "id": "misc", "label": "" },
    { "id": "notes", "label": "" },
    { "id": "portfolio-old", "label": "" },
    { "id": "ancient", "label": "" }
  ],
  "projects": [
    {
      "slug": "rikamichie",
      "displayName": "rikamichie",
      "category": "clients-live",
      "client": "rikamichie",
      "status": "live",
      "showInNeocities": true,
      "scrapeable": true,
      "links": [
        { "label": "repo", "url": "https://meowrhino.github.io/rikamichie/", "type": "github-pages" },
        { "label": "web",  "url": "https://rikamichie.com", "type": "custom-domain", "fallbackTo": 0 }
      ]
    }
  ]
}
```

El `fallbackTo` referencia el índice del link al que ir si este cae. Así el modelo de "dominio custom + fallback a mi GH Pages" queda explícito en el data, no solo en la visualización.

## Lo que ya sé del neocities actual (observado, no confirmado)

El índice tiene secciones separadas visualmente (líneas en blanco, no pude ver el HTML crudo). Cada proyecto sigue el patrón:

```
displayName
[linkLabel1](url1)   [linkLabel2](url2)   [linkLabel3](url3)
```

Los labels que veo reutilizados: `link`, `repo`, `web`, `WIP`, `v0`, `v1`, `v2`, `beta`, `alpha`, `deprecated`, `ir`, `music`, `future`, `trigrama`…

Secciones inferidas (orden de aparición, sin nombre explícito visible):

1. Studio / meowrhino.studio
2. Clientes live (con dominio propio)
3. Clientes WIP
4. Proyectos personales propios
5. Personales WIP
6. Tools (converters, calculadoras, etc)
7. Más tools (navicon, tarifas, etymodict…)
8. Barcelona + juegos (game of life, minesweeper, 5cards…)
9. Experimentos / arte / iching / ASCII
10. Chat / social (piupiu, gridChat…)
11. Misc (rikamichieCard, plantitas, taxrhino…)
12. Notas / TFG / hopeko
13. Portfolio viejo (CV01, cubito, casco, yamigotchi…)
14. Ancient (blogs adolescentes, tumblr)

## Lista de proyectos detectados en neocities

Esto es lo que pude extraer del texto renderizado (no del HTML crudo). Úsalo como seed para el parser o como test fixture — no me fío 100% de que esté completo.

**GitHub Pages (`meowrhino.github.io/<slug>/`):**
becasDigMeow, diegosanmarcos, maxito, rikamichie, mikesx, jaumeclotet, conor, paulabarjau, mirandaperezhita, andreacarilla, mokakopa, twinMokakopa, e300, jordis, snerta, anakatana, villagranota, barbaraWong, viciostorpes, viciostorpesV2, ladiega, christine, profilePics, arxiu, clouds, cloudsv0, arwuchivo, cielo, becasDigMeow_v1, becasDigMeow_v0, trackr, imgToWeb, imgTo1600x900, videoToWeb, calculadoraInversa, generadorFacturas, colorFun, encuestaClientes, imgToNavicon, tarifasCalculadora, fcyp, igChecker, instagramNameGenerator, etymodict, writingapp, guiaSetupGithubPages, faqAutonomos, gameOfLife, etchASketch, minesweeperV2, rockPaperScissors, 5cards, cards1, letterSoup, horseLife, diego3, randomStars, buddhabrot, 8guamusic1, 8guafuture1, trigrama, ichingPic, wholeSignHouseChart, htmlDay2025, atalanta, apoloASCII, neolib10, solar5, a, ryf, investigaciones_001, investigaciones_002, investigaciones_003, investigaciones_004, gridChat, messagePark, projectChat, rikamichiev0, zumino, plantitas, latrini, safeAmorx, safeAmorxV2, tarifas_DEPRECATED, linktree, tinnitusRelief, discriminationtest, ableme, TEM, oca, jordiyordiyordyiordi, directorio, tarifas2026_DEPRECATED, videoToLilVideo_DEPRECATED, trackerTest, quests, registro, MTC, receptesdelapats, txttohtml, taxrhino, grid-web-generator, paintOnline, pdfs, notas5, notas4, notas3, notas2, notas, hopeko2, hopeko, somnis, historias, odin-recipes.

**No-GitHub (para el modelo de datos: no generan repo, pero SÍ aparecen en neocities):**
- GitLab: `mediocre-learner`, `bichi`
- Cargo: portfolio viejo, TFG
- Figma prototypes: portfolio, verdi
- Manus space: `matchacafe.manus.space`
- Cloudflare worker: `piulerv2.manuellatourf.workers.dev`
- Render: `piuler.onrender.com`
- Mega.nz: varios PDFs y videos
- Indiexpo: la torra manel I/II/III
- Tumblr, Blogspot: ancient
- Páginas propias del neocities: `barcelona.html`, `lafesta.html`, `about.html`, `projects/*` (PDFs e imágenes)

**Dominios propios detectados:**
rikamichie.com, mikebros.com, jaumeclotet.com, mirandaperezhita.com, andreacarilla.work, mokakopa.com, analopezserrano.com, estructuras3000.com, elmundodelasjordis.com, bertaesteve.cat.

## Preguntas abiertas (contestar antes/durante la implementación)

1. **Estructura real del HTML del neocities.** ¿Se escribe a mano o con algún generator? Pega un fragmento del HTML crudo (1 categoría, 2-3 proyectos) para que el parser sepa qué buscar (¿`<section>`? ¿`<h2>`? ¿`<br>`? ¿clases específicas?).

2. **Nombres de categorías.** ¿Existen en el HTML como texto, como `id`/`class`, o son solo separaciones visuales? Si no existen, habrá que nombrarlas desde cero (ver lista inferida arriba).

3. **meowrhino clouds scraping.** ¿Qué selectores usa para extraer del neocities? Pegar el JS de clouds relevante. Esto define qué NO podemos cambiar en el HTML generado.

4. **Exclusiones del diff.** Qué repos de GH no cuentan como "huérfanos":
   - forks
   - archivados
   - que acaben en `_DEPRECATED`
   - repos de prueba/throwaway (¿patrón de nombre? ¿lista manual?)
   - ¿algún otro criterio?

5. **Tratamiento de no-GH.** Los proyectos que no son repos de GH (gitlab, figma, cargo, mega, etc.) ¿se almacenan en el mismo JSON con `type: "external"` o en un apartado separado?

6. **Campos de metadata.** ¿Falta alguno de los propuestos (`status`, `client`, `category`, `scrapeable`, `showInNeocities`, `links[]`)? ¿Sobra alguno? ¿Añadir `tags`, `createdAt`, `thumbnail`?

7. **Proyectos con múltiples versiones** (v0/v1/v2/WIP). ¿Los mantenemos como 1 entrada con array de `links` (lo que ya haces en el HTML actual) o los separamos en entradas distintas con campo `parentSlug`?

8. **Fallback del dominio.** Cuando dices "si el dominio cae se muestra la mía":
   - (a) solo listar ambos links en el índice (lo que ya haces) — **no hay que hacer nada runtime**
   - (b) *health-check* JS en el índice del neocities que pinga los dominios y muestra un aviso / oculta link muerto
   - (c) fallback dentro de cada subsite cliente (meta-refresh o JS que redirija si detecta que no cargó). Esto son N cambios, uno por cada página de cliente.
   - (d) más de una. Elegir.

9. **Deploy de la tool.** ¿Un único `index.html` para abrir en local + subir donde quiera, o una subruta fija (`meowrhino.github.io/repodiff/` o `meowrhino.neocities.org/tools/repodiff/`)?

10. **GH API.** 148 repos = 2 requests sin auth, dentro del límite de 60/hora. Si se quiere mostrar extra (última actualización, stars, lenguaje, archivado sí/no) sigue siendo 2 requests. Sin token. Confirmar que OK.

## Constraints técnicos

- **Stack:** HTML + CSS + JS vanilla. Sin React/Vue/etc. Sin build step.
- **Un solo archivo** preferible (o `index.html` + 1 `script.js` + 1 `style.css` máximo).
- **Sin backend.** Todo en el browser. GH API es pública y tiene CORS abierto para GET.
- **localStorage** para persistir el JSON entre sesiones.
- **Export / Import JSON** obligatorio (para backup y para pasar entre dispositivos).
- **No romper scraping de clouds.** Una vez clarificado el punto 3, respetar esos selectores/clases al generar el HTML.

## Nice-to-haves (no bloqueantes)

- Detectar repos **archivados** en GH y marcarlos visualmente en el auditor.
- Detectar repos **sin GitHub Pages activo** (HEAD a `meowrhino.github.io/<slug>/`) para avisar antes de linkearlos.
- Health-check de dominios custom (ver pregunta 8b).
- Drag & drop para reordenar proyectos dentro de una categoría.
- Diff visual tipo "git diff" entre el HTML actual y el HTML que se va a generar.
- Modo oscuro (opcional pero meowrhino = moño + rinoceronte, dark mode encaja).

## Flow de usuario ideal

1. Abro la tool.
2. La primera vez: pego el HTML actual del neocities → se parsea → se guarda en localStorage como JSON.
3. La tool llama al GH API, compara, me muestra los huérfanos con checkboxes tipo "añadir a tal categoría".
4. Edito metadata de los que hagan falta (dominios custom, estado, etc.).
5. Le doy a "generar HTML" → copio → pego en el editor de neocities → save.
6. Siguientes veces: abro la tool, pulso "refrescar desde GH", me dice qué hay nuevo, repito.

---

Este es el estado del brief. Si te contesto las preguntas abiertas en el chat de Claude Code mientras lo construye, el schema puede evolucionar sobre la marcha.
