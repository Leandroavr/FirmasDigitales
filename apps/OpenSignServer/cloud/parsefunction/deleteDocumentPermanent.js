import fs from 'node:fs';
import path from 'node:path';
import Parse from 'parse/node';

function getFilenameFromUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string') return null;
  try {
    const cleanUrl = urlStr.split('?')[0];
    let pathname = cleanUrl;
    try {
      const parsed = new URL(cleanUrl);
      pathname = parsed.pathname;
    } catch (_) {}
    const base = path.basename(pathname);
    return base || null;
  } catch (_) {
    return null;
  }
}

export const PROTECTED_FILE_RULES = [
  { test: p => p.includes('certificates'), reason: 'Certificados digitales de usuarios o AC raíz (.p12/.pfx/.pem)' },
  { test: p => p.includes('signatures'), reason: 'Rúbricas escaneadas o fotos de usuarios' },
  { test: p => /\.(p12|pfx|pem|crt|key)$/i.test(p), reason: 'Clave criptográfica o certificado digital' },
  { test: p => /\.(html|txt)$/i.test(p), reason: 'Plantilla de correo o documento estático del sistema' },
  { test: p => /(^|\/|\\)(brascuba|logo|favicon)/i.test(p) || p.toLowerCase().includes('logo'), reason: 'Logo o branding corporativo/tenant' },
  { test: p => /(^|\/|\\)\.[^/\\]+/.test(p) || path.basename(p) === 'README.md', reason: 'Archivo de configuración o metadato del sistema' },
];

export function getFileProtectionReason(filePathOrName) {
  if (!filePathOrName) return null;
  const normalized = String(filePathOrName).replace(/\\/g, '/');
  for (const rule of PROTECTED_FILE_RULES) {
    if (rule.test(normalized)) {
      return rule.reason;
    }
  }
  return null;
}

function safeUnlink(filePath) {
  try {
    const protectReason = getFileProtectionReason(filePath);
    if (protectReason) {
      console.log(`[deleteDocumentPermanent][PROTEGIDO] Omitiendo eliminación de ${filePath}: ${protectReason}`);
      return false;
    }
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        fs.unlinkSync(filePath);
        console.log(`[deleteDocumentPermanent] Archivo eliminado de disco: ${filePath}`);
        return true;
      }
    }
  } catch (err) {
    console.warn(`[deleteDocumentPermanent] No se pudo eliminar ${filePath}:`, err.message);
  }
  return false;
}

/**
 * Verifica si un archivo físico está siendo referenciado por otro documento o plantilla
 */
async function isFileReferencedElsewhere(filename, currentDocId) {
  if (!filename) return false;
  try {
    // 1. Verificar otros documentos activos
    const urlQuery = new Parse.Query('contracts_Document');
    urlQuery.contains('URL', filename);

    const signedQuery = new Parse.Query('contracts_Document');
    signedQuery.contains('SignedUrl', filename);

    const certQuery = new Parse.Query('contracts_Document');
    certQuery.contains('CertificateUrl', filename);

    const mainDocQuery = Parse.Query.or(urlQuery, signedQuery, certQuery);
    if (currentDocId) {
      mainDocQuery.notEqualTo('objectId', currentDocId);
    }
    mainDocQuery.notEqualTo('IsPurged', true);

    const docCount = await mainDocQuery.count({ useMasterKey: true });
    if (docCount > 0) return true;

    // 2. Verificar plantillas
    const tmplQuery = new Parse.Query('contracts_Template');
    tmplQuery.contains('URL', filename);
    const tmplCount = await tmplQuery.count({ useMasterKey: true });
    if (tmplCount > 0) return true;
  } catch (err) {
    console.warn('[deleteDocumentPermanent] Error comprobando referencias cruzadas:', err.message);
  }
  return false;
}

/**
 * Depuración individual de un documento
 */
