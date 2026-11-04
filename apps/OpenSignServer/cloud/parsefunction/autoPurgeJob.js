import fs from 'node:fs';
import path from 'node:path';
import Parse from 'parse/node';
import deleteDocumentPermanent, { getFileProtectionReason } from './deleteDocumentPermanent.js';

function getFilenameFromUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return null;
  try {
    const cleanUrl = urlStr.split('?')[0];
    let pathname = cleanUrl;
    try {
      const parsed = new URL(cleanUrl);
      pathname = parsed.pathname;
    } catch (_) {}
    return path.basename(pathname) || null;
  } catch (_) {
    return null;
  }
}

/**
 * Recopila todos los archivos referenciados en Parse consultando el _SCHEMA
 * para descubrir todas las clases con campos tipo File, más los campos URL/File conocidos.
 */
async function getAllReferencedFiles() {
  const referencedFilenames = new Set();

  try {
    // 1. Consultar schemas de Parse para identificar clases y campos tipo File
    let schemas = [];
    try {
      schemas = await Parse.Schema.all();
    } catch (sErr) {
      console.warn('[AutoPurge] Advertencia obteniendo Parse.Schema.all():', sErr.message);
    }

    // Mapa de clases -> lista de campos a inspeccionar
    const classFieldsMap = new Map();

    for (const schema of schemas) {
      const cls = schema.className;
      if (cls.startsWith('_Join:') || cls === '_Session') continue;
      const fileFields = [];
      for (const [fieldName, fieldDef] of Object.entries(schema.fields || {})) {
        if (fieldDef.type === 'File') {
          fileFields.push(fieldName);
        } else if (
          /^(URL|SignedUrl|CertificateUrl|Logo|Favicon|ProfilePic|ImageURL|FileUrl|Stamp)$/i.test(fieldName)
        ) {
          fileFields.push(fieldName);
        }
      }
      if (fileFields.length > 0) {
        classFieldsMap.set(cls, fileFields);
      }
    }

    // Garantizar que clases clave siempre se consulten
    if (!classFieldsMap.has('contracts_Document')) {
      classFieldsMap.set('contracts_Document', ['URL', 'SignedUrl', 'CertificateUrl', 'AuditTrail']);
    } else {
      const fields = classFieldsMap.get('contracts_Document');
      if (!fields.includes('AuditTrail')) fields.push('AuditTrail');
    }
    if (!classFieldsMap.has('contracts_Template')) {
      classFieldsMap.set('contracts_Template', ['URL']);
    }
    if (!classFieldsMap.has('partners_Tenant')) {
      classFieldsMap.set('partners_Tenant', ['Logo']);
    }
    if (!classFieldsMap.has('contracts_Signature')) {
      classFieldsMap.set('contracts_Signature', ['ImageURL', 'Stamp']);
    }

    // 2. Consultar cada clase y extraer nombres de archivo
    for (const [className, fields] of classFieldsMap.entries()) {
      try {
        const query = new Parse.Query(className);
        if (className === 'contracts_Document') {
          query.notEqualTo('IsPurged', true);
        }
        query.select(...fields);
        query.limit(5000);
        const records = await query.find({ useMasterKey: true });

        for (const record of records) {
          for (const field of fields) {
            const val = record.get(field);
            if (!val) continue;

            if (field === 'AuditTrail' && Array.isArray(val)) {
              for (const entry of val) {
                if (entry?.SignedUrl) {
                  const fn = getFilenameFromUrl(entry.SignedUrl);
                  if (fn) referencedFilenames.add(fn);
                }
              }
            } else if (typeof val === 'string') {
              const fn = getFilenameFromUrl(val);
              if (fn) referencedFilenames.add(fn);
            } else if (val && typeof val === 'object') {
              const url = val.url ? (typeof val.url === 'function' ? val.url() : val.url) : val.name;
              const fn = getFilenameFromUrl(url) || val.name;
              if (fn) referencedFilenames.add(fn);
            }
          }
        }
      } catch (clsErr) {
        console.warn(`[AutoPurge] Advertencia consultando clase ${className}:`, clsErr.message);
      }
    }
  } catch (err) {
    console.error('[AutoPurge] Error recopilando referencias de archivos en BD:', err);
  }

  return referencedFilenames;
}

