# ==============================================================================
# Script de Restauración para OpenSign Brascuba (PowerShell / Windows)
# ==============================================================================
# Uso:
#   .\scripts\restore.ps1 -BackupZip ".\backups\backup_20261102_120000.zip" [-Password "secreto"]
# ==============================================================================

param (
    [Parameter(Mandatory=$true)]
    [string]$BackupZip,
    [string]$Password = ""
)

$ErrorActionPreference = "Stop"

if (!(Test-Path $BackupZip)) {
    Write-Error "El archivo de respaldo '$BackupZip' no existe."
    exit 1
}

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "opensign_restore_$Timestamp"

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "Iniciando Restauración de OpenSign Brascuba" -ForegroundColor Cyan
Write-Host "Archivo origen: $BackupZip" -ForegroundColor Cyan
Write-Host "Directorio temporal: $TempDir" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

try {
    # 1. Descomprimir el archivo ZIP
    Write-Host "[1/5] Descomprimiendo archivo de respaldo..." -ForegroundColor Yellow
    $7zCmd = Get-Command 7z -ErrorAction SilentlyContinue
    $7zPath = if ($7zCmd) { $7zCmd.Source } else { $null }
    if (!$7zPath -and (Test-Path "C:\Program Files\7-Zip\7z.exe")) {
        $7zPath = "C:\Program Files\7-Zip\7z.exe"
    }

    if ($Password -and $7zPath) {
        Write-Host " Extrayendo con 7-Zip..." -ForegroundColor Cyan
        & $7zPath x -p"$Password" -o"$TempDir" "$BackupZip" -y | Out-Null
    } else {
        Expand-Archive -Path $BackupZip -DestinationPath $TempDir -Force
    }

    # 2. Restaurar Base de Datos MongoDB
    Write-Host "[2/5] Restaurando base de datos MongoDB..." -ForegroundColor Yellow
    $MongoArchive = Join-Path $TempDir "mongo_dump.archive"
    if (Test-Path $MongoArchive) {
        docker cp $MongoArchive mongo-container:/tmp/restore_mongo.archive
        docker exec mongo-container mongorestore --archive=/tmp/restore_mongo.archive --drop
        docker exec mongo-container rm -f /tmp/restore_mongo.archive | Out-Null
        Write-Host " -> Base de datos MongoDB restaurada con éxito (con flag --drop)." -ForegroundColor Green
    } else {
        Write-Host " [ADVERTENCIA] No se encontró mongo_dump.archive en el respaldo." -ForegroundColor Yellow
    }

    # 3. Restaurar Almacenamiento de Archivos (opensign-files)
    Write-Host "[3/5] Restaurando almacenamiento de archivos físicos..." -ForegroundColor Yellow
    $FilesDir = Join-Path $TempDir "files"
    if (Test-Path $FilesDir) {
        docker cp "$FilesDir\." OpenSignServer-container:/usr/src/app/files/
        Write-Host " -> Archivos de documentos copiados al contenedor OpenSignServer-container." -ForegroundColor Green
    } else {
        Write-Host " [ADVERTENCIA] No se encontró la carpeta 'files' en el respaldo." -ForegroundColor Yellow
    }

    # 4. Restaurar Certificados Digitales (.p12)
    Write-Host "[4/5] Restaurando certificados digitales y raíces de confianza..." -ForegroundColor Yellow
    $CertsDir = Join-Path $TempDir "certificates"
    if (Test-Path $CertsDir) {
        if (!(Test-Path ".\apps\CorporateSigner\certificates")) {
            New-Item -ItemType Directory -Path ".\apps\CorporateSigner\certificates" -Force | Out-Null
        }
        Copy-Item -Path "$CertsDir\*" -Destination ".\apps\CorporateSigner\certificates\" -Recurse -Force
        Write-Host " -> Certificados restaurados a .\apps\CorporateSigner\certificates\" -ForegroundColor Green
    }
    $RootsFile = Join-Path $TempDir "trust-roots.pem"
    if (Test-Path $RootsFile) {
        Copy-Item -Path $RootsFile -Destination ".\trust-roots.pem" -Force
        Write-Host " -> trust-roots.pem restaurado en la raíz del proyecto." -ForegroundColor Green
    }

    # 5. Restaurar Rúbricas Escaneadas y Logos
    Write-Host "[5/5] Restaurando rúbricas escaneadas y branding..." -ForegroundColor Yellow
    $SigsDir = Join-Path $TempDir "signatures"
    if (Test-Path $SigsDir) {
        if (!(Test-Path ".\apps\CorporateSigner\signatures")) {
            New-Item -ItemType Directory -Path ".\apps\CorporateSigner\signatures" -Force | Out-Null
        }
        Copy-Item -Path "$SigsDir\*" -Destination ".\apps\CorporateSigner\signatures\" -Recurse -Force
        Write-Host " -> Firmas escaneadas restauradas a .\apps\CorporateSigner\signatures\" -ForegroundColor Green
    }
    $LogoFile = Join-Path $TempDir "brascuba_logo.jpg"
    if (Test-Path $LogoFile) {
        Copy-Item -Path $LogoFile -Destination ".\apps\CorporateSigner\brascuba_logo.jpg" -Force
    }

    # Reiniciar contenedores para aplicar cambios
    Write-Host "Reiniciando servicios Docker para refrescar estado..." -ForegroundColor Yellow
    docker restart OpenSignServer-container OpenSignCorporateSigner-container | Out-Null

    Write-Host "=================================================" -ForegroundColor Cyan
    Write-Host "Restauración completada satisfactoriamente." -ForegroundColor Green
    Write-Host "Todos los datos, archivos y certificados están listos." -ForegroundColor Green
    Write-Host "=================================================" -ForegroundColor Cyan
} finally {
    if (Test-Path $TempDir) {
        Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
