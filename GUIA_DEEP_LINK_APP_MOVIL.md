# Guía de Implementación de Deep Links — App Móvil AlquilaBO (`com.ratelapps.alquilabo`)

Este documento detalla los cambios necesarios en la aplicación móvil **AlquilaBO** (`com.ratelapps.alquilabo`) para que, al tocar el enlace de una publicación en **Facebook** o **Instagram**, la aplicación se abra **directamente en el detalle o pin del inmueble publicado**.

---

## 1. ¿Cómo funciona el flujo actual desde Redes Sociales?

1. Cuando se publica un inmueble en Facebook o Instagram mediante **n8n**, el texto del post incluye al final un enlace limpio con el ID del inmueble:
   ```text
   https://alquila.ratelapps.com/ir/<propertyId>
   ```
   *(Ejemplo: `https://alquila.ratelapps.com/ir/29516b9f-40ca-4ff2-82ed-6285a9acb58b`)*

2. Cuando un usuario toca ese enlace desde un teléfono Android, el servidor `alquila.ratelapps.com` dispara automáticamente un **Android Intent** hacia la app:
   ```text
   intent://inmueble/<propertyId>#Intent;scheme=alquilabo;package=com.ratelapps.alquilabo;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.ratelapps.alquilabo;end
   ```
   Esto equivale a abrir la URI interna:
   ```text
   alquilabo://inmueble/<propertyId>
   ```

3. **Comportamiento automático en Android:**
   - **Si la app tiene registrado el esquema `alquilabo://inmueble/<propertyId>`** y está instalada en el teléfono: Android abre **AlquilaBO** directamente y le entrega la URI con el `<propertyId>`.
   - **Si el usuario NO tiene instalada la app**: Android ejecuta automáticamente el `S.browser_fallback_url` y lleva al usuario a **Google Play Store** (`https://play.google.com/store/apps/details?id=com.ratelapps.alquilabo`).

---

## 2. Configuración obligatoria en `AndroidManifest.xml`

En el proyecto móvil, abrir el archivo `android/app/src/main/AndroidManifest.xml` y dentro del bloque `<activity android:name=".MainActivity" ...>` agregar los siguientes `<intent-filter>`:

```xml
<!-- 1. Deep Link por esquema personalizado: alquilabo://inmueble/<propertyId> -->
<intent-filter>
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data
        android:scheme="alquilabo"
        android:host="inmueble" />
</intent-filter>

<!-- 2. Android App Link HTTPS directo: https://alquila.ratelapps.com/ir/<propertyId> -->
<intent-filter android:autoVerify="true">
    <action android:name="android.intent.action.VIEW" />
    <category android:name="android.intent.category.DEFAULT" />
    <category android:name="android.intent.category.BROWSABLE" />
    <data
        android:scheme="https"
        android:host="alquila.ratelapps.com"
        android:pathPrefix="/ir" />
</intent-filter>
```

> **Recomendación adicional en `<activity>`:** Usar `android:launchMode="singleTask"` o `android:launchMode="singleTop"` en `.MainActivity` para que, si la app ya estaba abierta en segundo plano, reciba el nuevo Intent sin duplicar instancias de la app.

---

## 3. Captura del `<propertyId>` y navegación dentro de la App

La app puede recibir cualquiera de estos dos formatos de URL al abrirse:
- `alquilabo://inmueble/29516b9f-40ca-4ff2-82ed-6285a9acb58b`
- `https://alquila.ratelapps.com/ir/29516b9f-40ca-4ff2-82ed-6285a9acb58b`

### Función para extraer el `propertyId` de la URL recibida

#### Opción A — Si la app está en **Flutter** (usando `app_links` o `go_router`)
1. Instalar `app_links`:
   ```bash
   flutter pub add app_links
   ```
