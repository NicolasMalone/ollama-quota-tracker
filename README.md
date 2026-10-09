# Ollama Quota Tracker (Unofficial)

Muestra la cuota restante de **Ollama Cloud** en la barra de estado de VS Code.

```text
$(cloud) Ollama ██████░░░░ 58%
```

> **Nota:** esta extensión no está afiliada a Ollama. Es un proyecto independiente.

## Características

- Consulta el endpoint documentado de Ollama (`https://ollama.com/api/balance` y `/api/usage`) usando una API Key de `https://ollama.com/settings/keys`.
- Muestra el **% consumido** (predeterminado) o el **% restante** en la Status Bar, con la opción `ollamaQuota.displayMode`.
- **Barra de progreso** en la Status Bar y el tooltip, activable/desactivable con `ollamaQuota.showProgress`.
- Tooltip con detalle: barras por ventana (sesión/semana o créditos), consumido/restante, comprados, reinicios y uso 24h.
- Refresco automático configurable (por defecto 60 s; 0 = desactivado).
- Refresco manual haciendo clic en el ítem.
- Conserva el último valor válido si falla una consulta.

## Uso

1. Instala la extensión.
2. Crea una API Key en `https://ollama.com/settings/keys`.
3. Ejecuta el comando `Ollama Quota: Configure API Key`.
4. Tu cuota aparecerá en la Status Bar.

## Configuración

| Opción | Predeterminado | Descripción |
| --- | --- | --- |
| `ollamaQuota.refreshInterval` | `60` | Intervalo de sondeo en segundos (0 = desactivado). |
| `ollamaQuota.displayMode` | `used` | Porcentaje mostrado: `used` (consumido) o `remaining` (restante). |
| `ollamaQuota.showProgress` | `true` | Muestra una barra de progreso en la Status Bar y el tooltip. |
| `ollamaQuota.warnThreshold` | `20` | Icono ⚠ cuando el % restante sea menor o igual a este valor. |

## Privacidad

- La API Key se guarda **solo** en el `SecretStorage` local de VS Code. Nunca se guarda en `settings.json`, logs ni telemetría.
- Esta extensión no recopila telemetría ni datos de uso.

## Descargo de responsabilidad

- Este proyecto no está afiliado con Ollama, OpenAI ni Anthropic.
- La API Key se usa únicamente para consultar la cuota.

## Licencia

MIT