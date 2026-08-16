## Resumen

<!-- Qué cambia y por qué (1-3 líneas). -->

## Checklist de accesibilidad y diseño

<!-- Marca solo lo que aplique a este PR — no todo aplica a cada cambio.
     Ver docs/PLAN_ACCESIBILIDAD_Y_ADAPTABILIDAD.md -->

- [ ] Probado a 320px de ancho sin scroll horizontal (si toca layout/CSS)
- [ ] Navegable solo con teclado (Tab/Shift+Tab/Enter/Escape) — si agrega un control interactivo nuevo
- [ ] Targets táctiles ≥ 44×44px, o al menos 24×24px (WCAG 2.5.8) — si agrega un botón/ícono clicable
- [ ] Contraste de texto verificado si se usa un color nuevo (4.5:1 texto, 3:1 UI)
- [ ] `npm run lint` y `npm run check:design` pasan en local (o el hallazgo nuevo está justificado en el PR)
- [ ] Si toca un modal: usa `components/ui/Modal.jsx`, no un `fixed inset-0` a mano
- [ ] Si toca un input/select/table en `pages/`: usa `components/ui/` (Input/Select/Table), no la etiqueta cruda

## Test plan

<!-- Cómo se verificó el cambio. -->