2. Escuchar el link inicial (app cerrada) y links en caliente (app en segundo plano):
   ```dart
   import 'dart:async';
   import 'package:app_links/app_links.dart';

   class DeepLinkService {
     final _appLinks = AppLinks();
     StreamSubscription<Uri>? _linkSubscription;

     void initDeepLinks(void Function(String propertyId) onPropertyLink) async {
       // 1. Cuando la app se abre desde cero por el link
       final initialUri = await _appLinks.getInitialLink();
       if (initialUri != null) {
         _handleUri(initialUri, onPropertyLink);
       }

       // 2. Cuando la app ya estaba abierta en segundo plano
       _linkSubscription = _appLinks.uriLinkStream.listen((uri) {
         _handleUri(uri, onPropertyLink);
       });
     }

     void _handleUri(Uri uri, void Function(String propertyId) onPropertyLink) {
       String? propertyId;

       // Caso 1: alquilabo://inmueble/<propertyId>
       if (uri.scheme == 'alquilabo' && uri.host == 'inmueble') {
         if (uri.pathSegments.isNotEmpty) {
           propertyId = uri.pathSegments.first;
         }
       }
       // Caso 2: https://alquila.ratelapps.com/ir/<propertyId>
       else if (uri.pathSegments.length >= 2 && uri.pathSegments[0] == 'ir') {
         propertyId = uri.pathSegments[1];
       }

       if (propertyId != null && propertyId.isNotEmpty) {
         onPropertyLink(propertyId);
       }
     }

     void dispose() {
       _linkSubscription?.cancel();
     }
   }
   ```

---

#### Opción B — Si la app está en **React Native / Expo**
1. En `app.json` (si usa Expo), agregar `"scheme": "alquilabo"`.
2. Usar `Linking` de `react-native` (o `expo-linking`):
   ```typescript
   import { useEffect } from 'react';
   import { Linking } from 'react-native';

   function extractPropertyId(url: string | null): string | null {
     if (!url) return null;
     // Soporta alquilabo://inmueble/<id> y https://alquila.ratelapps.com/ir/<id>
     const match = url.match(/(?:alquilabo:\/\/inmueble\/|\/ir\/)([a-zA-Z0-9-]+)/i);
     return match ? match[1] : null;
   }

   export function usePropertyDeepLink(onOpenProperty: (propertyId: string) => void) {
     useEffect(() => {
       // 1. App abierta desde estado cerrado (Cold Start)
       Linking.getInitialURL().then((initialUrl) => {
         const id = extractPropertyId(initialUrl);
         if (id) onOpenProperty(id);
       });

       // 2. App ya abierta en segundo plano (Warm Start)
       const subscription = Linking.addEventListener('url', ({ url }) => {
         const id = extractPropertyId(url);
         if (id) onOpenProperty(id);
       });

       return () => subscription.remove();
     }, [onOpenProperty]);
   }
   ```

---

#### Opción C — Si la app está en **Kotlin / Android Nativo**
En `MainActivity.kt`:
```kotlin
override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    handleDeepLink(intent)
}

override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleDeepLink(intent)
}

private fun handleDeepLink(intent: Intent?) {
    val data: Uri = intent?.data ?: return
    val propertyId: String? = when {
        data.scheme == "alquilabo" && data.host == "inmueble" ->
            data.pathSegments.firstOrNull()
        data.pathSegments.size >= 2 && data.pathSegments[0] == "ir" ->
            data.pathSegments[1]
        else -> null
    }

    if (!propertyId.isNullOrBlank()) {
        // Navegar a la pantalla de detalle del inmueble o centrar el mapa en este propertyId
        openPropertyDetail(propertyId)
    }
}
```

---

## 4. Endpoint del Backend para cargar el Inmueble en la App

Una vez que la app extrae el `propertyId`, debe consultar el endpoint público del backend para obtener todos los datos del inmueble (coordenadas, fotos, precio, WhatsApp, descripción) y mostrar su ficha o centrar el mapa:

- **Método y URL:**
  ```http
  GET https://apiinmo.ratelapps.com/properties/:id
  ```
- **Ejemplo:**
  ```http
  GET https://apiinmo.ratelapps.com/properties/29516b9f-40ca-4ff2-82ed-6285a9acb58b
  ```
- **Nota:** Este endpoint es **público** (no requiere token JWT), por lo que funciona incluso si el usuario aún no ha iniciado sesión en la app.

*(Opcionalmente, registrar el evento de analítica `VISTA_DETALLE` con `source: "facebook"` en `POST https://apiinmo.ratelapps.com/properties/:id/events`).*

---

## 5. Cómo probar el Deep Link desde consola (`adb`) antes de subir a Play Store

Con el emulador o un teléfono conectado por USB, ejecutar:

```bash
adb shell am start -W -a android.intent.action.VIEW \
  -d "alquilabo://inmueble/29516b9f-40ca-4ff2-82ed-6285a9acb58b" \
  com.ratelapps.alquilabo
```

Si la configuración es correcta, la aplicación **AlquilaBO** se abrirá directamente mostrando el inmueble con ID `29516b9f-40ca-4ff2-82ed-6285a9acb58b`.
