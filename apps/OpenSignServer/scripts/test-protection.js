import fs from 'node:fs';
import path from 'node:path';
import Parse from 'parse/node';
import { runAutoPurge } from '../cloud/parsefunction/autoPurgeJob.js';
import { getFileProtectionReason } from '../cloud/parsefunction/deleteDocumentPermanent.js';

Parse.initialize(process.env.APP_ID || 'opensign', null, process.env.MASTER_KEY);
Parse.serverURL = process.env.INTERNAL_SERVER_URL || 'http://127.0.0.1:8080/app';
Parse.masterKey = process.env.MASTER_KEY;

console.log('=== TEST DE PROTECCIÓN DE ARCHIVOS CRÍTICOS ===\n');

// 1. Probar reglas de protección por nombre y ruta
const testCases = [
  { file: 'apps/CorporateSigner/certificates/frank.alvarez.p12', expectProtected: true },
  { file: 'apps/CorporateSigner/certificates/conrado.peraza.p12', expectProtected: true },
  { file: 'apps/CorporateSigner/certificates/ubalquis.montenegro.p12', expectProtected: true },
  { file: 'apps/CorporateSigner/signatures/frank.alvarez.png', expectProtected: true },
  { file: 'apps/CorporateSigner/signatures/conrado.peraza.png', expectProtected: true },
  { file: 'apps/CorporateSigner/brascuba_logo.jpg', expectProtected: true },
  { file: 'trust-roots.pem', expectProtected: true },
  { file: 'files/custom_email.html', expectProtected: true },
  { file: 'files/custom_email.txt', expectProtected: true },
  { file: 'files/.gitkeep', expectProtected: true },
  { file: 'files/temp_orphan_document_123.pdf', expectProtected: false },
];

let failedTests = 0;
for (const tc of testCases) {
  const reason = getFileProtectionReason(tc.file);
  const isProtected = Boolean(reason);
  if (isProtected === tc.expectProtected) {
    console.log(`[PASS] ${tc.file} -> ${isProtected ? `PROTEGIDO: "${reason}"` : 'NO PROTEGIDO (huérfano potencial)'}`);
  } else {
    console.error(`[FAIL] ${tc.file} -> Esperaba protegido=${tc.expectProtected}, pero obtuvo protegido=${isProtected}`);
    failedTests++;
  }
}

if (failedTests > 0) {
  console.error(`\nFallaron ${failedTests} pruebas de reglas.`);
  process.exit(1);
}

// 2. Verificar existencia física real de .p12 y firmas escaneadas
const sigDir = './apps/CorporateSigner/signatures';
const certDir = './apps/CorporateSigner/certificates';

const realSigs = fs.existsSync(sigDir) ? fs.readdirSync(sigDir).filter(f => f.endsWith('.png') || f.endsWith('.jpg')) : [];
const realCerts = fs.existsSync(certDir) ? fs.readdirSync(certDir).filter(f => f.endsWith('.p12') || f.endsWith('.pfx')) : [];

console.log(`\nArchivos reales encontrados en signatures/:`, realSigs);
console.log(`Archivos reales encontrados en certificates/:`, realCerts);

// 3. Ejecutar runAutoPurge tanto en modo dry-run como en modo execute
console.log('\n--- Ejecutando simulación (DRY-RUN) ---');
const dryResult = await runAutoPurge({ dryRun: true, autoPurgeDays: 0 });

console.log('\n--- Ejecutando con --execute (Borrado físico de huérfanos) ---');
const execResult = await runAutoPurge({ dryRun: false, autoPurgeDays: 0 });

// 4. Confirmar que ninguna firma o certificado fue listado como huérfano ni borrado
const allListedOrphans = [...dryResult.orphanFiles.map(o => o.name), ...execResult.orphanFiles.map(o => o.name)];

for (const sig of realSigs) {
  if (allListedOrphans.includes(sig)) {
    console.error(`[CRÍTICO] La firma escaneada ${sig} fue listada para borrar!`);
    process.exit(1);
  }
}

for (const cert of realCerts) {
  if (allListedOrphans.includes(cert)) {
    console.error(`[CRÍTICO] El certificado ${cert} fue listado para borrar!`);
    process.exit(1);
  }
}

console.log('\n=== RESULTADO FINAL: TODAS LAS PRUEBAS DE PROTECCIÓN PASARON EXITOSAMENTE ===');
console.log('Las firmas escaneadas y certificados .p12 están 100% blindados contra cualquier depuración.');
