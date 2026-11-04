# Sistema de Firmas Digitales

Plataforma corporativa de firma digital y gestión de documentos electrónicos, desplegada de forma autónoma y segura en infraestructura propia.

---

## 🚀 Arquitectura y Componentes

El sistema se compone de los siguientes microservicios orquestados mediante Docker Compose:

* **Cliente Web (`client`)**: Interfaz de usuario para carga, configuración, asignación de campos y firma de documentos electrónicos.
* **Servidor Central (`server`)**: Backend API para autenticación, gestión de expedientes, estados de firma y auditoría.
* **Firmador Corporativo (`corporate-signer`)**: Microservicio Python dedicado a la validación de certificados digitales (PKCS#12 / `.p12`), aplicación de firmas criptográficas y sellado de tiempo (TSA).
* **Base de Datos (`mongo`)**: Repositorio de base de datos no relacional para persistencia de metadatos y trazabilidad.
* **Proxy Inverso (`caddy`)**: Puerta de enlace con terminación SSL/TLS (HTTPS) y enrutamiento interno seguro hacia los servicios de frontend y backend.

---

## 🛠️ Puesta en Marcha (Despliegue)

### Requisitos previos
* [Docker](https://docs.docker.com/get-docker/) y [Docker Compose](https://docs.docker.com/compose/) instalados en el servidor anfitrión.

### 1. Configuración de Entorno
Copia el archivo de variables de ejemplo y define las contraseñas y claves maestras seguras para el entorno de producción:
```bash
cp .env.example .env.prod
```

> **Importante:** Asegúrate de configurar valores robustos y únicos para `MASTER_KEY`, `APP_ID`, `CORPORATE_SIGNER_TOKEN` y los accesos a la base de datos.

### 2. Despliegue de Contenedores

#### Modo Desarrollo:
Publica puertos hacia el host (MongoDB en 27017, Parse Server en 8080, CorporateSigner en 8090, Frontend en 3000, Caddy en 3001):
```bash
docker compose up -d
```

#### Modo Producción (Recomendado para Servidor Brascuba):
En este entorno **SOLO Caddy** publica puertos hacia el host exterior (80, 443, 3001). MongoDB, Parse Server, CorporateSigner y Frontend quedan confinados estrictamente en la red interna de Docker (`app-network`).
```bash
# Despliegue directo en producción:
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d

# O combinando con docker-compose.yml (los puertos de desarrollo quedan anulados con ports: !override []):
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.prod up -d
```

### 3. Verificación de Estado
Para revisar el estado de los contenedores:
```bash
docker compose ps
```

Para consultar los registros de eventos (logs):
```bash
docker compose logs -f
```

---

## 🧹 Limpieza de Huérfanos y Depuración Automática

El sistema incluye un script autónomo de depuración para eliminar archivos físicos huérfanos y aplicar retención de documentos. Protege estrictamente certificados (`.p12`), rúbricas escaneadas (`signatures/`), logos y archivos en período de gracia (24 horas por defecto).

* **Simulación / Prueba protegida (DRY-RUN, no borra nada):**
  ```bash
  docker exec -it OpenSignServer-container node scripts/auto-purge.js
  ```

* **Ejecución real de borrado físico:**
  ```bash
  docker exec -it OpenSignServer-container node scripts/auto-purge.js --execute
  ```

* **Depurar documentos antiguos y huérfanos con retención personalizada (ej. 30 días y 12h de gracia):**
  ```bash
  docker exec -it OpenSignServer-container node scripts/auto-purge.js --execute --days=30 --grace-hours=12
  ```

---

## 💾 Respaldos y Restauración

Los respaldos incluyen la base de datos MongoDB completa (`mongodump --archive`), los documentos físicos almacenados (`opensign-files`), los certificados digitales (`.p12`), las firmas escaneadas (`signatures/`) y las raíces de confianza (`trust-roots.pem`). Además, restringen automáticamente los permisos de lectura/escritura a nivel del sistema operativo.

### Realizar un Respaldo:
* **Windows (PowerShell):**
  ```powershell
  # Respaldo estándar con permisos NTFS restringidos:
  .\scripts\backup.ps1

  # Respaldo cifrado con contraseña (requiere 7-Zip en PATH):
  .\scripts\backup.ps1 -Password "MiClaveSegura123"
  ```
* **Linux (Bash):**
  ```bash
  ./scripts/backup.sh ./backups 7 "MiClaveSegura123"
  ```

### Restaurar un Respaldo:
* **Windows (PowerShell):**
  ```powershell
  .\scripts\restore.ps1 -BackupZip ".\backups\backup_20261102_120000.zip"
  ```
* **Linux (Bash):**
  ```bash
  ./scripts/restore.sh ./backups/backup_20261102_120000.tar.gz "MiClaveSegura123"
  ```

---

## 🔒 Consideraciones de Seguridad

* **Aislamiento de Red:** Los servicios internos (MongoDB, Parse Server y Corporate Signer) operan dentro de una red privada virtual de Docker (`app-network`). El acceso externo se canaliza únicamente a través del proxy HTTPS.
* **Protección de Claves y Secretos:** Las claves maestras, cadenas de conexión, certificados de firma digital (`.p12`, `.pem`, `.key`) y archivos `.env` están rigurosamente excluidos del control de versiones.
* **Privacidad y Autonomía:** El sistema opera de manera 100% autónoma, sin telemetría ni comunicación obligatoria con servidores externos o de terceros.
