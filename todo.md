# todo

Cosas que NO están hechas pero podrían valer la pena en el futuro.
Si no se tocan, la tool sigue funcionando — todo lo crítico está cerrado.

## Real (hazlo cuando salga)

- **Lanzar el primer run de la GH Action de clouds**. La action está
  scheduleada para los lunes 07:00 UTC pero hasta que no corra una
  vez no sabremos si la run real funciona. Trigger manual:
  github.com/meowrhino/clouds/actions → "sync proyectos.json desde
  neocities" → "Run workflow".
- **Marcar a mano los 6 portfolio que no matchearon** por URL al
  hacer el seed inicial: diego san marcos, conor, viciostorpes,
  maxito, noan cittadino, 930blurberrie, paula barjau. Edit form →
  checkbox "studio · portfolio" → la imagen se autocompleta.
- **Refrescar `data/studio-snapshot.json`** cuando cambies cupon /
  statement / metodología / políticas / contacto en el data.json
  real. El studio exporter usa este snapshot como template para los
  campos no-proyecto.

## Mejoras útiles (no urgentes)

- **Health-check con fallback runtime** en el archive: cuando un
  proyecto tiene un dominio propio caído, mostrar el GH Pages como
  link grande y poner el dominio tachado. Esto NO se puede hacer
  desde el browser por CORS — hay que añadirlo al JS del archive
  (becasDigMeow/js/archive-main.js) que pinga al cargar.
- **Health-check filtrable**: ahora pinga todo. añadir un toggle
  "ignorar proyectos hidden" y "ignorar proyectos no live".
- **Auto-update de snapshots**: un botón "refrescar snapshot" en el
  inicio que hace fetch al data.json real del studio
  (probablemente con CORS proxy o GH Action). Hoy se hace a mano.
- **Stats de mantenimiento** en el dashboard: cuántos proyectos
  tienen studioPortfolio sin imagen, cuántos clientes no tienen
  primary link, cuántos repos archivados siguen listados como live.
- **Drag-reorder entre categorías** funciona pero el cálculo de
  `moved.category` cuando arrastras al primer item de una sección
  vacía puede devolver undefined. Hay un guard `if (target)` pero
  habría que mejorar el feedback visual (mostrar borde de la
  categoría destino al hover).

## Schema / consistencia

- **Url normalización**: el dedupe de `bulkMerge()` usa
  `url.toLowerCase()` pero no normaliza http vs https ni trailing
  slashes. En la práctica no se nota porque todos los repos van por
  https, pero un día puede sorprender.
- **Health check vs. exporters** filtran distinto. Los exporters
  excluyen `p.hidden`; collectUrls() incluye todo. Decisión: ¿el
  health-check debe pinguear hidden? probablemente sí (te interesa
  saber si se mueren).

## Abierto / decisiones pendientes

- **¿GitHub Pages para la tool?** Está como público en
  github.com/meowrhino/neocitiesUpdater pero Pages no está activo.
  Si lo activas funcionará en `meowrhino.github.io/neocitiesUpdater/`
  (los snapshots y el favicon ya tienen rutas relativas).
- **¿Versionar `data/seed.json`?** Si exportas el master JSON con
  `↓ backup` y lo guardas como `data/seed.json` en el repo, al
  abrir la tool en otra máquina (o tras borrar localStorage) te
  carga el estado curado en vez del snapshot raw del neocities. Hoy
  el seed empieza siempre desde el snapshot.
- **Schema migration paths**. Si se cambia algo gordo en
  `makeProject()` (renombrar un campo, anidar showIn distinto), hay
  que añadir una migración en `loadState()`. Las que ya hay son
  para los flags `studioTools`/`studioConvert`/`studioPortfolio`.
- **Frecuencia de la GH Action**: lunes 07:00 UTC. Si haces
  cambios entre semana, clouds estará desactualizado hasta el lunes.
  Alternativa: trigger en push a meowrhino.neocities.org (no hay
  webhook, habría que hacerlo a mano desde Actions UI).

## Ideas sueltas (probablemente no)

- thumbnails en el archive también, no solo en studio portfolio
- markdown rendering para `notes`
- bulk action "marcar todos como hidden de la categoría X"
- exportar a un 5º formato (RSS? OPML? solo si alguien lo pide)
- modo "presentación" — vista pública de la lista para enviar a
  alguien sin tener que mostrarle la tool
