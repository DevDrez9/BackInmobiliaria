# Actualización Incremental Frontend: Difusión Gratis Semanal (1/semana) + Tarifas Extra (10 Bs / 35 Bs)

Este documento contiene **únicamente los cambios nuevos** respecto a la implementación anterior que ya está en el Frontend. No es necesario rehacer los flujos previos de suscripciones, destacados, verificaciones ni el modal QR.

---

## 1. Resumen de la Nueva Regla de Negocio

1. **1 Difusión Gratis por Semana (Lunes a Domingo):**
   * Todos los usuarios tienen derecho a **1 publicación gratuita por semana** (contada desde el **Lunes 00:00:00 hasta el Domingo 23:59:59**, hora Bolivia `UTC-4`) para difundir un inmueble activo en Facebook e Instagram vía `n8n`.
   * Igual que las difusiones pagadas, **pasa primero por la bandeja de moderación (`PENDIENTE`)** de `ADMIN` / `REVISOR` antes de publicarse.
2. **Difusiones Adicionales en la Misma Semana (Pago por QR):**
   * Si el usuario ya usó su difusión gratuita de la semana y quiere difundir otro inmueble (o volver a difundir), puede pagar por QR con precio automático según su nivel:
     * Plan **`GRATIS`** o Plan **`PROPIETARIO`**: **10 Bs**
     * **`Plan Agente`** o cuentas con `accountType === 'INMOBILIARIA'`: **35 Bs**

---

## 2. Nuevos Endpoints y Cambios en Contratos JSON

### 2.1. Consultar Cupo Semanal y Tarifa del Usuario (`GET /diffusions/quota`)
* **Método:** `GET /diffusions/quota` *(Requiere `Authorization: Bearer <token>`)*
* **Nota:** Este mismo objeto también viene incluido ahora dentro de `GET /my-plan` bajo la propiedad `diffusionQuota`, para que no tengas que hacer dos peticiones si ya consultas `/my-plan`.
* **Respuesta (`200 OK`):**
  ```json
  {
    "weekStart": "2026-10-26T04:00:00.000Z",
    "weekEnd": "2026-11-02T03:59:59.999Z",
    "freeWeeklyLimit": 1,
    "freeUsedThisWeek": 0,
    "freeRemainingThisWeek": 1,
    "canPublishFree": true,
    "extraDiffusionPriceBs": 10,
    "diffusionProductId": "uuid-del-producto-DIFUSION_REDES"
  }
  ```
  * `canPublishFree`: `true` si aún tiene disponible su difusión gratis entre lunes y domingo; `false` si ya la usó.
  * `extraDiffusionPriceBs`: ya viene calculado por el backend (`10` para Gratis/Propietario, `35` para Plan Agente o cuenta Inmobiliaria).
  * `diffusionProductId`: UUID del producto `DIFUSION_REDES` listo para enviarlo a `POST /orders` cuando toque cobrar por QR.

---

### 2.2. Usar el Cupo Gratis en un Inmueble Existente (`POST /diffusions/free`)
* **Método:** `POST /diffusions/free` *(Requiere `Authorization: Bearer <token>`)*
* **Body:**
  ```json
  {
    "propertyId": "uuid-del-inmueble"
  }
  ```
* **Respuesta Exitosa (`201 Created`):**
  ```json
  {
    "diffusion": {
      "id": "uuid-difusion",
      "userId": "uuid-usuario",
      "propertyId": "uuid-del-inmueble",
      "orderId": null,
      "isFreeQuota": true,
      "status": "PENDIENTE",
      "postText": "🏠 VENTA — ..."
    },
    "quotaAfter": {
      "freeUsedThisWeek": 1,
      "freeRemainingThisWeek": 0,
      "canPublishFree": false,
      "extraDiffusionPriceBs": 10
    }
  }
  ```
* **Si ya agotó el cupo semanal (`400 Bad Request`):**
  Devuelve `code: "FREE_DIFFUSION_QUOTA_EXCEEDED"` junto con `extraDiffusionPriceBs`, `diffusionProductId` y `weekEnd`.

---

### 2.3. Nuevo Campo Opcional al Crear Inmueble (`POST /properties`)
Ahora `POST /properties` acepta el booleano opcional `requestDiffusion`:

```json
{
  "title": "Departamento en Sopocachi",
  "price": 45000,
  "...": "...",
  "requestDiffusion": true
}
```

* **Comportamiento de la respuesta de `POST /properties` cuando `requestDiffusion: true`:**
  1. **Si tenía cupo gratis disponible (`canPublishFree === true`):**
     Crea el inmueble **y encola automáticamente la difusión gratuita** en la misma transacción:
     ```json
     {
       "id": "uuid-inmueble-creado",
       "title": "...",
       "diffusionRequest": {
         "queuedFree": true,
         "requiresPayment": false,
         "diffusionId": "uuid-difusion",
         "status": "PENDIENTE"
       }
     }
     ```
  2. **Si ya había usado su cupo gratis de la semana (`canPublishFree === false`):**
     Crea el inmueble normalmente y avisa al frontend que debe abrir el pago QR para la difusión:
     ```json
     {
       "id": "uuid-inmueble-creado",
       "title": "...",
       "diffusionRequest": {
         "queuedFree": false,
         "requiresPayment": true,
         "extraDiffusionPriceBs": 10,
         "diffusionProductId": "uuid-del-producto-DIFUSION_REDES",
         "weekEnd": "2026-11-02T03:59:59.999Z"
       }
     }
     ```

