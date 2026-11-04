#!/usr/bin/env node
// ==============================================================================
// Script CLI de Depuración y Limpieza de Huérfanos - OpenSign Brascuba
// ==============================================================================
// Uso:
//   node scripts/auto-purge.js                (Modo DRY-RUN por defecto)
//   node scripts/auto-purge.js --execute      (Modo EJECUCIÓN REAL de borrado)
//   node scripts/auto-purge.js --execute --days=30  (Depura también docs > 30 días)
// ==============================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import Parse from 'parse/node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env.prod'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const serverUrl = process.env.INTERNAL_SERVER_URL || 'http://127.0.0.1:8080/app';
const appId = process.env.APP_ID || 'opensign';
const masterKey = process.env.MASTER_KEY;

if (!masterKey) {
  console.error('[AutoPurge CLI] Error: MASTER_KEY no está configurada en las variables de entorno.');
  process.exit(1);
}

Parse.initialize(appId, null, masterKey);
Parse.serverURL = serverUrl;
Parse.masterKey = masterKey;

const args = process.argv.slice(2);
const isExecute = args.includes('--execute') || process.env.DRY_RUN === 'false';
const dryRun = !isExecute;

let autoPurgeDays = parseInt(process.env.AUTO_PURGE_DAYS || '0', 10);
const daysArg = args.find(a => a.startsWith('--days='));
if (daysArg) {
  autoPurgeDays = parseInt(daysArg.split('=')[1], 10) || 0;
}

console.log('================================================================');
console.log('OpenSign Brascuba - Limpieza de Huérfanos y Depuración Automática');
console.log(`Modo: ${dryRun ? 'DRY-RUN (Simulación protegida, no borra nada)' : 'EJECUCIÓN REAL (Borrado físico)'}`);
console.log(`Días de retención para documentos antiguos: ${autoPurgeDays > 0 ? autoPurgeDays : 'Desactivado (0)'}`);
console.log('================================================================');

try {
  const { runAutoPurge } = await import('../apps/OpenSignServer/cloud/parsefunction/autoPurgeJob.js');
  const result = await runAutoPurge({ dryRun, autoPurgeDays });

  console.log('\n--- RESUMEN FINAL ---');
  console.log(`Huérfanos detectados: ${result.orphansFound} (${(result.orphanBytesFreed / (1024 * 1024)).toFixed(2)} MB)`);
  if (!dryRun) {
    console.log(`Huérfanos eliminados físicamente: ${result.orphansDeleted}`);
    console.log(`Documentos antiguos depurados: ${result.oldDocsPurged}`);
  } else {
    console.log(`Para ejecutar el borrado real de estos archivos, ejecute: node scripts/auto-purge.js --execute`);
  }
} catch (err) {
  console.error('[AutoPurge CLI] Falló el proceso:', err);
  process.exit(1);
}
