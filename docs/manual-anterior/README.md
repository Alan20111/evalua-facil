# Manual anterior (archivado)

Este es el contenido completo del "Manual" que existía en la interfaz del
docente antes del 2026-08-14, cuando se reemplazó por "Ayuda para comenzar"
(4 guías breves con capturas reales, ver `src/pages/teacher/GettingStartedPage.jsx`).

`ManualPage.jsx` es una copia exacta del componente tal como estaba montado en
`/manual`. **No está importado por ninguna parte del build** — es solo
referencia para poder recuperar el contenido si se necesita retomarlo o
reintegrarlo más adelante (por ejemplo como un manual completo aparte, o para
reciclar textos de secciones específicas).

Para reactivarlo: volver a importarlo en `src/App.jsx` y registrar una ruta.
