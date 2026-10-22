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
Para construir y levantar todos los servicios en segundo plano:
```bash
docker compose up -d
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

## 🔒 Consideraciones de Seguridad

* **Aislamiento de Red:** Los servicios internos (MongoDB, Parse Server y Corporate Signer) operan dentro de una red privada virtual de Docker (`app-network`). El acceso externo se canaliza únicamente a través del proxy HTTPS.
* **Protección de Claves y Secretos:** Las claves maestras, cadenas de conexión, certificados de firma digital (`.p12`, `.pem`, `.key`) y archivos `.env` están rigurosamente excluidos del control de versiones.
* **Privacidad y Autonomía:** El sistema opera de manera 100% autónoma, sin telemetría ni comunicación obligatoria con servidores externos o de terceros.
