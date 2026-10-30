# Contenedor Docker de n8n — Difusión en Redes Sociales

Esta carpeta contiene los flujos listos para importar en el contenedor `inmobiliarias-n8n` definido en `docker-compose.yml`.

## 1. Levantar los contenedores

Asegúrate de completar en tu archivo `.env` las variables de n8n y Meta (puedes guiarte con `.env.example`):

```env
N8N_WEBHOOK_SECRET="un_secreto_largo_y_seguro"
N8N_ENCRYPTION_KEY="llave_de_cifrado_de_32_caracteres"
META_PAGE_ID="id_de_tu_pagina_de_facebook"
META_IG_USER_ID="id_de_tu_cuenta_instagram_business"
META_PAGE_ACCESS_TOKEN="token_de_larga_duracion_de_pagina"
```

Luego levanta el stack:

```bash
docker compose up -d
```

* Panel web de n8n: `http://localhost:5678`
* Comunicación interna Docker:
  * **Backend -> n8n**: `http://n8n:5678/webhook/difusion-inmueble`
  * **n8n -> Backend (Callback)**: `http://backend:3000/webhooks/n8n/diffusion`
  * **n8n -> Backend (Resumen semanal)**: `http://backend:3000/n8n/weekly-summary`

## 2. Importar los Workflows automáticamente

Los archivos `.json` de `./n8n/workflows` están montados en `/workflows` dentro del contenedor `inmobiliarias-n8n`.

Puedes importarlos desde la interfaz web de n8n (**Workflows -> Import from File**) o con un solo comando por consola:

```bash
docker exec -u node inmobiliarias-n8n n8n import:workflow --separate --input=/workflows
```

Después de importarlos:
1. Abre `http://localhost:5678`.
2. Entra a **"Inmobiliaria - Difusion de Inmueble (FB + IG)"** y activa el interruptor **Active** (arriba a la derecha) para habilitar la URL de producción `/webhook/difusion-inmueble`.
3. Entra a **"Inmobiliaria - Resumen Semanal por Zonas (Lunes)"** y actívalo también.

## 3. Flujo de Moderación (Admin / Revisor -> n8n)

Ningún inmueble pagado se publica automáticamente en redes:
1. Cuando el usuario paga `DIFUSION_REDES` o `PAQUETE_DESTACADO_REDES` por QR, el backend crea la solicitud en estado `PENDIENTE`.
2. Un usuario con rol `ADMIN` o `REVISOR` revisa la cola (`GET /admin/diffusions?status=PENDIENTE`) y la vista previa (`GET /admin/diffusions/:id/preview`).
3. Si cumple políticas: `POST /admin/diffusions/:id/approve` envía el payload a n8n.
4. Si no cumple (fotos borrosas, datos falsos, etc.): `POST /admin/diffusions/:id/reject` la rechaza con motivo **sin llamar a n8n** y notifica al propietario.
5. Si falla una de las dos redes (ej. Facebook publica pero Instagram da error), n8n guarda el `fb_post_id` logrado y reporta `ERROR`. Al ejecutar `POST /admin/diffusions/:id/retry`, n8n reintenta **únicamente la red faltante** para no duplicar posts.
