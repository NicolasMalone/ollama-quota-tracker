# Changelog

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
