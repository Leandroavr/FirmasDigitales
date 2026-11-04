#!/usr/bin/env bash
# ==============================================================================
# Script de Respaldo para OpenSign Brascuba (Bash / Linux)
# ==============================================================================
# Uso:
#   ./scripts/backup.sh [/ruta/backups] [N_a_conservar] [password_opcional]
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
KEEP_LAST="${2:-7}"
PASSWORD="${3:-}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
TARGET_DIR="${BACKUP_DIR}/backup_${TIMESTAMP}"

echo "================================================="
echo "Iniciando respaldo de OpenSign Brascuba [${TIMESTAMP}]"
echo "Directorio destino: ${TARGET_DIR}"
echo "================================================="

mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"
mkdir -p "${TARGET_DIR}"

# 1. Respaldo de Base de Datos MongoDB
echo "[1/4] Respaldando base de datos MongoDB..."
if docker exec mongo-container mongodump --archive > "${TARGET_DIR}/mongo_dump.archive"; then
    echo " -> Base de datos respaldada correctamente."
else
    echo " [ADVERTENCIA] Error respaldando MongoDB."
fi

# 2. Respaldo de Archivos de Almacenamiento (opensign-files)
echo "[2/4] Respaldando archivos de documentos (opensign-files)..."
if docker cp OpenSignServer-container:/usr/src/app/files "${TARGET_DIR}/files"; then
    echo " -> Archivos del servidor respaldados correctamente."
else
    echo " [ADVERTENCIA] Error copiando archivos del servidor."
fi

# 3. Respaldo de Certificados Digitales (.p12) y Raíces
echo "[3/4] Respaldando certificados digitales y raíces de confianza..."
mkdir -p "${TARGET_DIR}/certificates"
if [ -d "./apps/CorporateSigner/certificates" ]; then
    cp -r ./apps/CorporateSigner/certificates/* "${TARGET_DIR}/certificates/" || true
fi
if [ -f "./trust-roots.pem" ]; then
    cp ./trust-roots.pem "${TARGET_DIR}/" || true
fi

# 4. Respaldo de Rúbricas Escaneadas y Logos
echo "[4/4] Respaldando firmas escaneadas de usuarios y logos..."
mkdir -p "${TARGET_DIR}/signatures"
if [ -d "./apps/CorporateSigner/signatures" ]; then
    cp -r ./apps/CorporateSigner/signatures/* "${TARGET_DIR}/signatures/" || true
fi
if [ -f "./apps/CorporateSigner/brascuba_logo.jpg" ]; then
    cp ./apps/CorporateSigner/brascuba_logo.jpg "${TARGET_DIR}/" || true
fi

# 5. Comprimir y proteger paquete de respaldo
ARCHIVE_FILE="${TARGET_DIR}.tar.gz"
echo "Comprimiendo respaldo en ${ARCHIVE_FILE}..."
tar -czf "${ARCHIVE_FILE}" -C "${BACKUP_DIR}" "backup_${TIMESTAMP}"
rm -rf "${TARGET_DIR}"
chmod 600 "${ARCHIVE_FILE}"

if [ -n "${PASSWORD}" ] && command -v gpg >/dev/null 2>&1; then
    echo "Cifrando paquete con GPG..."
    gpg --batch --yes --passphrase "${PASSWORD}" -c "${ARCHIVE_FILE}"
    rm -f "${ARCHIVE_FILE}"
    ARCHIVE_FILE="${ARCHIVE_FILE}.gpg"
    chmod 600 "${ARCHIVE_FILE}"
    echo "Respaldo cifrado generado: ${ARCHIVE_FILE}"
else
    echo "Respaldo generado con permisos 600: ${ARCHIVE_FILE}"
fi

# 6. Rotación de respaldos antiguos (Conservar los últimos N)
echo "Aplicando rotación de respaldos (Conservar últimos ${KEEP_LAST})..."
ls -1t "${BACKUP_DIR}"/backup_* 2>/dev/null | tail -n +"$((KEEP_LAST + 1))" | while read -r old_backup; do
    echo " Eliminando respaldo antiguo: ${old_backup}"
    rm -f "${old_backup}"
done

echo "================================================="
echo "Respaldo completado satisfactoriamente."
echo "================================================="
