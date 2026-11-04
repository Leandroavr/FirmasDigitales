# ==============================================================================
# Script de Respaldo para OpenSign Brascuba (PowerShell / Windows)
# ==============================================================================
# Uso:
#   .\scripts\backup.ps1 [-BackupDir ".\backups"] [-KeepLast 7] [-Password "secreto"]
# ==============================================================================

param (
    [string]$BackupDir = ".\backups",
    [int]$KeepLast = 7,
    [string]$Password = ""
)

$ErrorActionPreference = "Stop"

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$TargetDir = Join-Path $BackupDir "backup_$Timestamp"

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "Iniciando respaldo de OpenSign Brascuba [$Timestamp]" -ForegroundColor Cyan
Write-Host "Directorio destino: $TargetDir" -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan

if (!(Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

# Restringir permisos de la carpeta de respaldos (Solo el usuario actual y Administradores locales)
try {
    icacls $BackupDir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" "*S-1-5-32-544:(OI)(CI)F" | Out-Null
    Write-Host " -> Permisos NTFS restringidos a $env:USERNAME." -ForegroundColor Green
} catch {
    Write-Host " [ADVERTENCIA] No se pudieron aplicar permisos con icacls: $_" -ForegroundColor DarkGray
}

if (!(Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}

# 1. Respaldo de Base de Datos MongoDB
Write-Host "[1/5] Respaldando base de datos MongoDB..." -ForegroundColor Yellow
$MongoArchive = Join-Path $TargetDir "mongo_dump.archive"
try {
    docker exec mongo-container mongodump --archive=/tmp/mongo_dump.archive | Out-Null
    docker cp mongo-container:/tmp/mongo_dump.archive $MongoArchive
    docker exec mongo-container rm -f /tmp/mongo_dump.archive | Out-Null
    Write-Host " -> Base de datos respaldada correctamente en $MongoArchive" -ForegroundColor Green
} catch {
    Write-Host " [ADVERTENCIA] Error respaldando MongoDB: $_" -ForegroundColor Red
}

# 2. Respaldo de Archivos de Almacenamiento (opensign-files)
Write-Host "[2/5] Respaldando archivos de documentos (opensign-files)..." -ForegroundColor Yellow
$FilesTarget = Join-Path $TargetDir "files"
try {
    docker cp OpenSignServer-container:/usr/src/app/files $FilesTarget
    Write-Host " -> Archivos copiados correctamente a $FilesTarget" -ForegroundColor Green
} catch {
    Write-Host " [ADVERTENCIA] Error copiando archivos del servidor: $_" -ForegroundColor Red
}

# 3. Respaldo de Certificados Digitales (.p12)
Write-Host "[3/5] Respaldando certificados digitales y raíces de confianza..." -ForegroundColor Yellow
$CertsTarget = Join-Path $TargetDir "certificates"
try {
    if (Test-Path ".\apps\CorporateSigner\certificates") {
        Copy-Item -Path ".\apps\CorporateSigner\certificates" -Destination $CertsTarget -Recurse -Force
        Write-Host " -> Certificados respaldados correctamente a $CertsTarget" -ForegroundColor Green
    }
    if (Test-Path ".\trust-roots.pem") {
        Copy-Item -Path ".\trust-roots.pem" -Destination $TargetDir -Force
    }
} catch {
    Write-Host " [ADVERTENCIA] Error copiando certificados: $_" -ForegroundColor Red
}

# 4. Respaldo de Rúbricas / Firmas Escaneadas y Logos (Punto 0 y 6)
Write-Host "[4/5] Respaldando firmas escaneadas de usuarios y logos..." -ForegroundColor Yellow
$SigsTarget = Join-Path $TargetDir "signatures"
try {
    if (Test-Path ".\apps\CorporateSigner\signatures") {
        Copy-Item -Path ".\apps\CorporateSigner\signatures" -Destination $SigsTarget -Recurse -Force
        Write-Host " -> Firmas escaneadas respaldadas correctamente a $SigsTarget" -ForegroundColor Green
    }
    if (Test-Path ".\apps\CorporateSigner\brascuba_logo.jpg") {
        Copy-Item -Path ".\apps\CorporateSigner\brascuba_logo.jpg" -Destination $TargetDir -Force
    }
} catch {
    Write-Host " [ADVERTENCIA] Error copiando firmas escaneadas: $_" -ForegroundColor Red
}

# 5. Comprimir y opcionalmente cifrar el respaldo
Write-Host "[5/5] Comprimiendo paquete de respaldo..." -ForegroundColor Yellow
$ZipFile = "$TargetDir.zip"

$7zCmd = Get-Command 7z -ErrorAction SilentlyContinue
$7zPath = if ($7zCmd) { $7zCmd.Source } else { $null }
if (!$7zPath -and (Test-Path "C:\Program Files\7-Zip\7z.exe")) {
    $7zPath = "C:\Program Files\7-Zip\7z.exe"
}

if ($Password -and $7zPath) {
    Write-Host " Cifrando ZIP con contraseña usando 7-Zip (AES-256)..." -ForegroundColor Cyan
    & $7zPath a -tzip -p"$Password" -mem=AES256 "$ZipFile" "$TargetDir\*" | Out-Null
    Remove-Item -Path $TargetDir -Recurse -Force
    Write-Host " -> Respaldo cifrado generado con éxito: $ZipFile" -ForegroundColor Green
} else {
    if ($Password -and !$7zPath) {
        Write-Host " [NOTA] 7-Zip no está en PATH; comprimiendo con Compress-Archive estándar y permisos NTFS restringidos." -ForegroundColor Yellow
    }
    Compress-Archive -Path "$TargetDir\*" -DestinationPath $ZipFile -Force
    Remove-Item -Path $TargetDir -Recurse -Force
    Write-Host " -> Respaldo generado con éxito: $ZipFile" -ForegroundColor Green
}

# Restringir permisos en el archivo ZIP resultante
try {
    icacls $ZipFile /inheritance:r /grant:r "$($env:USERNAME):F" "*S-1-5-32-544:F" | Out-Null
} catch {}

# 6. Rotación de respaldos antiguos (Conservar los últimos N)
Write-Host "Aplicando rotación de respaldos (Conservar últimos $KeepLast)..." -ForegroundColor Yellow
$AllBackups = Get-ChildItem -Path $BackupDir -Filter "backup_*.zip" | Sort-Object CreationTime -Descending
if ($AllBackups.Count -gt $KeepLast) {
    $BackupsToDelete = $AllBackups | Select-Object -Skip $KeepLast
    foreach ($oldBackup in $BackupsToDelete) {
        Write-Host " Eliminando respaldo antiguo: $($oldBackup.FullName)" -ForegroundColor DarkGray
        Remove-Item -Path $oldBackup.FullName -Force
    }
}

Write-Host "=================================================" -ForegroundColor Cyan
Write-Host "Respaldo completado satisfactoriamente." -ForegroundColor Cyan
Write-Host "=================================================" -ForegroundColor Cyan