export default async function deleteDocumentPermanent(req) {
  const docId = req.params?.docId || req.params?.objectId;
  if (!docId) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Se requiere el ID del documento (docId).');
  }

  // 1. Obtener y validar el usuario autenticado (o master key)
  let user = req.user;
  const isMaster = Boolean(req.master);
  if (!user && !isMaster) {
    const token = req.headers?.['x-parse-session-token'] || req.headers?.['sessiontoken'] || req.params?.sessionToken;
    if (token) {
      try {
        user = await Parse.User.become(token);
      } catch (_) {}
    }
  }
  if (!user && !isMaster) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, 'Usuario no autenticado.');
  }

  // 2. Buscar el documento en la base de datos
  const docQuery = new Parse.Query('contracts_Document');
  docQuery.include('CreatedBy');
  docQuery.include('ExtUserPtr');
  let doc;
  try {
    doc = await docQuery.get(docId, { useMasterKey: true });
  } catch (err) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Documento no encontrado.');
  }

  // 3. SEGURIDAD ESTRICTA (B6): SOLO el propietario (CreatedBy o su ExtUserPtr) puede depurar
  const userEmail = (user?.get('email') || '').toLowerCase().trim();
  const userId = user?.id;

  const createdBy = doc.get('CreatedBy');
  const extUserPtr = doc.get('ExtUserPtr');
  const senderMail = (doc.get('SenderMail') || '').toLowerCase().trim();

  const isOwner =
    (createdBy && createdBy.id === userId) ||
    (extUserPtr && extUserPtr.get('UserId')?.id === userId) ||
    (extUserPtr && extUserPtr.id === userId) ||
    (senderMail && senderMail === userEmail);

  if (!isOwner && !isMaster) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'No tiene permisos para depurar este documento. Solo el propietario creador del documento puede depurarlo.'
    );
  }

  const docType = doc.get('Type');
  const docName = doc.get('Name') || docId;

  // 4. Si es una carpeta
  if (docType === 'Folder') {
    const childQuery = new Parse.Query('contracts_Document');
    childQuery.equalTo('Folder', {
      __type: 'Pointer',
      className: 'contracts_Document',
      objectId: docId,
    });
    const childCount = await childQuery.count({ useMasterKey: true });
    if (childCount > 0) {
      throw new Parse.Error(
        Parse.Error.VALIDATION_ERROR,
        'La carpeta contiene documentos o subcarpetas. Debe vaciarla antes de poder eliminarla.'
      );
    }
    await doc.destroy({ useMasterKey: true });
    return { status: 'success', message: `Carpeta "${docName}" eliminada correctamente.` };
  }

  // 5. VALIDACIÓN DE ESTADOS (B3):
  // Permitidos: Completed, Declined, Expired, Draft, Self-Sign, Revoked/Archived.
  // Bloqueado: InProgress activo (no completado, no rechazado, no vencido, no borrador, no revocado).
  const isCompleted = Boolean(doc.get('IsCompleted'));
  const isDeclined = Boolean(doc.get('IsDeclined'));
  const isDraft = Boolean(doc.get('IsDraft') || doc.get('Stage') === 'draft' || doc.get('IsSignyourself'));
  const isRevoked = Boolean(doc.get('IsArchived') || doc.get('IsArchive') || doc.get('IsRevoked'));
  const expiryDate = doc.get('ExpiryDate');
  const isExpired = Boolean(doc.get('IsExpired') || (expiryDate && new Date(expiryDate) < new Date()));

  if (!isCompleted && !isDeclined && !isDraft && !isExpired && !isRevoked) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'No se puede depurar un documento en proceso. Debe cancelarlo o revocarlo primero antes de depurar.'
    );
  }

  // 6. Recopilar URLs y verificar referencias cruzadas antes de borrar físicamente (B2)
  const fileUrls = [
    doc.get('URL'),
    doc.get('SignedUrl'),
    doc.get('CertificateUrl'),
    ...(doc.get('AuditTrail') || []).map(a => a?.SignedUrl).filter(Boolean),
  ].filter(Boolean);

  const deletedFilenames = new Set();

  for (const fUrl of fileUrls) {
    const filename = getFilenameFromUrl(fUrl);
    if (filename && !deletedFilenames.has(filename)) {
      const isShared = await isFileReferencedElsewhere(filename, docId);
      if (isShared) {
        console.log(`[deleteDocumentPermanent] Archivo ${filename} compartido por otro documento/plantilla. No se borra físicamente.`);
      } else {
        deletedFilenames.add(filename);
        safeUnlink(path.join('./files/files', filename));
        safeUnlink(path.join('./files', filename));
        safeUnlink(path.join('./exports', filename));
        safeUnlink(path.join('./exports', `signed_${filename}`));
      }
    }
  }

  // Archivos de certificado en exports
  safeUnlink(path.join('./exports', `signed_certificate_${docId}.pdf`));
  safeUnlink(path.join('./exports', `certificate_${docId}.pdf`));

  // Escaneo preventivo de residuos asociados al docId en directorios de trabajo
  const candidateDirs = ['./files/files', './files', './exports'];
  for (const dir of candidateDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file.includes(docId)) {
            const isShared = await isFileReferencedElsewhere(file, docId);
            if (!isShared) {
              safeUnlink(path.join(dir, file));
            }
          }
        }
      } catch (dirErr) {
        console.warn(`[deleteDocumentPermanent] Error escaneando ${dir}:`, dirErr.message);
      }
    }
  }

  // Limpiar partners_DataFiles
  try {
    const dfQuery = new Parse.Query('partners_DataFiles');
    dfQuery.limit(1000);
    const allDataFiles = await dfQuery.find({ useMasterKey: true });
    const matchingDataFiles = allDataFiles.filter(df => {
      const u = df.get('FileUrl') || '';
      for (const fn of deletedFilenames) {
        if (u.includes(fn)) return true;
      }
      return u.includes(docId);
    });
    if (matchingDataFiles.length > 0) {
      await Parse.Object.destroyAll(matchingDataFiles, { useMasterKey: true });
    }
  } catch (dfErr) {
    console.warn('[deleteDocumentPermanent] Error limpiando partners_DataFiles:', dfErr.message);
  }

  // 7. REGISTRO EN BASE DE DATOS (B4: Lápida / Tombstone):
  const keepTombstone = process.env.PURGE_KEEP_TOMBSTONE !== 'false';

  // Registrar auditoría independiente en colección contracts_PurgeLog (Punto 3)
  try {
    const purgeLog = new Parse.Object('contracts_PurgeLog');
    purgeLog.set('DocumentId', docId);
    purgeLog.set('DocumentName', docName);
    purgeLog.set('DocumentHash', doc.get('DocumentHash') || doc.get('DocHash') || '');
    purgeLog.set('PurgedBy', user ? { __type: 'Pointer', className: '_User', objectId: userId } : null);
    purgeLog.set('PurgedByEmail', userEmail || 'master_key');
    purgeLog.set('PurgedAt', new Date());
    purgeLog.set('UserIP', req.headers?.['x-real-ip'] || req.ip || '');
    purgeLog.set('DeletedFiles', Array.from(deletedFilenames));
    purgeLog.set('PurgeMode', keepTombstone ? 'tombstone' : 'destroy');
    purgeLog.set('Signers', (doc.get('Signers') || []).map(s => ({
      Name: s?.Name || s?.name || '',
      Email: s?.Email || s?.email || '',
      Role: s?.Role || s?.role || '',
    })));
    // Restringir permisos: Solo administradores (SuperAdmin) o master key pueden leer
    const acl = new Parse.ACL();
    acl.setPublicReadAccess(false);
    acl.setPublicWriteAccess(false);
    acl.setRoleReadAccess('contracts_Admin', true);
    purgeLog.setACL(acl);
    await purgeLog.save(null, { useMasterKey: true });
    console.log(`[deleteDocumentPermanent] Entrada registrada en contracts_PurgeLog para doc ${docId}.`);
  } catch (logErr) {
    console.warn('[deleteDocumentPermanent] Error creando contracts_PurgeLog:', logErr.message);
  }

  if (keepTombstone) {
    // Conserva AuditTrail pero ELIMINA el campo Signature (DataURL en base64) de cada entrada
    const rawAudit = doc.get('AuditTrail') || [];
    const cleanedAuditTrail = rawAudit.map(entry => {
      const cleaned = { ...entry };
      delete cleaned.Signature;
      delete cleaned.Sign;
      delete cleaned.signature;
      delete cleaned.dataUrl;
      return cleaned;
    });

    cleanedAuditTrail.push({
      Activity: 'Purged',
      UserPtr: { __type: 'Pointer', className: '_User', objectId: userId },
      UserEmail: userEmail,
      SignedOn: new Date(),
      ipAddress: req.headers?.['x-real-ip'] || '',
      Message: 'Documento depurado. Archivos físicos y datos de formulario eliminados de la plataforma.',
    });

    doc.set('IsPurged', true);
    doc.set('PurgedAt', new Date());
    doc.set('PurgedBy', { __type: 'Pointer', className: '_User', objectId: userId });
    doc.set('AuditTrail', cleanedAuditTrail);

    // Vaciar almacenamiento y referencias binarias, widgets, notas y prellenado (Punto 4 y 5)
    doc.unset('URL');
    doc.unset('SignedUrl');
    doc.unset('CertificateUrl');
    doc.unset('SignedPdf');
    doc.unset('PdfFile');
    doc.unset('File');
    doc.unset('Note');
    doc.unset('Description');
    doc.set('Placeholders', []);
    doc.set('Prefill', []);
    doc.set('Forms', []);
    doc.set('Widgets', []);

    await doc.save(null, { useMasterKey: true });
    console.log(`[deleteDocumentPermanent] Documento "${docName}" (${docId}) depurado con lápida (Tombstone).`);
  } else {
    // Destrucción total
    await doc.destroy({ useMasterKey: true });
    console.log(`[deleteDocumentPermanent] Documento "${docName}" (${docId}) eliminado completamente.`);
  }

  return {
    status: 'success',
    message: `El documento "${docName}" y sus archivos han sido depurados exitosamente.`,
    docId,
    purged: true,
  };
}