---

### 2.4. Precio Dinámico Automático en `POST /orders`
No necesitas cambiar el body de `POST /orders` (`{ productId, propertyId }`):
* Cuando `productId` corresponde a `DIFUSION_REDES`, el backend ignora el precio fijo y genera el QR de ApiBanco cobrando automáticamente **10.00 Bs** (Gratis/Propietario) o **35.00 Bs** (Plan Agente / cuenta Inmobiliaria).

---

### 2.5. Nuevos Campos en Planes y Moderación Admin
1. **En `GET /plans`, `/auth/login` (`user.currentPlan`) y `PATCH /admin/plans/:id`:**
   * Se agregaron `freeWeeklyDiffusions` (`number`, default `1`) y `extraDiffusionPriceBs` (`number`, `10` o `35`).
2. **En `GET /admin/diffusions` y `GET /admin/diffusions/:id` (`ADMIN` y `REVISOR`):**
   * Cada difusión incluye ahora `"isFreeQuota": true | false`, y `"order"` puede venir en `null` cuando `isFreeQuota === true`.

---

## 3. Exactamente Qué Cambiar en las Pantallas del Frontend

### A. Formulario de "Publicar Inmueble" (`/publicar`)
1. Al cargar el formulario, leer `diffusionQuota` (desde `GET /diffusions/quota` o `GET /my-plan`).
2. Agregar un checkbox/switch: **"Difundir en nuestras redes sociales (Facebook + Instagram)"** que controla `requestDiffusion`:
   * Si `canPublishFree === true`: mostrar etiqueta verde **`¡Gratis! (1 disponible esta semana, lunes a domingo)`**.
   * Si `canPublishFree === false`: mostrar etiqueta **`Adicional por +${extraDiffusionPriceBs} Bs con QR (ya usaste tu publicación gratis de esta semana)`**.
3. Al recibir la respuesta de `POST /properties`:
   * Si `res.diffusionRequest?.queuedFree === true`: mostrar notificación de éxito (*"Inmueble publicado y difusión gratuita enviada a revisión"*).
   * Si `res.diffusionRequest?.requiresPayment === true`: abrir automáticamente el **Modal de Pago QR** existente llamando a `POST /orders` con `{ productId: res.diffusionRequest.diffusionProductId, propertyId: res.id }`.

### B. Tarjeta de Inmueble en "Mis Inmuebles" (`/mis-inmuebles`)
En el botón **"Difundir en redes"** de cada inmueble `ACTIVO` (cuando no tenga ya una difusión `PENDIENTE` / `APROBADO`):
* **Si `diffusionQuota.canPublishFree === true`**:
  * Mostrar botón **"Difundir Gratis (1 disponible esta semana)"**.
  * Al hacer clic, pedir confirmación (*"¿Usar tu difusión gratuita de esta semana para este inmueble?"*) y llamar a `POST /diffusions/free` con `{ propertyId }`. Refrescar lista y cupo.
* **Si `diffusionQuota.canPublishFree === false`**:
  * Mostrar botón **"Difundir en redes (`${diffusionQuota.extraDiffusionPriceBs}` Bs)"** (mostrará `10 Bs` o `35 Bs` según el usuario) con subtítulo *"Tu cupo gratis semanal se renueva el lunes"*.
  * Al hacer clic, abrir el **Modal de Pago QR** llamando a `POST /orders` con `{ productId: diffusionQuota.diffusionProductId, propertyId }`.

### C. Página Comparativa de `/planes` y Panel `/admin`
1. **En `/planes`:** Agregar una fila en las tarjetas de beneficios de los 3 planes mostrando:
   * *"1 difusión gratis en redes por semana (lunes a domingo)"*
   * *"Difusiones adicionales: `${plan.extraDiffusionPriceBs}` Bs"*
2. **En `/admin` → Pestaña Redes Sociales (`ADMIN` y `REVISOR`):**
   * Mostrar un badge en cada fila indicando si `item.isFreeQuota === true` (**"Cupo Gratis Semanal"**) o `false` (**"Difusión Pagada — `${item.order?.amountBs}` Bs"**), asegurándose de no fallar cuando `item.order` sea `null`.
3. **En `/admin` → Pestaña Catálogo de Planes (Solo `ADMIN`):**
   * Opcionalmente agregar inputs numéricos para `freeWeeklyDiffusions` y `extraDiffusionPriceBs` al editar un plan (`PATCH /admin/plans/:id`).

---

## 4. Checklist Rápido de Tareas Frontend

- [ ] Consumir `diffusionQuota` desde `GET /my-plan` o `GET /diffusions/quota`.
- [ ] Añadir checkbox `requestDiffusion` en `/publicar` y encadenar el Modal QR si devuelve `diffusionRequest.requiresPayment === true`.
- [ ] En `/mis-inmuebles`, alternar el botón de difusión entre `POST /diffusions/free` (cuando `canPublishFree === true`) y `POST /orders` mostrando `10 Bs` o `35 Bs` (cuando `canPublishFree === false`).
- [ ] Mostrar `freeWeeklyDiffusions` y `extraDiffusionPriceBs` en las tarjetas de `/planes` (y campos editables en `/admin/plans`).
- [ ] Soportar `order: null` + badge `isFreeQuota` en la bandeja de moderación de difusiones (`/admin`).
