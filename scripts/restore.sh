#!/usr/bin/env bash
# ==============================================================================
# Script de Restauración para OpenSign Brascuba (Bash / Linux)
# ==============================================================================
# Uso:
#   ./scripts/restore.sh /ruta/al/backup_YYYYMMDD_HHMMSS.tar.gz [password_opcional]
# ==============================================================================

set -euo pipefail

ARCHIVE_PATH="${1:-}"
PASSWORD="${2:-}"

if [ -z "${ARCHIVE_PATH}" ] || [ ! -f "${ARCHIVE_PATH}" ]; then
    echo "Error: Debe indicar un archivo de respaldo válido existente."
    echo "Uso: ./scripts/restore.sh <archivo_backup> [password]"
    exit 1
fi

TEMP_DIR=$(mktemp -d /tmp/opensign_restore_XXXXXX)
trap 'rm -rf "${TEMP_DIR}"' EXIT

echo "================================================="
echo "Iniciando Restauración de OpenSign Brascuba"
echo "Archivo origen: ${ARCHIVE_PATH}"
echo "Directorio temporal: ${TEMP_DIR}"
echo "================================================="

# 1. Descomprimir (o descifrar) el archivo
TAR_TARGET="${ARCHIVE_PATH}"
if [[ "${ARCHIVE_PATH}" == *.gpg ]]; then
    echo "[1/5] Descifrando paquete con GPG..."
    TAR_TARGET="${TEMP_DIR}/backup.tar.gz"
    gpg --batch --yes --passphrase "${PASSWORD}" -o "${TAR_TARGET}" -d "${ARCHIVE_PATH}"
fi

echo "[1/5] Extrayendo contenido del respaldo..."
tar -xzf "${TAR_TARGET}" -C "${TEMP_DIR}"
EXTRACTED_DIR=$(find "${TEMP_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)

# 2. Restaurar Base de Datos MongoDB
echo "[2/5] Restaurando base de datos MongoDB..."
if [ -f "${EXTRACTED_DIR}/mongo_dump.archive" ]; then
    docker exec -i mongo-container mongorestore --archive --drop < "${EXTRACTED_DIR}/mongo_dump.archive"
    echo " -> Base de datos MongoDB restaurada (--drop aplicado)."
else
    echo " [ADVERTENCIA] No se encontró mongo_dump.archive en el respaldo."
fi

# 3. Restaurar Almacenamiento de Archivos (opensign-files)
echo "[3/5] Restaurando archivos físicos de documentos..."
if [ -d "${EXTRACTED_DIR}/files" ]; then
    docker cp "${EXTRACTED_DIR}/files/." OpenSignServer-container:/usr/src/app/files/
    echo " -> Archivos copiados a OpenSignServer-container."
fi

# 4. Restaurar Certificados Digitales (.p12) y Raíces
echo "[4/5] Restaurando certificados digitales..."
if [ -d "${EXTRACTED_DIR}/certificates" ]; then
    mkdir -p ./apps/CorporateSigner/certificates
    cp -r "${EXTRACTED_DIR}/certificates"/* ./apps/CorporateSigner/certificates/ 2>/dev/null || true
    echo " -> Certificados restaurados a ./apps/CorporateSigner/certificates/"
fi
if [ -f "${EXTRACTED_DIR}/trust-roots.pem" ]; then
    cp "${EXTRACTED_DIR}/trust-roots.pem" ./trust-roots.pem
    echo " -> trust-roots.pem restaurado."
fi

# 5. Restaurar Rúbricas Escaneadas y Logos
echo "[5/5] Restaurando rúbricas escaneadas y logos..."
if [ -d "${EXTRACTED_DIR}/signatures" ]; then
    mkdir -p ./apps/CorporateSigner/signatures
    cp -r "${EXTRACTED_DIR}/signatures"/* ./apps/CorporateSigner/signatures/ 2>/dev/null || true
    echo " -> Firmas escaneadas restauradas a ./apps/CorporateSigner/signatures/"
fi
if [ -f "${EXTRACTED_DIR}/brascuba_logo.jpg" ]; then
    cp "${EXTRACTED_DIR}/brascuba_logo.jpg" ./apps/CorporateSigner/brascuba_logo.jpg
fi

echo "Reiniciando servicios Docker para refrescar el estado..."
docker restart OpenSignServer-container OpenSignCorporateSigner-container >/dev/null

echo "================================================="
echo "Restauración completada satisfactoriamente."
echo "================================================="
