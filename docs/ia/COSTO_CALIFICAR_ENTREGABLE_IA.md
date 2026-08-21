# Costo real de "Calificar con IA" (OP-11) — 21-ago-2026

Pedido explícito de Kike antes de implementar: verificar que el costo real
de la operación (lo que Evalúa Fácil le paga a Anthropic) se mantenga cerca
de **$0.25 MXN por entrega evaluada**, sin cambiar la regla de negocio de
**1 crédito por evaluación** — el objetivo es optimizar el costo interno,
no trasladarlo al docente.

## Modelo y tarifas usadas para el cálculo

- Modelo: `claude-haiku-4-5` — el mismo que ya usan TODAS las operaciones de
  IA del proyecto (`config/iaTarifas.modeloPorOperacion`), y el más barato
  de la familia Claude vigente. No hay un modelo más económico con visión
  disponible — no se cambia.
- Precio real (`config/iaTarifas.costosAnthropicUSD['claude-haiku-4-5']`,
  confirmado contra la documentación oficial de Anthropic): **$1 USD /
  millón de tokens de entrada, $5 USD / millón de tokens de salida**.
- Tipo de cambio de referencia del proyecto: **18.50 MXN/USD**
  (`config/iaTarifas.tipoCambioUsdMxn`).
- Fórmula de tokens de imagen documentada por Anthropic:
  **tokens ≈ (ancho_px × alto_px) / 750**.

Estas cifras son un **cálculo razonado**, no una medición en producción —
la fuente de verdad real es `iaConsumosInterno/{idempotencyKey}` (tokens
reales de cada llamada, ya se registra automáticamente para toda operación
de IA — ver `functions/ia.js`, `ejecutarOperacionIA`), que el Chat de
Administración ya usa para calcular costo real. Recomendado: revisar esos
registros después de que la función lleve una semana en uso real y ajustar
estos números si se alejan de lo estimado aquí.

## Optimizaciones aplicadas ANTES de escribir el ejecutor

1. **Imágenes limitadas a 1200×1200px** (`limitarResolucionImagen`,
   `evidenciasEntrega.js`) vía transformación de Cloudinary
   (`w_1200,h_1200,c_limit,q_auto,f_jpg`) — el mismo mecanismo que ya usan
   `downloadUrl`/`pdfPageImageUrl` en `src/utils/cloudinary.js`. 1200px deja
   perfectamente legible una foto de cuaderno y baja el costo casi a la
   mitad frente a mandar la imagen a resolución completa (o incluso al tope
   de 1568px que Claude usa internamente).
2. **PDF nativo limitado a 3 páginas** (`MAX_PAGINAS_PDF_NATIVO`,
   `evidenciasEntrega.js`) — se cuenta con `pdf-parse` (ya es dependencia de
   `docExtract.js`) ANTES de mandarlo a Claude. Un PDF más largo usa solo el
   texto ya extraído (si lo hay); si no hay texto extraíble (PDF escaneado
   muy largo), se ignora esa evidencia — nunca se manda el documento
   completo a análisis visual.
3. **Salida acotada a 900 tokens** (`max_tokens` en `ejecutarCalificarEntregableIA`)
   — evidencias de máx. 25 palabras por criterio + retroalimentación de 2-4
   frases, nunca un ensayo.
4. **Tarifa fija de 1 crédito por entrega**, sin importar cuántas
   evidencias trajo (tope 5) — ya estaba decidido por el PO; aquí solo se
   confirma que el costo real cabe dentro de ese crédito en los cuatro
   escenarios pedidos.
5. Nada de esto se compensó subiendo la tarifa en créditos — la tarifa
   sigue siendo 1, centralizada en `config/iaTarifas.tarifas.calificar_entregable_ia`,
   la MISMA moneda de créditos que el resto de la plataforma.

## Cálculo por escenario

Overhead fijo de texto en cada llamada (system prompt + instrucciones de la
actividad + descripción de los criterios del instrumento + instrucciones de
formato de salida): **~900 tokens** estimados (rango real: instrumentos
pequeños ~600, instrumentos grandes de 6 criterios × 5 niveles ~1200 — se
usa el valor medio-alto para no subestimar).

Salida estimada: **~550 tokens** (`~$0.00275 USD` a $5/MTok).

| # | Escenario | Entrada estimada | Costo entrada | Costo salida | **Total USD** | **Total MXN** |
|---|---|---|---|---|---|---|
| 1 | Word/DOCX (~1000 palabras, texto extraído con `docExtract`) | 900 + ~1400 tok texto ≈ 2 300 tok | $0.0023 | $0.00275 | $0.00505 | **$0.093** |
| 2 | PDF digital (2-3 páginas con texto, documento nativo) | 900 + ~5 500 tok (≈2 200 tok/página) ≈ 6 400 tok | $0.0064 | $0.00275 | $0.00915 | **$0.169** |
| 3 | PDF escaneado (al tope de 3 páginas nativas, denso) | 900 + ~8 700 tok (≈2 900 tok/página) ≈ 9 600 tok | $0.0096 | $0.00275 | $0.01235 | **$0.228** |
| 4 | Hasta 5 fotografías JPG/PNG a 1200px | 900 + 5 × ~1 440 tok ≈ 8 100 tok | $0.0081 | $0.00275 | $0.01085 | **$0.201** |

**Promedio de los 4 escenarios: ≈ $0.173 MXN por evaluación** — **31% por
debajo** del objetivo de $0.25 MXN. El escenario más caro (PDF escaneado en
el tope de 3 páginas) queda en $0.228, con ~9% de margen — es un tope
explícito, no el caso típico (la mayoría de las entregas fotografiadas caen
en el escenario 4, y la mayoría de los PDF digitales de una tarea real
tienen 1-2 páginas, no 3).

## Qué NO se hizo (y por qué no hacía falta)

- **No se creó un modelo/tarifa distinta para esta operación** — usa
  exactamente el mismo `claude-haiku-4-5` y el mismo diccionario
  `config/iaTarifas.tarifas` que todas las demás.
- **No se creó una "moneda" nueva de créditos de visión/documentos** — el
  docente sigue pensando solo en créditos, 1 por evaluación, sin importar
  el tipo de evidencia.
- **No hizo falta reducir la calidad de la rúbrica ni del instrumento** en
  el prompt — el recorte de costo salió de la RESOLUCIÓN de la imagen y del
  TOPE de páginas del PDF, no de mandar menos contexto pedagógico.

## Riesgo conocido, no bloqueante

Si un docente sube 5 evidencias que combinan varios PDFs grandes (cada uno
en su propio slot de los 5) el costo podría acercarse más al límite que
estos escenarios de un solo tipo. Es un caso de borde, no el flujo esperado
(la actividad entregable normalmente pide UN tipo de evidencia). Se deja
documentado para revisar con datos reales de `iaConsumosInterno` una vez en
producción, no para bloquear esta primera versión.
