# Contenedor Docker de n8n — Difusión Diaria a las 00:00 por Ciudad (Meta + TikTok)

Esta carpeta contiene los flujos independientes listos para importar en el contenedor `inmobiliarias-n8n` definido en `docker-compose.yml`:

1. **`difusion-inmueble.workflow.json`** — *Inmobiliaria - Difusion Diaria 00:00 por Ciudad (FB + IG)*
2. **`difusion-tiktok-diaria.workflow.json`** — *Inmobiliaria - Difusion Diaria 00:00 por Ciudad (TikTok)*
3. **`resumen-semanal.workflow.json`** — *Inmobiliaria - Resumen Semanal por Zonas (Lunes)*

---

## 1. Variables de entorno (`.env`)

Completa en tu archivo `.env` las credenciales de Meta y, cuando tengas lista tu app en TikTok Developers, las de TikTok:

```env
DIFFUSION_SCHEDULE_MODE="DAILY_00"
N8N_WEBHOOK_SECRET="un_secreto_largo_y_seguro"
N8N_ENCRYPTION_KEY="llave_de_cifrado_de_32_caracteres"

# Meta (Facebook Page + Instagram Business)
META_PAGE_ID="id_de_tu_pagina_de_facebook"
META_IG_USER_ID="id_de_tu_cuenta_instagram_business"
META_PAGE_ACCESS_TOKEN="token_de_larga_duracion_de_pagina"

# TikTok Developers (Content Posting API v2)
TIKTOK_CLIENT_KEY=""
TIKTOK_CLIENT_SECRET=""
TIKTOK_ACCESS_TOKEN=""
TIKTOK_REFRESH_TOKEN=""
# "MEDIA_UPLOAD" = Borrador al celular con audio recomendado | "DIRECT_POST" = Directo con auto_add_music: true
TIKTOK_POST_MODE="MEDIA_UPLOAD"
TIKTOK_PRIVACY_LEVEL="PUBLIC_TO_EVERYONE"
```

Levanta el stack con:

```bash
docker compose up -d
```

---

## 2. Importar los Workflows

Los archivos `.json` de `./n8n/workflows` están montados en `/workflows` dentro del contenedor `inmobiliarias-n8n`:

```bash
docker exec -u node inmobiliarias-n8n n8n import:workflow --separate --input=/workflows
```

Luego entra a `http://localhost:5678` y activa (**Active**):
1. **Inmobiliaria - Difusion Diaria 00:00 por Ciudad (FB + IG)**
2. **Inmobiliaria - Difusion Diaria 00:00 por Ciudad (TikTok)** (puedes dejarlo activo desde ya; si aún no colocaste `TIKTOK_ACCESS_TOKEN`, detecta que falta el token y no marca error).

---

## 3. Cómo funciona el Carrusel Diario a las 00:00 por Ciudad

1. **Aprobación durante el día:**
   * Cada vez que un `ADMIN` o `REVISOR` aprueba una difusión (`POST /admin/diffusions/:id/approve`), el inmueble pasa a estado `APROBADO` y queda en cola para el lote de las `00:00`.
2. **Agrupación por Ciudad + Portada con Fecha Actual:**
   * A las **00:00 AM** (`America/La_Paz`), ambos workflows consultan el backend:
     * Meta: `GET /n8n/daily-diffusions?network=meta`
     * TikTok: `GET /n8n/daily-diffusions?network=tiktok`
   * El backend agrupa todos los inmuebles aprobados por **ciudad** (ej. *La Paz*, *Santa Cruz*, *Cochabamba*) y construye una publicación independiente por cada ciudad.
   * **Primera imagen del carrusel (`index 0`):** Se genera dinámicamente una portada de la ciudad con la **fecha actual de publicación** y el conteo de inmuebles:
     * `/public/diffusions/city-cover/:city/social-card.jpg?date=YYYY-MM-DD&count=N`
   * **Siguientes imágenes del carrusel (`index 1..N`):** Las tarjetas individuales generadas para cada inmueble aprobado en esa ciudad:
     * `/public/diffusions/:id/social-card.jpg`
3. **Independencia total entre Meta y TikTok:**
   * Meta guarda `fbPostId` e `igMediaId`.
   * TikTok corre en su propio workflow separado y guarda `tiktokPostId`.
