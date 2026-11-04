import multer from 'multer';
import Coherentpdf from 'coherentpdf';
import axios from 'axios';
import { cloudServerUrl, serverAppId } from '../../Utils.js';

const storage = multer.memoryStorage();

export const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB hard limit
  fileFilter: (req, file, cb) => {
    const isPdfExt = /\.pdf$/i.test(file.originalname || '');
    const isPdfMime = file.mimetype === 'application/pdf' || file.mimetype === 'application/octet-stream';
    if (isPdfExt || isPdfMime) {
      return cb(null, true);
    }
    return cb(new Error('Solo se permiten archivos PDF.'));
  },
});

export default async function decryptpdf(req, res) {
  const sessionToken = req.headers['x-parse-session-token'] || req.headers['sessiontoken'];
  if (!sessionToken) {
    return res.status(401).json({ error: 'No autorizado. Se requiere sesión activa.' });
  }

  // Validate session against Parse Server
  try {
    const sessionRes = await axios.get(`${cloudServerUrl}/users/me`, {
      headers: {
        'X-Parse-Application-Id': serverAppId,
        'X-Parse-Session-Token': sessionToken,
      },
      timeout: 5000,
    });
    if (!sessionRes?.data?.objectId) {
      return res.status(401).json({ error: 'Sesión no válida o expirada.' });
    }
  } catch (authErr) {
    return res.status(401).json({ error: 'Sesión no válida o expirada.' });
  }

  if (!req.file || !req.file.buffer) {
    return res.status(400).json({ error: 'No se subió ningún archivo PDF.' });
  }

  const password = req.body?.password || '';
  try {
    const pdf = await Coherentpdf.fromMemory(req.file.buffer, password);
    await Coherentpdf.decryptPdf(pdf, password);
    const buffer = await Coherentpdf.toMemory(pdf, false, false);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="decrypted.pdf"',
      'Content-Length': buffer.length,
    });
    return res.send(buffer);
  } catch (err) {
    let code = err?.code ? err.code : 400;
    let message = 'No se pudo desbloquear el PDF.';
    if (err?.[2]?.c?.includes('Bad password') || err?.[2]?.c?.includes('decrypt_pdf_inner')) {
      code = 401;
      message = 'Contraseña incorrecta.';
    }
    return res.status(code).json({ error: message });
  }
}