/**
 * Job de limpieza de archivos huérfanos y depuración por antigüedad.
 * Por defecto ejecuta en modo DRY-RUN (no borra nada, solo reporta).
 * Para ejecutar borrado real: req.params.dryRun = false o process.env.DRY_RUN = 'false'.
 */
export async function runAutoPurge({ dryRun = true, autoPurgeDays = 0, gracePeriodHours = 24 } = {}) {
  const isDryRun = Boolean(dryRun);
  console.log(`[AutoPurge] === Iniciando proceso de depuración (Modo: ${isDryRun ? 'DRY-RUN (Simulación)' : 'EJECUCIÓN REAL'}, Período de gracia: ${gracePeriodHours}h) ===`);

  const summary = {
    dryRun: isDryRun,
    autoPurgeDays,
    gracePeriodHours,
    protectedFilesCount: 0,
    protectedFiles: [],
    referencedFilesCount: 0,
    orphansFound: 0,
    orphansDeleted: 0,
    orphanBytesFreed: 0,
    orphanFiles: [],
    oldDocsFound: 0,
    oldDocsPurged: 0,
    purgedDocIds: [],
  };

  // 1. Recopilar todos los archivos válidos referenciados en BD consultando _SCHEMA
  const referencedFilenames = await getAllReferencedFiles();
  summary.referencedFilesCount = referencedFilenames.size;

  // 2. Escanear storage en disco (./files, ./exports, etc.)
  const storageDirs = ['./files', './files/files', './exports'];
  const diskFiles = [];

  for (const dir of storageDirs) {
    if (fs.existsSync(dir)) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile()) {
            const fullPath = path.join(dir, entry.name);
            diskFiles.push({ name: entry.name, fullPath, dir });
          }
        }
      } catch (dirErr) {
        console.warn(`[AutoPurge] Error leyendo directorio ${dir}:`, dirErr.message);
      }
    }
  }

  const gracePeriodMs = gracePeriodHours * 60 * 60 * 1000;
  const now = Date.now();

  // 3. Evaluar cada archivo en disco
  for (const file of diskFiles) {
    // 3.1 Protección por convención de nombres y rutas del sistema (Punto 0)
    const protectReason = getFileProtectionReason(file.fullPath) || getFileProtectionReason(file.name);
    if (protectReason) {
      summary.protectedFilesCount++;
      summary.protectedFiles.push({ name: file.name, path: file.fullPath, reason: protectReason });
      console.log(`[AutoPurge][PROTEGIDO] Archivo: ${file.name} (Motivo: ${protectReason})`);
      continue;
    }

    let stat;
    try {
      stat = fs.statSync(file.fullPath);
    } catch (_) {
      continue;
    }

    // 3.2 Margen de gracia para archivos recientes (Punto 1)
    const fileAgeMs = now - stat.mtimeMs;
    if (fileAgeMs < gracePeriodMs) {
      const hoursOld = (fileAgeMs / (1000 * 60 * 60)).toFixed(1);
      const graceReason = `Archivo reciente dentro del margen de gracia (${hoursOld}h de antigüedad < ${gracePeriodHours}h requeridas)`;
      summary.protectedFilesCount++;
      summary.protectedFiles.push({ name: file.name, path: file.fullPath, reason: graceReason });
      console.log(`[AutoPurge][PROTEGIDO] Archivo: ${file.name} (Motivo: ${graceReason})`);
      continue;
    }

    // 3.3 Archivos activos en base de datos
    if (referencedFilenames.has(file.name)) {
      if (isDryRun) {
        console.log(`[AutoPurge][EN USO] Archivo: ${file.name} (Referenciado activamente en la BD)`);
      }
      continue;
    }

    // 3.4 Huérfano confirmado
    const size = stat.size;
    summary.orphansFound++;
    summary.orphanBytesFreed += size;
    summary.orphanFiles.push({ name: file.name, path: file.fullPath, size });

    if (!isDryRun) {
      try {
        fs.unlinkSync(file.fullPath);
        summary.orphansDeleted++;
        console.log(`[AutoPurge] Eliminado archivo huérfano: ${file.fullPath} (${(size / 1024).toFixed(1)} KB)`);
      } catch (unlinkErr) {
        console.warn(`[AutoPurge] No se pudo borrar ${file.fullPath}:`, unlinkErr.message);
      }
    } else {
      console.log(`[AutoPurge][DRY-RUN] Se borraría archivo huérfano: ${file.fullPath} (${(size / 1024).toFixed(1)} KB)`);
    }
  }

  // 4. Depuración por antigüedad (si autoPurgeDays > 0)
  if (autoPurgeDays > 0) {
    const cutoffDate = new Date(Date.now() - autoPurgeDays * 24 * 60 * 60 * 1000);
    console.log(`[AutoPurge] Buscando documentos completados/rechazados anteriores a ${cutoffDate.toISOString()}...`);

    const oldDocsQuery = new Parse.Query('contracts_Document');
    oldDocsQuery.notEqualTo('IsPurged', true);
    oldDocsQuery.lessThan('updatedAt', cutoffDate);
    oldDocsQuery.limit(500);

    const completedQuery = new Parse.Query('contracts_Document');
    completedQuery.equalTo('IsCompleted', true);

    const declinedQuery = new Parse.Query('contracts_Document');
    declinedQuery.equalTo('IsDeclined', true);

    const stateQuery = Parse.Query.or(completedQuery, declinedQuery);
    const mainOldQuery = Parse.Query.and(oldDocsQuery, stateQuery);

    const candidateDocs = await mainOldQuery.find({ useMasterKey: true });
    summary.oldDocsFound = candidateDocs.length;

    for (const doc of candidateDocs) {
      summary.purgedDocIds.push(doc.id);
      if (!isDryRun) {
        try {
          await deleteDocumentPermanent({
            params: { docId: doc.id },
            master: true,
          });
          summary.oldDocsPurged++;
          console.log(`[AutoPurge] Documento ${doc.id} depurado por antigüedad.`);
        } catch (purgeErr) {
          console.warn(`[AutoPurge] Error depurando documento ${doc.id}:`, purgeErr.message);
        }
      } else {
        console.log(`[AutoPurge][DRY-RUN] Se depuraría documento ${doc.id} ("${doc.get('Name')}")`);
      }
    }
  }

  console.log(`[AutoPurge] === Proceso finalizado. Protegidos: ${summary.protectedFilesCount}. Huérfanos: ${summary.orphansFound} (${(summary.orphanBytesFreed / (1024 * 1024)).toFixed(2)} MB). Antiguos: ${summary.oldDocsFound} ===`);
  return summary;
}

export default async function autoPurgeJob(req) {
  const envDays = parseInt(process.env.AUTO_PURGE_DAYS || '0', 10);
  const autoPurgeDays = req.params?.days !== undefined ? parseInt(req.params.days, 10) : envDays;
  const envGrace = parseInt(process.env.GRACE_PERIOD_HOURS || '24', 10);
  const gracePeriodHours = req.params?.graceHours !== undefined ? parseInt(req.params.graceHours, 10) : envGrace;

  // Por defecto la primera vez siempre DRY-RUN a menos que se especifique dryRun: false
  const dryRun = req.params?.dryRun !== undefined
    ? Boolean(req.params.dryRun)
    : process.env.DRY_RUN !== 'false';

  return await runAutoPurge({ dryRun, autoPurgeDays, gracePeriodHours });
}
