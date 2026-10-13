# Changelog

## 0.4.0 — 2026-10-13

- Se restaura la **barra de progreso** (medidor con codicons `circle-large-filled` / `circle-large-outline`) en los dos sitios, y es la misma barra: junto al % primario en la Status Bar (vistazo rápido) y junto al resumen y a cada línea (sesión, semana o créditos) en el tooltip (vista al pasar el ratón). Codicons elegidos por renderizar idénticos en ambas superficies, a diferencia de los bloques Unicode que se rompen en la fuente proporcional de la status bar.

## 0.3.0 — 2026-10-09

- Se elimina el indicador de progreso (medidor de codicons en la Status Bar y barras de bloques en el tooltip) y la opción `ollamaQuota.showProgress`. El vistazo rápido queda reducido a los porcentajes: la Status Bar muestra el % primario y el tooltip lista sesión y semana (o créditos) solo con %.

## 0.2.3 — 2026-10-09

- El indicador de la Status Bar usa los codicons `circle-large-filled` / `circle-large-outline` (antes `circle-filled` / `circle-outline`), demasiado pequeños y difíciles de distinguir.
- Los 5 segmentos grandes se leen como una barra de nivel (`●●●●●○○`), más cercana a la barra original.

## 0.2.2 — 2026-10-09

- La Status Bar sustituye la barra de caracteres Unicode (que se renderizaba irregular/superpuesta con la fuente proporcional de la status bar) por un **indicador de consumo con iconos nativos de VS Code** (`●●●●●○○`). Se ve correctamente con cualquier fuente.
- Las barras detalladas con bloques (`████░░░░`) se conservan **solo en el tooltip**, dentro de bloques de código de ancho fijo, donde siempre se alinean.

## 0.2.1 — 2026-10-09

- En modo legacy, la Status Bar muestra ahora la cuota de la **sesión** (antes elegía la ventana más consumida entre sesión y semana).
- El límite **semanal** sigue visible en el tooltip.

## 0.2.0 — 2026-10-09

- La Status Bar muestra el **% consumido** por defecto (antes mostraba el % restante); configurable con la nueva opción `ollamaQuota.displayMode` (`used` | `remaining`).
- Nueva **barra de progreso** en la Status Bar y en el tooltip, activable/desactivable con `ollamaQuota.showProgress` (activada por defecto).
- El tooltip indica **uso** (%) y restante por ventana, además de los reinicios.

## 0.1.0 — 2026-10-09

- Primera versión: consulta la cuota (`/api/balance`) y el uso 24h (`/api/usage`) con la API Key de Ollama Cloud.
- Status bar con % restante (modo créditos o límites legacy de sesión/semana).
- Tooltip con detalle de créditos, comprados, reinicios y uso 24h.
- Refresco automático configurable (60 s por defecto) y refresco manual.