/**
 * Depuración por lotes (Batch Purge)
 */
export async function batchPurgeDocuments(req) {
  const docIds = req.params?.docIds || [];
  if (!Array.isArray(docIds) || docIds.length === 0) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Se requiere un arreglo de IDs (docIds).');
  }

  const results = {
    total: docIds.length,
    purged: 0,
    failed: 0,
    errors: [],
  };

  for (const docId of docIds) {
    try {
      const subReq = {
        ...req,
        params: { ...req.params, docId },
      };
      await deleteDocumentPermanent(subReq);
      results.purged++;
    } catch (err) {
      results.failed++;
      results.errors.push({ docId, error: err.message || 'Error desconocido' });
    }
  }

  return {
    status: 'success',
    message: `Depuración por lote completada: ${results.purged} depurados, ${results.failed} omitidos/fallidos.`,
    data: results,
  };
}

/**
 * Indicador de espacio ocupado para administradores (B7)
 */
export async function getStorageStats(req) {
  let user = req.user;
  if (!user && req.headers?.['sessiontoken']) {
    try {
      user = await Parse.User.become(req.headers['sessiontoken']);
    } catch (_) {}
  }

  const userEmail = (user?.get('email') || '').toLowerCase().trim();
  const isAdmin = Boolean(req.master) || (user && (user.get('isSuperAdmin') || userEmail === 'admin@brascuba.cu'));

  if (!isAdmin) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Solo los administradores pueden consultar estadísticas de almacenamiento.');
  }

  function getDirectorySize(dirPath) {
    let size = 0;
    let fileCount = 0;
    if (!fs.existsSync(dirPath)) return { size, fileCount };

    function scan(d) {
      try {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(d, entry.name);
          if (entry.isDirectory()) {
            scan(fullPath);
          } else if (entry.isFile()) {
            try {
              const stat = fs.statSync(fullPath);
              size += stat.size;
              fileCount++;
            } catch (_) {}
          }
        }
      } catch (_) {}
    }
    scan(dirPath);
    return { size, fileCount };
  }

  const filesStats = getDirectorySize('./files');
  const exportsStats = getDirectorySize('./exports');
  const totalSizeBytes = filesStats.size + exportsStats.size;
  const totalSizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(2);

  const docQuery = new Parse.Query('contracts_Document');
  const totalDocs = await docQuery.count({ useMasterKey: true });

  const purgedQuery = new Parse.Query('contracts_Document');
  purgedQuery.equalTo('IsPurged', true);
  const purgedDocs = await purgedQuery.count({ useMasterKey: true });

  const activeDocs = totalDocs - purgedDocs;

  return {
    status: 'success',
    storageMB: totalSizeMB,
    storageBytes: totalSizeBytes,
    totalFilesOnDisk: filesStats.fileCount + exportsStats.fileCount,
    totalDocuments: totalDocs,
    activeDocuments: activeDocs,
    purgedDocuments: purgedDocs,
  };
}
