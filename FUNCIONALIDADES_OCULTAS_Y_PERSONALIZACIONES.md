# Registro de Funcionalidades Ocultas, Comentadas y Personalizaciones

Este documento recopila todas las funcionalidades nativas de OpenSign que han sido **comentadas, filtradas u ocultadas** para adaptar la plataforma a los requisitos corporativos de **Brascuba S.A.** (autenticación LDAP/AD, organigrama institucional, firma digital criptográfica centralizada y flujo simplificado).

Su propósito es servir de **guía técnica inmediata** para que cualquier desarrollador o administrador sepa qué módulos ya existen en el código fuente y cómo reactivarlos rápidamente en el futuro cuando el negocio lo requiera.

---

## Índice de Elementos

1. [Módulo de Plantillas (Templates) en el Sidebar](#1-módulo-de-plantillas-templates-en-el-sidebar)
2. [Recuadro "Prefill by owner" en el Preparador de Documentos](#2-recuadro-prefill-by-owner-en-el-preparador-de-documentos)
3. [Cambio de Contraseña Local en el Menú de Usuario (Header)](#3-cambio-de-contraseña-local-en-el-menú-de-usuario-header)
4. [Modo Oscuro (Dark Theme) en el Menú de Usuario](#4-modo-oscuro-dark-theme-en-el-menú-de-usuario)
5. [Sección de Ajustes Restringida (Settings) en el Sidebar](#5-sección-de-ajustes-restringida-settings-en-el-sidebar)
6. [Módulo "Documentos de otros usuarios" (Other Documents)](#6-módulo-documentos-de-otros-usuarios-other-documents)
7. [Columna de Acciones y Botón "Ver ficha" en la Tabla de Colaboradores](#7-columna-de-acciones-y-botón-ver-ficha-en-la-tabla-de-colaboradores)
8. [Protección y Fallback de Fotos de Perfil (Avatar 404)](#8-protección-y-fallback-de-fotos-de-perfil-avatar-404)

---

### 1. Módulo de Plantillas (Templates) en el Sidebar

- **¿Qué es?**  
  Permite crear modelos de documentos preconfigurados (`Create template`) y gestionarlos (`Manage templates`) para reutilizar esquemas de firma frecuentes sin tener que configurar los campos cada vez.
- **¿Por qué se ocultó?**  
  Actualmente los documentos a firmar son contratos y resoluciones dinámicas subidas directamente mediante *Solicitar firmas* o *Firma tú mismo*. La opción de plantillas no es necesaria en la operativa actual y saturaba el menú principal.
- **Archivos involucrados:**  
  - [`apps/OpenSign/src/json/menuJson.js`](file:///c:/Users/leandro.valdes/Desktop/Proyectos/OpenSign/apps/OpenSign/src/json/menuJson.js) (objeto `Templates` comentado).
  - [`apps/OpenSign/src/components/sidebar/Sidebar.jsx`](file:///c:/Users/leandro.valdes/Desktop/Proyectos/OpenSign/apps/OpenSign/src/components/sidebar/Sidebar.jsx) (filtro `if (item.title === "Templates") return null;`).
- **Estado:** Comentado en `menuJson.js` y filtrado en `Sidebar.jsx`.
- **¿Cómo reactivarlo en el futuro?**  
  1. En `menuJson.js`, retirar los caracteres de comentario `/* ... */` alrededor del bloque con `title: "Templates"`.
  2. En `Sidebar.jsx`, retirar la condición `if (item.title === "Templates") return null;`.
  3. Ejecutar el build de la aplicación (`npx vite build` en `apps/OpenSign`).

---

### 2. Recuadro "Prefill by owner" en el Preparador de Documentos

- **¿Qué es?**  
  Botón en forma de pastilla (`Prefill by owner`) ubicado sobre la lista de firmantes al preparar un documento. Permite al propietario que envía el documento pre-llenar valores estáticos (texto, fechas, checks) antes de despacharlo a los firmantes.
- **¿Por qué se ocultó?**  
  En los flujos corporativos de Brascuba solo se asignan campos directos a los firmantes requeridos (según su jerarquía y cargo). Este botón se prestaba a confusión porque parecía una firma adicional o un colaborador extra.
- **Archivos involucrados:**  
  - [`apps/OpenSign/src/components/pdf/RecipientList.jsx`](file:///c:/Users/leandro.valdes/Desktop/Proyectos/OpenSign/apps/OpenSign/src/components/pdf/RecipientList.jsx) (líneas ~103 a 122).
- **Estado:** Comentado en `RecipientList.jsx`.
- **¿Cómo reactivarlo en el futuro?**  
  1. En `RecipientList.jsx`, descomentar el bloque `props?.prefillSigner?.map(...)`.
  2. Recompilar el frontend con Vite.

---

### 3. Cambio de Contraseña Local en el Menú de Usuario (Header)

- **¿Qué es?**  
  Ruta `/changepassword` accesible desde el desplegable del perfil en la barra superior.
- **¿Por qué se ocultó?**  
  Los usuarios de la plataforma se autentican a través de **Directorio Activo / LDAP** corporativo de Brascuba. Permitir el cambio de contraseña local desde la web crearía inconsistencias con las credenciales corporativas de Windows/LDAP.
- **Archivos involucrados:**  
  - [`apps/OpenSign/src/components/Header.jsx`](file:///c:/Users/leandro.valdes/Desktop/Proyectos/OpenSign/apps/OpenSign/src/components/Header.jsx) (líneas ~221 a 233).
- **Estado:** Comentado en `Header.jsx`.
- **¿Cómo reactivarlo en el futuro?**  
  1. Si se agregan cuentas locales que requieran gestión autónoma de contraseña, descomentar el elemento `<li>` con `navigate("/changepassword")` en `Header.jsx`.

---

### 4. Modo Oscuro (Dark Theme) en el Menú de Usuario

- **¿Qué es?**  
  Selector para conmutar el tema visual de la interfaz al tema `opensigndark`.
- **¿Por qué se ocultó?**  
  Para mantener la uniformidad corporativa y asegurar que los documentos, certificados y firmas se visualicen siempre sobre el fondo blanco y limpio estándar.
- **Archivos involucrados:**  
  - [`apps/OpenSign/src/components/Header.jsx`](file:///c:/Users/leandro.valdes/Desktop/Proyectos/OpenSign/apps/OpenSign/src/components/Header.jsx) (líneas ~245 a 257).
- **Estado:** Comentado en `Header.jsx`.
- **¿Cómo reactivarlo en el futuro?**  
  1. Descomentar el bloque correspondiente en `Header.jsx`.

---

### 5. Sección de Ajustes Restringida (Settings) en el Sidebar

- **¿Qué es?**  
  En el OpenSign original, la sección "Ajustes" contenía múltiples submódulos: Planes y facturación, Claves de API, Webhooks, Integraciones y Usuarios.
- **¿Por qué se adaptó?**  
  En la instancia interna On-Premise no aplican pasarelas de pago ni planes SaaS. Además, solo los administradores generales (`contracts_Admin` / `contracts_OrgAdmin`) deben tener acceso al panel de **Usuarios** (`/users`). Para los colaboradores estándar (`contracts_User`), la sección completa de Ajustes permanece oculta.
- **Archivos involucrados:**  
  - [`apps/OpenSign/src/components/sidebar/Sidebar.jsx`](file:///c:/Users/leandro.valdes/Desktop/Proyectos/OpenSign/apps/OpenSign/src/components/sidebar/Sidebar.jsx) (función `menuItem`).
  - [`apps/OpenSign/src/json/menuJson.js`](file:///c:/Users/leandro.valdes/Desktop/Proyectos/OpenSign/apps/OpenSign/src/json/menuJson.js) (arreglo `subSetting`).
- **Estado:** Filtrado programático por rol.

---

### 6. Módulo "Documentos de otros usuarios" (Other Documents)

- **¿Qué es?**  
  Vista en el Sidebar para auditar y consultar documentos generados por cualquier usuario de la organización.
- **¿Por qué se adaptó?**  
  Por motivos de privacidad y confidencialidad departamental, únicamente los administradores generales pueden ver documentos globales de otros colaboradores.
- **Archivos involucrados:**  
  - [`apps/OpenSign/src/components/sidebar/Sidebar.jsx`](file:///c:/Users/leandro.valdes/Desktop/Proyectos/OpenSign/apps/OpenSign/src/components/sidebar/Sidebar.jsx) (`if (item.title === "Other Documents" && !isGeneralAdmin) return null;`).
- **Estado:** Oculto para colaboradores base; activo para administradores.

---

### 7. Columna de Acciones y Botón "Ver ficha" en la Tabla de Colaboradores

- **¿Qué es?**  
  En la vista de tabla de `/users` existía una columna "Acciones" con botones flotantes y un enlace "Ver ficha".
- **¿Por qué se simplificó?**  
  Se estilizó para que **toda la fila de la tabla sea cliqueable**. Al hacer clic en cualquier colaborador (tanto en modo tabla como en modo tarjetas), se abre la **Ficha del Colaborador** integral con sus datos de contacto, nivel jerárquico, superior inmediato en el organigrama, tipo de autenticación (LDAP/Local), permisos y botón de reseteo de contraseña.
- **Archivos involucrados:**  
  - [`apps/OpenSign/src/pages/UserList.jsx`](file:///c:/Users/leandro.valdes/Desktop/Proyectos/OpenSign/apps/OpenSign/src/pages/UserList.jsx).
- **Estado:** Optimizado y unificado en el modal de detalle del usuario.

---

### 8. Protección y Fallback de Fotos de Perfil (Avatar 404)

- **¿Qué es?**  
  Mecanismo de seguridad en la carga de avatares de usuario. Si una imagen remota almacenada en la base de datos ya no existe en el disco del servidor (generando error HTTP 404), la interfaz se recupera instantáneamente.
- **Implementación:**  
  - Se agregó `onError` en `Header.jsx`, `Sidebar.jsx` y `UserProfile.jsx` para sustituir automáticamente la imagen fallida por el avatar predeterminado de la aplicación (`dp.png`) y limpiar la clave obsoleta en `localStorage`.
- **Archivos involucrados:**  
  - [`apps/OpenSign/src/components/Header.jsx`](file:///c:/Users/leandro.valdes/Desktop/Proyectos/OpenSign/apps/OpenSign/src/components/Header.jsx).
  - [`apps/OpenSign/src/components/sidebar/Sidebar.jsx`](file:///c:/Users/leandro.valdes/Desktop/Proyectos/OpenSign/apps/OpenSign/src/components/sidebar/Sidebar.jsx).
  - [`apps/OpenSign/src/pages/UserProfile.jsx`](file:///c:/Users/leandro.valdes/Desktop/Proyectos/OpenSign/apps/OpenSign/src/pages/UserProfile.jsx).

---

*Última actualización: Noviembre 2026 — Sistema de Firma Digital Brascuba S.A.*
