import fs from 'node:fs';
import path from 'node:path';
import { isUserAdmin } from '../adminHelper.js';

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

function safeUnlink(filePath) {
  try {
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

export default async function deleteDocumentPermanent(req) {
  const docId = req.params?.docId || req.params?.objectId;
  if (!docId) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Se requiere el ID del documento (docId).');
  }

  // 1. Obtener y validar el usuario autenticado (o master key)
  let user = req.user;
  const isMaster = Boolean(req.master);
  if (!user && !isMaster) {
    if (req.headers && req.headers['sessiontoken']) {
      try {
        user = await Parse.User.become(req.headers['sessiontoken']);
      } catch (_) {}
    }
    if (!user && req.params?.sessionToken) {
      try {
        user = await Parse.User.become(req.params.sessionToken);
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

  // 3. Verificar si el usuario es el propietario o un Administrador
  const userEmail = (user?.get('email') || '').toLowerCase().trim();
  const userId = user?.id;
  const isAdmin = isMaster || (await isUserAdmin(userEmail, userId));

  const createdBy = doc.get('CreatedBy');
  const extUserPtr = doc.get('ExtUserPtr');
  const senderMail = (doc.get('SenderMail') || '').toLowerCase().trim();

  const isOwner =
    (createdBy && createdBy.id === userId) ||
    (extUserPtr && extUserPtr.get('UserId')?.id === userId) ||
    (senderMail && senderMail === userEmail);

  if (!isOwner && !isAdmin) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'No tiene permisos para eliminar este documento. Solo el propietario o un administrador puede eliminarlo.'
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
    console.log(`[deleteDocumentPermanent] Carpeta "${docName}" (${docId}) eliminada de raíz.`);
    return { status: 'success', message: `Carpeta "${docName}" eliminada correctamente.` };
  }

  // 5. Si es un documento regular: recopilar todas las URLs y referencias de archivos
  const fileUrls = [
    doc.get('URL'),
    doc.get('SignedUrl'),
    doc.get('CertificateUrl'),
    ...(doc.get('AuditTrail') || []).map(a => a?.SignedUrl).filter(Boolean),
  ].filter(Boolean);

  const deletedFilenames = new Set();

  for (const fUrl of fileUrls) {
    const filename = getFilenameFromUrl(fUrl);
    if (filename) {
      deletedFilenames.add(filename);
      // Eliminar de las rutas físicas conocidas
      safeUnlink(path.join('./files/files', filename));
      safeUnlink(path.join('./files', filename));
      safeUnlink(path.join('./exports', filename));
      safeUnlink(path.join('./exports', `signed_${filename}`));
    }
  }

  // Eliminar archivos físicos en ./exports asociados específicamente al docId
  safeUnlink(path.join('./exports', `signed_certificate_${docId}.pdf`));
  safeUnlink(path.join('./exports', `certificate_${docId}.pdf`));

  // Escaneo preventivo en ./files/files y ./exports para cualquier archivo residual que contenga el docId
  const candidateDirs = ['./files/files', './files', './exports'];
  for (const dir of candidateDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file.includes(docId)) {
            safeUnlink(path.join(dir, file));
          }
        }
      } catch (dirErr) {
        console.warn(`[deleteDocumentPermanent] Error escaneando ${dir}:`, dirErr.message);
      }
    }
  }

  // 6. Limpiar registros correspondientes en partners_DataFiles
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
      console.log(
        `[deleteDocumentPermanent] Eliminados ${matchingDataFiles.length} registros de uso en partners_DataFiles.`
      );
    }
  } catch (dfErr) {
    console.warn('[deleteDocumentPermanent] Error limpiando partners_DataFiles:', dfErr.message);
  }

  // 7. Eliminar el registro del documento de contracts_Document en la base de datos
  await doc.destroy({ useMasterKey: true });
  console.log(`[deleteDocumentPermanent] Documento "${docName}" (${docId}) y sus archivos físicos fueron eliminados de raíz.`);

  return {
    status: 'success',
    message: `El documento "${docName}" y sus archivos físicos han sido eliminados de raíz.`,
    docId,
  };
}
