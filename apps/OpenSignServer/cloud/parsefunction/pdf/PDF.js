import fs from 'node:fs';
import { createHash } from 'node:crypto';
import axios from 'axios';
import { PDFDocument } from 'pdf-lib';
import {
  cloudServerUrl,
  replaceMailVaribles,
  saveFileUsage,
  getSecureUrl,
  appName,
  serverAppId,
} from '../../../Utils.js';
import GenerateCertificate from './GenerateCertificate.js';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import { Placeholder } from './Placeholder.js';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { buildDownloadFilename, parseUploadFile } from '../../../utils/fileUtils.js';
import sendMailWithAttachment from '../sendMailWithAttachment.js';
import sendSystemMail from '../sendSystemMail.js';
import {
  COMPLETION_ACTIVITIES,
  findPlaceholderIndex,
  findPendingPriorSigner,
  isCompletionRelevant,
} from '../../../utils/workflowUtils.js';

// Audit-trail activities that count toward document completion. The free
// build only counts 'Signed'; EE additionally counts 'Approved'.

// A placeholder participates in completion unless it is a prefill entry.
// EE additionally excludes viewers (who never act on the document).

// Strict-order gating: returns the signerObjId of the prior placeholder
// still pending, or null when the strict-order requirement is satisfied.

const serverUrl = cloudServerUrl; // process.env.SERVER_URL;
const APPID = serverAppId;
const masterKEY = process.env.MASTER_KEY;
const eSignName = 'Firma Digital Brascuba';
const eSigncontact = 'hello@opensignlabs.com';
const docUrl = `${serverUrl}/classes/contracts_Document`;
const headers = {
  'Content-Type': 'application/json',
  'X-Parse-Application-Id': APPID,
  'X-Parse-Master-Key': masterKEY,
};

function generateDocumentHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function unlinkFile(path) {
  if (fs.existsSync(path)) {
    try {
      fs.unlinkSync(path);
    } catch (err) {
      console.log('Err in unlink file: ', path);
    }
  }
}

// `updateDoc` is used to create url in from pdfFile
async function uploadFile(pdfName, filepath) {
  try {
    const filedata = fs.readFileSync(filepath);
    let fileUrl;

    const fileRes = await parseUploadFile(pdfName, filedata, 'application/pdf');
    fileUrl = getSecureUrl(fileRes?.url)?.url;

    return { imageUrl: fileUrl };
  } catch (err) {
    console.log('Err ', err);
    // below line of code is used to remove exported signed pdf file from exports folder
    unlinkFile(filepath);
  }
}

// `updateDoc` is used to update signedUrl, AuditTrail, Iscompleted in document
async function updateDoc(
  docId,
  url,
  userId,
  ipAddress,
  data,
  className,
  sign,
  documentHash,
  activity,
  corporateSigning = false
) {
  try {
    const UserPtr = { __type: 'Pointer', className: className, objectId: userId };
    const auditActivity = 'Signed';
    const obj = {
      UserPtr: UserPtr,
      SignedUrl: url,
      Activity: auditActivity,
      ipAddress: ipAddress,
      SignedOn: new Date(),
      Signature: sign,
    };
    let updateAuditTrail;
    if (data.AuditTrail && data.AuditTrail.length > 0) {
      const AuditTrail = JSON.parse(JSON.stringify(data.AuditTrail));
      const existingIndex = AuditTrail.findIndex(
        entry => entry.UserPtr.objectId === userId && entry.Activity !== 'Created'
      );
      existingIndex !== -1
        ? (AuditTrail[existingIndex] = { ...AuditTrail[existingIndex], ...obj })
        : AuditTrail.push(obj);

      updateAuditTrail = AuditTrail;
    } else {
      updateAuditTrail = [obj];
    }

    // Count both Signed and Approved entries; only signer/approver
    // placeholders count toward completion (viewers and prefill excluded).
    const auditTrail = updateAuditTrail.filter(x => COMPLETION_ACTIVITIES.includes(x.Activity));
    let isCompleted = false;
    if (data.Signers && data.Signers.length > 0) {
      const completionRelevant =
        data.Placeholders?.length > 0 ? data.Placeholders.filter(isCompletionRelevant) : [];
      if (auditTrail.length >= completionRelevant.length && completionRelevant.length > 0) {
        isCompleted = true;
      }
    } else {
      isCompleted = true;
    }
    const body = {
      SignedUrl: url,
      AuditTrail: updateAuditTrail,
      IsCompleted: isCompleted,
      ...(corporateSigning && { CorporateSigning: true }),
    };
    if (documentHash && isCompleted) {
      body.DocumentHash = documentHash;
    }
    const signedRes = await axios.put(`${docUrl}/${docId}`, body, { headers });
    return {
      isCompleted: isCompleted,
      message: 'success',
      AuditTrail: updateAuditTrail,
      DocumentHash: documentHash && isCompleted ? documentHash : undefined,
    };
  } catch (err) {
    console.log('update doc err ', err);
    return 'err';
  }
}

// `sendNotifyMail` is used to send notification mail of signer signed the document
async function sendNotifyMail(doc, signUser, mailProvider, publicUrl) {
  try {
    if (doc?.NotifyOnSignatures === false) {
      console.log(`[sendNotifyMail] Notificaciones desactivadas para "${doc?.Name}". Omitiendo envío.`);
      return;
    }
    // En "Firma tú mismo", no enviar notificación de avance entre firmantes
    if (doc?.IsSignyourself === true) {
      console.log(`[sendNotifyMail] Documento "${doc?.Name}" es de Firma tú mismo. Omitiendo notificación de avance.`);
      return;
    }
    const TenantAppName = 'Firma Digital Brascuba';

    // Contar firmantes completados únicos de forma precisa
    const completedSignerIds = new Set(
      (doc?.AuditTrail || [])
        .filter(x => COMPLETION_ACTIVITIES.includes(x.Activity) && (x.UserPtr?.objectId || x.UserPtr))
        .map(x => (x.UserPtr?.objectId || x.UserPtr).toString())
    );
    if (signUser?.objectId) {
      completedSignerIds.add(signUser.objectId.toString());
    }

    const placeholderSigners = new Set(
      (doc?.Placeholders || [])
        .filter(isCompletionRelevant)
        .map(p => p?.signerObjId || p?.signerPtr?.objectId || p?.email)
        .filter(Boolean)
    );
    const directSigners = new Set(
      (doc?.Signers || [])
        .map(s => s?.objectId || s?.Email || s?.email)
        .filter(Boolean)
    );
    const signersCount = Math.max(
      placeholderSigners.size,
      directSigners.size,
      completedSignerIds.size,
      1
    );
    const auditTrailCount = Math.min(completedSignerIds.size, signersCount);

    // Si el documento tiene un solo firmante en total (o es Firma tú mismo), no aplica el flujo multifirma de avance
    if (signersCount <= 1) {
      console.log(`[sendNotifyMail] Documento "${doc?.Name}" es de un solo firmante (${signersCount}). Se omite la notificación de avance multifirma.`);
      return;
    }

    const sender = doc?.ExtUserPtr;
    const pdfName = doc?.Name || 'Documento';
    const creatorEmail = (sender?.Email || sender?.email || '').toLowerCase().trim();
    const signerEmail = (signUser?.Email || signUser?.email || '').toLowerCase().trim();
    const signerName = signUser?.Name || signUser?.name || signerEmail;

    const isSendInOrder = doc?.SendinOrder === true || doc?.SendinOrder === 'true';

    // Recopilar todos los involucrados a notificar (incluyendo al propio firmante)
    const recipientSet = new Set();
    if (creatorEmail) {
      recipientSet.add(creatorEmail);
    }
    // Notificación confirmatoria para el propio firmante que acaba de firmar
    if (signerEmail) {
      recipientSet.add(signerEmail);
    }

    if (isSendInOrder) {
      if (Array.isArray(doc?.Signers)) {
        for (const s of doc.Signers) {
          const sId = (s?.objectId || '').toString();
          let sMail = (s?.Email || s?.email || '').toLowerCase().trim();
          if (completedSignerIds.has(sId) && sMail) {
            recipientSet.add(sMail);
          }
        }
      }
    } else {
      if (Array.isArray(doc?.Signers)) {
        for (const s of doc.Signers) {
          let sMail = (s?.Email || s?.email || '').toLowerCase().trim();
          if (!sMail && s?.objectId) {
            try {
              const cbQuery = new Parse.Query('contracts_Contactbook');
              const contact = await cbQuery.get(s.objectId, { useMasterKey: true });
              sMail = (contact?.get('Email') || '').toLowerCase().trim();
            } catch (e) {
              // Ignorar si no es contactbook
            }
          }
          if (sMail) {
            recipientSet.add(sMail);
          }
        }
      }
      if (Array.isArray(doc?.Placeholders)) {
        doc.Placeholders.forEach(p => {
          const pMail = (p?.email || p?.signerPtr?.Email || p?.signerPtr?.email || '').toLowerCase().trim();
          if (pMail) {
            recipientSet.add(pMail);
          }
        });
      }
    }

    const recipients = Array.from(recipientSet);
    console.log(`[sendNotifyMail] Doc: "${pdfName}", Signer: ${signerName} (${signerEmail}), Avance: ${auditTrailCount} de ${signersCount}, Destinatarios: [${recipients.join(', ')}]`);
    if (recipients.length === 0) return;

    const basePublicUrl = process.env.PUBLIC_URL || publicUrl || 'https://localhost:3001';

    for (const recipientEmail of recipients) {
      const encodeBase64 = Buffer.from(`${doc.objectId}/${recipientEmail}`).toString('base64');
      const viewDocUrl = `${basePublicUrl}/login/${encodeBase64}`;
      const isSignerSelf = recipientEmail === signerEmail;
      const subject = isSignerSelf
        ? `[Firma Digital] Ha firmado satisfactoriamente el documento "${pdfName}"`
        : `[Firma Digital] El documento "${pdfName}" ha sido firmado por ${signerName}`;
      const greetingHtml = isSignerSelf
        ? `<p style='margin-top:0;margin-bottom:14px;font-size:15px;color:#1e293b;'>Estimado(a) <strong>${signerName}</strong>,</p><p style='margin-top:0;margin-bottom:18px;'>Le confirmamos que ha firmado digitalmente y de forma satisfactoria el siguiente documento:</p>`
        : `<p style='margin-top:0;margin-bottom:14px;font-size:15px;color:#1e293b;'>Estimado(a) usuario(a),</p><p style='margin-top:0;margin-bottom:18px;'>Le informamos que el firmante <strong>${signerName}</strong> (${signerEmail}) ha firmado digitalmente el siguiente documento:</p>`;

      const body =
        "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8'/></head><body style='margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;'>" +
        "<div style='background-color:#f4f6f9;padding:25px 15px;'>" +
        "<div style='background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;margin:0 auto;border:1px solid #e5e7eb;'>" +
        `<div style='padding:20px 24px;background-color:#0b3c6d;'><h2 style='font-size:18px;margin:0;color:#ffffff;font-weight:600;letter-spacing:0.3px;'>${isSignerSelf ? 'Confirmación de Firma' : 'Notificación de Avance de Firmas'}</h2></div>` +
        `<div style='padding:24px;color:#334155;font-size:14px;line-height:1.6;'>` +
        greetingHtml +
        `<div style='background-color:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #0b3c6d;border-radius:6px;padding:16px 18px;margin:18px 0;'>` +
        `<div style='font-size:11px;font-weight:700;color:#0b3c6d;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;border-bottom:1px solid #e2e8f0;padding-bottom:5px;'>Información del Documento</div>` +
        `<table style='width:100%;border-collapse:collapse;font-size:13px;color:#334155;'>` +
        `<tr><td style='padding:5px 0;width:110px;font-weight:600;color:#64748b;'>Título:</td><td style='padding:5px 0;font-weight:700;color:#0f172a;'>${pdfName}</td></tr>` +
        (doc?.DocumentType ? `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Tipo de documento:</td><td style='padding:5px 0;font-weight:600;color:#0f172a;'>${doc.DocumentType}</td></tr>` : '') +
        (doc?.Description ? `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Descripción:</td><td style='padding:5px 0;color:#334155;'>${doc.Description}</td></tr>` : '') +
        (doc?.Note ? `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Notas:</td><td style='padding:5px 0;color:#334155;'>${doc.Note}</td></tr>` : '') +
        `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Estado:</td><td style='padding:5px 0;font-weight:700;color:#0b3c6d;'>${auditTrailCount} de ${signersCount} firmas completadas</td></tr>` +
        `</table></div>` +
        `<div style='margin:28px 0 20px 0;text-align:center;'><a target='_blank' href='${viewDocUrl}' style='display:inline-block;padding:12px 28px;background-color:#0b3c6d;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;box-shadow:0 2px 4px rgba(11,60,109,0.25);'>Ingresar a la Plataforma</a></div>` +
        `<div style='background-color:#fefce8;border:1px solid #fef08a;border-radius:4px;padding:10px 14px;margin-top:20px;'>` +
        `<p style='font-size:12px;color:#854d0e;margin:0;line-height:1.5;'><strong>Aviso de seguridad:</strong> Cada usuario debe iniciar sesión obligatoriamente con sus credenciales institucionales para acceder a la plataforma.</p>` +
        `</div></div></div>` +
        `<div><p style='padding:16px;color:#94a3b8;font-size:12px;text-align:center;margin:0;'>Mensaje automático generado por ${TenantAppName}.</p></div>` +
        `</div></body></html>`;

      const params = {
        extUserId: sender?.objectId,
        from: TenantAppName,
        recipient: recipientEmail,
        subject: subject,
        pdfName: pdfName,
        html: body,
        mailProvider: mailProvider,
      };
      try {
        await sendSystemMail({ params });
      } catch (errRecip) {
        console.error(`[sendNotifyMail] Falló envío a ${recipientEmail}:`, errRecip);
      }
      // Pausa breve para evitar ráfagas simultáneas contra el servidor SMTP
      await new Promise(r => setTimeout(r, 400));
    }
  } catch (err) {
    console.log('Error in sendNotifyMail:', err);
  }
}

// `sendCompletedMail` is used to send copy of completed document mail
async function sendCompletedMail(obj) {
  const url = obj.doc?.SignedUrl;
  const doc = obj.doc;
  const sender = obj.doc.ExtUserPtr;
  const pdfName = doc.Name;
  const TenantAppName = 'Firma Digital Brascuba';

  let signersMail;
  if (doc?.Signers?.length > 0) {
    const isOwnerExistsinSigners = doc?.Signers?.find(x => x.Email === sender?.Email);
    signersMail = isOwnerExistsinSigners
      ? doc?.Signers?.map(x => x?.Email)?.join(',')
      : [...doc?.Signers?.map(x => x?.Email), sender?.Email]?.filter(Boolean)?.join(',');
  } else {
    signersMail = sender?.Email;
  }
  const recipient = signersMail;
  const publicUrl = process.env.PUBLIC_URL || obj.publicUrl || 'https://localhost:3001';
  const firstSigner = doc?.Signers?.[0];
  const encodeBase64 = Buffer.from(
    `${doc.objectId}/${firstSigner?.Email || sender?.Email || ''}`
  ).toString('base64');
  const viewDocUrl = `${publicUrl}/login/${encodeBase64}`;

  // Comprobar si el documento es de un solo firmante para adaptar el mensaje
  const placeholderSigners = new Set(
    (doc?.Placeholders || [])
      .filter(isCompletionRelevant)
      .map(p => p?.signerObjId || p?.signerPtr?.objectId || p?.email)
      .filter(Boolean)
  );
  const totalSigners = Math.max((doc?.Signers || []).length, placeholderSigners.size);
  const isSingleSigner = totalSigners <= 1;
  const signerName = firstSigner?.Name || firstSigner?.Email || 'el firmante';

  const completionMessage = isSingleSigner
    ? `Le confirmamos que el documento <strong>"${pdfName}"</strong> ha sido firmado satisfactoriamente por <strong>${signerName}</strong> y el proceso ha finalizado con éxito.`
    : `Todas las partes requeridas han firmado satisfactoriamente el documento <strong>"${pdfName}"</strong>.`;

  let subject = `[Firma Digital] Documento completado: "${pdfName}"`;
  let body =
    "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8' /></head><body><div style='background-color:#f5f5f5;padding:20px'><div style='background-color:white;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)'>" +
    `<div style='padding:16px 20px;font-family:system-ui,sans-serif;background-color:#28a745'><h2 style='font-size:18px;margin:0;color:white;'>Documento Completado y Sellado</h2></div>` +
    `<div style='padding:24px 20px;font-family:system-ui,sans-serif;font-size:14px;color:#333;line-height:1.6'>` +
    `<p>Estimado(a) usuario(a),</p>` +
    `<p>${completionMessage}</p>` +
    `<div style='background-color:#e8f5e9;border-left:4px solid #28a745;padding:12px 16px;margin:18px 0'>` +
    `<p style='margin:0;font-size:13px;color:#1e4620'><strong>Estado final:</strong> El documento ha sido completado y sellado digitalmente. No admite más firmas ni alteraciones posteriores.</p>` +
    `</div>` +
    `<div style='margin:25px 0'><a target='_blank' href='${viewDocUrl}' style='display:inline-block;padding:12px 24px;background-color:#0b3c6d;color:white;text-decoration:none;border-radius:4px;font-weight:bold'>Ver y Descargar en la Plataforma</a></div>` +
    `<p style='font-size:13px;color:#555'>También puede descargar el documento final sellado directamente desde el archivo adjunto a este correo.</p>` +
    `<p style='font-size:12px;color:#777;margin-top:20px'><strong>Aviso de seguridad:</strong> Cada usuario debe iniciar sesión obligatoriamente con sus credenciales institucionales para acceder a la plataforma.</p>` +
    `</div></div>` +
    `<div><p style='padding:15px;color:#888;font-size:12px;text-align:center'>Mensaje automático generado por ${TenantAppName}.</p></div>` +
    `</div></body></html>`;

  if (obj?.isCustomMail) {
    const tenant = sender?.TenantId;
    if (tenant) {
      subject = tenant?.CompletionSubject ? tenant?.CompletionSubject : subject;
      body = tenant?.CompletionBody ? tenant?.CompletionBody : body;
    }
  }

  const Bcc = doc?.Bcc?.length > 0 ? doc.Bcc.map(x => x.Email) : [];
  const Cc = doc?.Cc?.length > 0 ? doc.Cc.map(x => x.Email) : [];
  const updatedBcc = doc?.SenderMail ? [...Bcc, doc?.SenderMail] : Bcc;
  const formatId = doc?.ExtUserPtr?.DownloadFilenameFormat;
  const filename = pdfName?.length > 100 ? pdfName?.slice(0, 100) : pdfName;
  const docName = buildDownloadFilename(formatId, {
    docName: filename,
    email: doc?.ExtUserPtr?.Email,
    isSigned: true,
  });
  const params = {
    extUserId: sender?.objectId,
    url: url,
    from: TenantAppName,
    recipient: recipient,
    subject: subject,
    pdfName: pdfName,
    html: body,
    mailProvider: obj.mailProvider,
    bcc: updatedBcc?.length > 0 ? updatedBcc : '',
    cc: Cc?.length > 0 ? Cc : '',
    certificatePath: `./exports/signed_certificate_${doc.objectId}.pdf`,
    filename: docName,
  };
  try {
    const res = await sendMailWithAttachment(params);
    if (res?.status !== 'success') {
      unlinkFile(`./exports/signed_certificate_${doc.objectId}.pdf`);
    }
  } catch (err) {
    unlinkFile(`./exports/signed_certificate_${doc.objectId}.pdf`);
  }
}

// `sendMailsaveCertifcate` is used send completion mail and update complete status of document
async function sendMailsaveCertifcate(doc, pfx, isCustomMail, mailProvider, filename) {
  const certificate = await GenerateCertificate(doc);
  const certificatePdf = await PDFDocument.load(certificate);
  const P12Buffer = fs.readFileSync(pfx.name);
  const p12 = new P12Signer(P12Buffer, { passphrase: pfx.passphrase || null });
  //  `pdflibAddPlaceholder` is used to add code of only digitial sign in certificate
  pdflibAddPlaceholder({
    pdfDoc: certificatePdf,
    reason: `Digitally signed by ${eSignName}.`,
    location: 'n/a',
    name: eSignName,
    contactInfo: eSigncontact,
    signatureLength: 16000,
  });
  const pdfWithPlaceholderBytes = await certificatePdf.save();
  const CertificateBuffer = Buffer.from(pdfWithPlaceholderBytes);
  //`new signPDF` create new instance of CertificateBuffer and p12Buffer
  const certificateOBJ = new SignPdf();
  // `signedCertificate` is used to sign certificate digitally
  const signedCertificate = await certificateOBJ.sign(CertificateBuffer, p12);
  const certificatePath = `./exports/signed_certificate_${doc.objectId}.pdf`;

  //below is used to save signed certificate in exports folder
  fs.writeFileSync(certificatePath, signedCertificate);
  const file = await uploadFile('certificate.pdf', certificatePath);
  const body = { CertificateUrl: file.imageUrl };
  await axios.put(`${docUrl}/${doc.objectId}`, body, { headers });
  // used in API only
  if (doc.IsSendMail === false) {
    console.log("don't send mail");
  } else {
    sendCompletedMail({ isCustomMail, doc, mailProvider, filename });
  }
  saveFileUsage(CertificateBuffer.length, file.imageUrl, doc?.CreatedBy?.objectId);
  unlinkFile(pfx.name);
  return file.imageUrl;
}

// `sendSelfSignCompletedMail` envía un correo único y limpio con el PDF adjunto para "Firma tú mismo"
async function sendSelfSignCompletedMail(obj) {
  const url = obj.doc?.SignedUrl;
  const doc = obj.doc;
  const signUser = obj.signUser;
  const sender = obj.doc.ExtUserPtr;
  const pdfName = doc.Name || 'Documento';
  const TenantAppName = 'Firma Digital Brascuba';

  // El destinatario es única y exclusivamente el usuario firmante
  const recipient = (
    signUser?.Email ||
    signUser?.email ||
    sender?.Email ||
    sender?.email ||
    doc?.SenderMail ||
    ''
  ).toLowerCase().trim();

  if (!recipient) {
    console.warn(`[sendSelfSignCompletedMail] No se encontró correo de destinatario para el doc: ${doc?.objectId}`);
    return;
  }

  const signerName = signUser?.Name || signUser?.name || sender?.Name || recipient;
  const publicUrl = process.env.PUBLIC_URL || obj.publicUrl || 'https://localhost:3001';
  const encodeBase64 = Buffer.from(`${doc.objectId}/${recipient}`).toString('base64');
  const viewDocUrl = `${publicUrl}/login/${encodeBase64}`;

  let subject = `[Firma Digital] Usted ha firmado correctamente el documento "${pdfName}"`;
  let body =
    "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8' /></head><body><div style='background-color:#f5f5f5;padding:20px'>" +
    "<div style='background-color:white;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)'>" +
    `<div style='padding:16px 20px;font-family:system-ui,sans-serif;background-color:#0b3c6d'><h2 style='font-size:18px;margin:0;color:white;'>Documento Firmado Correctamente</h2></div>` +
    `<div style='padding:24px 20px;font-family:system-ui,sans-serif;font-size:14px;color:#333;line-height:1.6'>` +
    `<p>Estimado(a) <strong>${signerName}</strong>,</p>` +
    `<p>Le confirmamos que <strong>usted ha firmado correctamente</strong> el documento <strong>"${pdfName}"</strong>.</p>` +
    `<div style='background-color:#e8f5e9;border-left:4px solid #28a745;padding:12px 16px;margin:18px 0'>` +
    `<p style='margin:0;font-size:13px;color:#1e4620'><strong>Completado:</strong> El proceso de firma ha finalizado con éxito. Adjunto a este correo encontrará una copia oficial del documento firmado digitalmente.</p>` +
    `</div>` +
    `<div style='margin:25px 0'><a target='_blank' href='${viewDocUrl}' style='display:inline-block;padding:12px 24px;background-color:#0b3c6d;color:white;text-decoration:none;border-radius:4px;font-weight:bold'>Ver Documento en la Plataforma</a></div>` +
    `<p style='font-size:13px;color:#555'>También puede consultar y descargar el documento firmado directamente desde el archivo adjunto a este mensaje.</p>` +
    `</div></div>` +
    `<div><p style='padding:15px;color:#888;font-size:12px;text-align:center'>Mensaje automático generado por ${TenantAppName}.</p></div>` +
    `</div></body></html>`;

  const formatId = doc?.ExtUserPtr?.DownloadFilenameFormat;
  const filename = pdfName?.length > 100 ? pdfName?.slice(0, 100) : pdfName;
  const docName = buildDownloadFilename(formatId, {
    docName: filename,
    email: recipient,
    isSigned: true,
  });

  const params = {
    extUserId: sender?.objectId,
    url: url,
    from: TenantAppName,
    recipient: recipient,
    subject: subject,
    pdfName: pdfName,
    html: body,
    mailProvider: obj.mailProvider,
    certificatePath: `./exports/signed_certificate_${doc.objectId}.pdf`,
    filename: docName,
  };

  try {
    console.log(`[sendSelfSignCompletedMail] Enviando confirmación con adjunto a ${recipient} para doc "${pdfName}"`);
    const res = await sendMailWithAttachment(params);
    if (res?.status !== 'success') {
      unlinkFile(`./exports/signed_certificate_${doc.objectId}.pdf`);
    }
  } catch (err) {
    console.error('[sendSelfSignCompletedMail] Error enviando correo:', err);
    unlinkFile(`./exports/signed_certificate_${doc.objectId}.pdf`);
  }
}

// `sendSelfSignSaveCertificate` genera el certificado en Parse y envía el correo único de confirmación
async function sendSelfSignSaveCertificate(doc, pfx, isCustomMail, mailProvider, filename, signUser, publicUrl) {
  try {
    const certificate = await GenerateCertificate(doc);
    const certificatePdf = await PDFDocument.load(certificate);
    const P12Buffer = fs.readFileSync(pfx.name);
    const p12 = new P12Signer(P12Buffer, { passphrase: pfx.passphrase || null });
    pdflibAddPlaceholder({
      pdfDoc: certificatePdf,
      reason: `Digitally signed by ${eSignName}.`,
      location: 'n/a',
      name: eSignName,
      contactInfo: eSigncontact,
      signatureLength: 16000,
    });
    const pdfWithPlaceholderBytes = await certificatePdf.save();
    const CertificateBuffer = Buffer.from(pdfWithPlaceholderBytes);
    const certificateOBJ = new SignPdf();
    const signedCertificate = await certificateOBJ.sign(CertificateBuffer, p12);
    const certificatePath = `./exports/signed_certificate_${doc.objectId}.pdf`;

    fs.writeFileSync(certificatePath, signedCertificate);
    const file = await uploadFile('certificate.pdf', certificatePath);
    const body = { CertificateUrl: file.imageUrl };
    await axios.put(`${docUrl}/${doc.objectId}`, body, { headers });

    if (doc.IsSendMail === false) {
      console.log("[sendSelfSignSaveCertificate] IsSendMail es false, omitiendo correo");
    } else {
      await sendSelfSignCompletedMail({ isCustomMail, doc, mailProvider, filename, signUser, publicUrl });
    }
    saveFileUsage(CertificateBuffer.length, file.imageUrl, doc?.CreatedBy?.objectId);
    unlinkFile(pfx.name);
    return file.imageUrl;
  } catch (err) {
    console.error('[sendSelfSignSaveCertificate] Error:', err);
    unlinkFile(pfx.name);
  }
}

/**
 * Process a PDF for signing:
 * - updates audit trail, generates certificate.
 * - Optionally inserts a signature placeholder (Placeholder()).
 * - Otherwise (no merge + no placeholder), it flattens forms for finalization.
 *
 * @param {Object} _resDoc - Document details (expects AuditTrail, etc.)
 * @param {Buffer|Uint8Array} pdfBytes - Original PDF bytes
 * @param {string} [options.reason] - Reason text used in placeholder
 * @param {string} [options.UserPtr] -  user pointer (for audit trail)
 * @param {string} [options.ipAddress] - IP (for audit trail)
 * @param {string} [options.Signature] - Signature (for audit trail)
 * @returns {Promise<Buffer>} merged PDF Buffer
 */
async function processPdf(_resDoc, PdfBuffer, reason) {
  // No CC merge; operate directly on the original PDF
  const pdfDoc = await PDFDocument.load(PdfBuffer);
  const form = pdfDoc.getForm();
  // Updates the field appearances to ensure visual changes are reflected.
  form.updateFieldAppearances();
  // Flattens the form, converting all form fields into non-editable, static content
  form.flatten();
  Placeholder({
    pdfDoc: pdfDoc,
    reason: `Digitally signed by ${eSignName} for ${reason}`,
    location: 'n/a',
    name: eSignName,
    contactInfo: eSigncontact,
    signatureLength: 16000,
  });
  const pdfWithPlaceholderBytes = await pdfDoc.save();
  return Buffer.from(pdfWithPlaceholderBytes);
}
/**
 *
 * @param docId Id of Document in which user is signing
 * @param pdfFile base64 of pdfFile which you want sign
 * @returns if success {status, data} else {status, message}
 */
async function PDF(req) {
  const docId = req.params.docId;
  const randomNumber = Math.floor(Math.random() * 5000);
  const pfxname = `keystore_${randomNumber}.pfx`;
  try {
    const userIP = req.headers['x-real-ip']; // client IPaddress
    const reqUserId = req.params.userId;
    const isCustomMail = req.params.isCustomCompletionMail || false;
    const mailProvider = req.params.mailProvider || '';
    const sign = req.params.signature || '';
    const auditActivity = 'Signed';
    const publicUrl = req.headers.public_url;
    // below bode is used to get info of docId
    const docQuery = new Parse.Query('contracts_Document');
    docQuery.include('ExtUserPtr,Signers,ExtUserPtr.TenantId,Bcc,Cc,CreatedBy');
    docQuery.equalTo('objectId', docId);
    docQuery.notEqualTo('IsDeclined', true);
    docQuery.notEqualTo('IsArchive', true);
    const resDoc = await docQuery.first({ useMasterKey: true });
    if (!resDoc) {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
    }
    const IsEnableOTP = resDoc?.get('IsEnableOTP') || false;
    // if `IsEnableOTP` is false then we don't have to check authentication
    if (IsEnableOTP) {
      if (!req?.user) {
        throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
      }
    }
    const _resDoc = resDoc?.toJSON();
    if (_resDoc?.CorporateSigning === true) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'This document requires incremental corporate digital signatures.'
      );
    }
    let signUser;
    let className;
    // `reqUserId` is send throught pdfrequest signing flow
    if (reqUserId) {
      // to get contracts_Contactbook details for currentuser from reqUserId
      const _contractUser = _resDoc.Signers.find(x => x.objectId === reqUserId);
      if (_contractUser) {
        signUser = _contractUser;
        className = 'contracts_Contactbook';
      }
    } else {
      className = 'contracts_Users';
      signUser = _resDoc.ExtUserPtr;
    }
    // Strict-order gating: when both `SendinOrder` and `SendInOrderStrict`
    // are enabled the document creator wants the signing flow locked to a
    // strict sequence — a signer/approver may only act once every previous
    // signer/approver placeholder has a Signed/Approved audit entry. We
    // skip this check entirely for the document owner (className=Users)
    // because owners never sign through this path.
    const isSendInOrderDoc = _resDoc?.SendinOrder === true || _resDoc?.SendinOrder === 'true';
    const isStrictOrderDoc = _resDoc?.SendInOrderStrict === true || _resDoc?.SendInOrderStrict === 'true';
    if (reqUserId && (isSendInOrderDoc || isStrictOrderDoc)) {
      const placeholders = Array.isArray(_resDoc?.Placeholders)
        ? _resDoc.Placeholders.filter(p => p?.Role !== 'prefill')
        : [];
      const myIdx = findPlaceholderIndex(placeholders, reqUserId);
      if (myIdx > 0) {
        const pendingId = findPendingPriorSigner(placeholders, myIdx, _resDoc?.AuditTrail);
        if (pendingId) {
          throw new Parse.Error(
            Parse.Error.OPERATION_FORBIDDEN,
            'Strict signing order is enabled — please wait for the previous signers to complete their action before signing.'
          );
        }
      }
    }
    const username = signUser.Name;
    const userEmail = signUser.Email;
    if (req.params.pdfFile) {
      //  `PdfBuffer` used to create buffer from pdf file
      let PdfBuffer = Buffer.from(req.params.pdfFile, 'base64');
      //  `P12Buffer` used to create buffer from p12 certificate
      let pfxFile = process.env.PFX_BASE64;
      let passphrase = process.env.PASS_PHRASE;
      if (_resDoc?.ExtUserPtr?.TenantId?.PfxFile?.base64) {
        pfxFile = _resDoc?.ExtUserPtr?.TenantId?.PfxFile?.base64;
        passphrase = _resDoc?.ExtUserPtr?.TenantId?.PfxFile?.password;
      }
      const pfx = { name: pfxname, passphrase: passphrase };
      const P12Buffer = Buffer.from(pfxFile, 'base64');
      fs.writeFileSync(pfxname, P12Buffer);
      const UserPtr = { __type: 'Pointer', className: className, objectId: signUser.objectId };
      const obj = { UserPtr: UserPtr, SignedUrl: '', Activity: auditActivity, ipAddress: userIP };
      let updateAuditTrail;
      if (_resDoc.AuditTrail && _resDoc.AuditTrail.length > 0) {
        updateAuditTrail = [..._resDoc.AuditTrail, obj];
      } else {
        updateAuditTrail = [obj];
      }

      // Both Signed and Approved entries count toward completion. Only
      // signer/approver placeholders are counted; viewers and prefill are
      // excluded.
      const auditTrail = updateAuditTrail.filter(x => COMPLETION_ACTIVITIES.includes(x.Activity));
      let isCompleted = false;
      if (_resDoc.Signers && _resDoc.Signers.length > 0) {
        const completionRelevant =
          _resDoc?.Placeholders?.length > 0
            ? _resDoc.Placeholders.filter(isCompletionRelevant)
            : [];
        if (auditTrail.length >= completionRelevant.length && completionRelevant.length > 0) {
          isCompleted = true;
        }
      } else {
        isCompleted = true;
      }
      // below regex is used to replace all word with "_" except A to Z, a to z, numbers
      const docName = _resDoc?.Name?.replace(/[^a-zA-Z0-9._-]/g, '_')?.toLowerCase();
      const filename = docName?.length > 100 ? docName?.slice(0, 100) : docName;
      const name = `${filename}_${randomNumber}.pdf`;
      let filePath = `./exports/${name}`;
      let signedFilePath = `./exports/signed_${name}`;
      let pdfSize = PdfBuffer.length;
      let documentHash;
      if (isCompleted) {
        const signersName = _resDoc.Signers?.map(x => x.Name + ' <' + x.Email + '>');
        const reason =
          signersName && signersName.length > 0
            ? signersName?.join(', ')
            : username + ' <' + userEmail + '>';
        const p12Cert = new P12Signer(P12Buffer, { passphrase: passphrase || null });
        signedFilePath = `./exports/signed_${name}`;
        PdfBuffer = await processPdf(_resDoc, PdfBuffer, reason, UserPtr, userIP, sign);
        //`new signPDF` create new instance of pdfBuffer and p12Buffer
        const OBJ = new SignPdf();
        // `signedDocs` is used to signpdf digitally
        const signedDocs = await OBJ.sign(PdfBuffer, p12Cert);

        //`saveUrl` is used to save signed pdf in exports folder
        fs.writeFileSync(signedFilePath, signedDocs);
        pdfSize = signedDocs.length;
        documentHash = generateDocumentHash(signedDocs);
        console.log(`✅ PDF digitally signed created: ${signedFilePath} \n`);
      } else {
        //`saveUrl` is used to save signed pdf in exports folder
        fs.writeFileSync(signedFilePath, PdfBuffer);
        pdfSize = PdfBuffer.length;
        console.log(`New Signed PDF created called: ${signedFilePath}`);
      }

      // `uploadFile` is used to upload pdf to aws s3 and get it's url
      const data = await uploadFile(`signed_${name}`, signedFilePath);

      if (data && data.imageUrl) {
        // `axios` is used to update signed pdf url in contracts_Document classes for given DocId
        const updatedDoc = await updateDoc(
          req.params.docId, //docId
          data.imageUrl, // SignedUrl
          signUser.objectId, // userID
          userIP, // client ipAddress,
          _resDoc, // auditTrail, signers, etc data
          className, // className based on flow
          sign, // sign base64
          isCompleted ? documentHash : undefined,
          auditActivity
        );
        // sendNotifyMail(docForNotify, signUser, mailProvider, publicUrl);
        const isSelfSign = req.params?.isSelfSign === true || _resDoc?.IsSignyourself === true;

        if (isSelfSign) {
          console.log(`[signPdf] Modo Firma tú mismo detectado para "${_resDoc?.Name}". Omitiendo notificación de avance.`);
        } else {
          const docForNotify = {
            ..._resDoc,
            AuditTrail: updatedDoc?.AuditTrail || _resDoc?.AuditTrail,
            SignedUrl: data?.imageUrl || _resDoc?.SignedUrl,
          };
          sendNotifyMail(docForNotify, signUser, mailProvider, publicUrl);
        }
        saveFileUsage(pdfSize, data.imageUrl, _resDoc?.CreatedBy?.objectId);
        if (updatedDoc && updatedDoc.isCompleted) {
          const hashForDoc = documentHash || updatedDoc?.DocumentHash;
          const doc = { ..._resDoc, AuditTrail: updatedDoc.AuditTrail, SignedUrl: data.imageUrl };
          if (hashForDoc) {
            doc.DocumentHash = hashForDoc;
          }
          if (isSelfSign) {
            sendSelfSignSaveCertificate(doc, pfx, isCustomMail, mailProvider, `signed_${name}`, signUser, publicUrl);
          } else {
            sendMailsaveCertifcate(doc, pfx, isCustomMail, mailProvider, `signed_${name}`);
          }
        } else {
          unlinkFile(pfxname);
        }
        // below code is used to remove exported signed pdf file from exports folder
        unlinkFile(signedFilePath);
        // console.log(`New Signed PDF created called: ${filePath}`);
        if (updatedDoc.message === 'success') {
          return { status: 'success', data: data.imageUrl };
        } else {
          const error = new Error('Please provide required parameters!');
          error.code = 400; // Set the error code (e.g., 400 for bad request)
          throw error;
        }
      }
    } else {
      const error = new Error('Pdf file not present!');
      error.code = 400; // Set the error code (e.g., 400 for bad request)
      throw error;
    }
  } catch (err) {
    console.log('Err in signpdf', err);
    const body = { DebugginLog: err?.message };
    try {
      await axios.put(`${docUrl}/${docId}`, body, { headers });
    } catch (err) {
      console.log('err in saving debugginglog', err);
    }
    unlinkFile(pfxname);
    throw err;
  }
}

async function getCorporateSigningContext(req) {
  const docId = req.params.docId;
  const signerId = req.params.userId;
  const isSelfSign = req.params.isSelfSign === true;
  if (!docId || !signerId) {
    throw new Parse.Error(Parse.Error.INVALID_JSON, 'Document and signer are required.');
  }
  const docQuery = new Parse.Query('contracts_Document');
  docQuery.include('ExtUserPtr,Signers,ExtUserPtr.TenantId,CreatedBy');
  docQuery.equalTo('objectId', docId);
  docQuery.notEqualTo('IsDeclined', true);
  docQuery.notEqualTo('IsArchive', true);
  const document = await docQuery.first({ useMasterKey: true });
  if (!document) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
  }
  const data = document.toJSON();
  if (data.IsCompleted === true) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'El documento ya ha sido completado y sellado; no admite modificaciones ni firmas adicionales.'
    );
  }
  if (data.IsEnableOTP && !req?.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }
  const contactSigner = data.Signers?.find(item => item.objectId === signerId);
  const isOwnerSigner = data.ExtUserPtr?.objectId === signerId;
  const signer = contactSigner || (isOwnerSigner ? data.ExtUserPtr : null);
  if (!signer) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'Signer is not assigned to this document.'
    );
  }
  const className = contactSigner ? 'contracts_Contactbook' : 'contracts_Users';
  if (isSelfSign) {
    if (
      !isOwnerSigner ||
      data.IsSignyourself !== true ||
      signer.UserId?.objectId !== req.user?.id
    ) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Solo el propietario autenticado puede autofirmar digitalmente este documento.'
      );
    }
    return { data, signer, signerId, docId, className, userIP: req.headers['x-real-ip'] };
  }
  const placeholders = Array.isArray(data.Placeholders)
    ? data.Placeholders.filter(item => item?.Role !== 'prefill')
    : [];
  let signerIndex = findPlaceholderIndex(placeholders, signerId);
  if (signerIndex < 0 && signer?.Email) {
    signerIndex = placeholders.findIndex(
      p =>
        (p?.email && p.email.toLowerCase() === signer.Email.toLowerCase()) ||
        (p?.signerPtr?.objectId === signerId)
    );
  }
  if (signerIndex < 0 && placeholders.length > 0) {
    const isAssigned = data.Signers?.some(
      s => s.objectId === signerId || (s.Email && signer?.Email && s.Email.toLowerCase() === signer.Email.toLowerCase())
    );
    if (!isAssigned && !isOwnerSigner) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'El firmante no tiene asignado un recuadro de firma en este documento.'
      );
    }
  }
  // El orden de firma solo se valida si el documento/plantilla fue creado con orden obligatorio (SendinOrder === true)
  const isSendInOrderData = data.SendinOrder === true || data.SendinOrder === 'true';
  if (isSendInOrderData && placeholders.length > 0 && signerIndex > 0) {
    const pendingSignerId = findPendingPriorSigner(placeholders, signerIndex, data.AuditTrail);
    if (pendingSignerId) {
      throw new Parse.Error(
        Parse.Error.OPERATION_FORBIDDEN,
        'Las firmas deben aplicarse en el orden establecido de los firmantes. Aún debe firmar un firmante anterior.'
      );
    }
  }
  return { data, signer, signerId, docId, className, userIP: req.headers['x-real-ip'] };
}

function getCorporateSignerConfig() {
  const baseUrl = process.env.CORPORATE_SIGNER_URL;
  const token = process.env.CORPORATE_SIGNER_TOKEN;
  if (!baseUrl || !token) {
    throw new Parse.Error(
      Parse.Error.INTERNAL_SERVER_ERROR,
      'El servicio de firma digital corporativa no está configurado en el servidor.'
    );
  }
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    headers: { Authorization: `Bearer ${token}` },
  };
}

export async function prepareCorporateSignature(req) {
  const { data, signer, signerId, docId } = await getCorporateSigningContext(req);
  if (
    data.AuditTrail?.some(item => COMPLETION_ACTIVITIES.includes(item.Activity)) &&
    !data.CorporateSigning
  ) {
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      'La firma corporativa debe seleccionarse antes de que el primer firmante firme este documento.'
    );
  }
  const { pdfFile, certificate, page, box, reason, location } = req.params;
  if (!pdfFile || !certificate || !Array.isArray(box) || box.length !== 4) {
    throw new Parse.Error(
      Parse.Error.INVALID_JSON,
      'El PDF, certificado y coordenadas de firma son requeridos.'
    );
  }
  const completionRelevant =
    data.Placeholders?.length > 0
      ? data.Placeholders.filter(isCompletionRelevant)
      : [];
  const signedSignerIds = new Set(
    (data.AuditTrail || [])
      .filter(x => COMPLETION_ACTIVITIES.includes(x.Activity) && x.UserPtr?.objectId && x.UserPtr.objectId !== signerId)
      .map(x => x.UserPtr.objectId)
  );
  const signedSoFar = signedSignerIds.size;
  const totalExpected =
    completionRelevant.length > 0
      ? completionRelevant.length
      : (data.Signers?.length || 1);
  const isFinalSignature = Boolean(
    req.params.isSelfSign || (signedSoFar + 1 >= totalExpected)
  );
  const { baseUrl, headers: authHeaders } = getCorporateSignerConfig();
  try {
    const response = await axios.post(
      `${baseUrl}/prepare`,
      {
        pdf: pdfFile,
        certificate,
        document_id: docId,
        signer_id: signerId,
        email: signer.Email,
        page,
        box,
        reason: (reason && typeof reason === 'string' && reason.trim()) ? reason.trim() : undefined,
        location: (location && typeof location === 'string' && location.trim()) ? location.trim() : undefined,
        lock_document: isFinalSignature,
      },
      {
        headers: authHeaders,
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );
    return response.data;
  } catch (error) {
    const message = error.response?.data?.detail;
    throw new Parse.Error(
      Parse.Error.OPERATION_FORBIDDEN,
      message || 'No se pudo preparar la firma corporativa.'
    );
  }
}

export async function completeCorporateSignature(req) {
  const { data, signer, signerId, docId, className, userIP } =
    await getCorporateSigningContext(req);
  const { signatureId, cmsSignature, mailProvider, isCustomCompletionMail } = req.params;
  if (!signatureId || !cmsSignature) {
    throw new Parse.Error(
      Parse.Error.INVALID_JSON,
      'La sesión preparada y la firma CMS son requeridas.'
    );
  }
  const { baseUrl, headers: authHeaders } = getCorporateSignerConfig();
  let outputPath;
  let certificatePath;
  try {
    const response = await axios.post(
      `${baseUrl}/complete`,
      {
        signature_id: signatureId,
        document_id: docId,
        signer_id: signerId,
        cms_signature: cmsSignature,
      },
      {
        headers: authHeaders,
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );
    const signedPdf = Buffer.from(response.data.pdf, 'base64');
    const filename = `${docId}_${Date.now()}.pdf`;
    outputPath = `./exports/corporate_signed_${filename}`;
    fs.writeFileSync(outputPath, signedPdf);
    const uploaded = await uploadFile(`corporate_signed_${filename}`, outputPath);
    if (!uploaded?.imageUrl) {
      throw new Error('No se pudo subir el PDF firmado corporativamente.');
    }
    const updated = await updateDoc(
      docId,
      uploaded.imageUrl,
      signerId,
      userIP,
      data,
      className,
      '',
      COMPLETION_ACTIVITIES.length ? generateDocumentHash(signedPdf) : undefined,
      'Signed',
      true
    );
    if (!updated || updated === 'err' || updated.message !== 'success') {
      throw new Error('No se pudo actualizar el documento tras la firma.');
    }
    // sendNotifyMail(docForNotify, signer, mailProvider || '', req.headers.public_url);
    const isSelfSign = req.params?.isSelfSign === true || data?.IsSignyourself === true;
    const placeholderSigners = new Set(
      (data?.Placeholders || [])
        .filter(isCompletionRelevant)
        .map(p => p?.signerObjId || p?.signerPtr?.objectId || p?.email)
        .filter(Boolean)
    );
    const totalSigners = Math.max((data?.Signers || []).length, placeholderSigners.size);
    const isSingleSigner = isSelfSign || totalSigners <= 1;

    if (isSingleSigner) {
      console.log(`[completeCorporateSignature] Documento con un solo firmante detectado para "${data?.Name}". Omitiendo notificación de avance.`);
    } else {
      const docForNotify = {
        ...data,
        AuditTrail: updated?.AuditTrail || data?.AuditTrail,
        SignedUrl: uploaded?.imageUrl || data?.SignedUrl,
      };
      sendNotifyMail(docForNotify, signer, mailProvider || '', req.headers.public_url);
    }
    saveFileUsage(signedPdf.length, uploaded.imageUrl, data?.CreatedBy?.objectId);
    if (updated.isCompleted) {
      const tenantPfx = data?.ExtUserPtr?.TenantId?.PfxFile;
      const pfxBytes = tenantPfx?.base64 || process.env.PFX_BASE64;
      if (pfxBytes) {
        certificatePath = `corporate_completion_${docId}_${Date.now()}.pfx`;
        fs.writeFileSync(certificatePath, Buffer.from(pfxBytes, 'base64'));
        const pfx = {
          name: certificatePath,
          passphrase: tenantPfx?.password || process.env.PASS_PHRASE || null,
        };
        const completedDoc = {
          ...data,
          CorporateSigning: true,
          AuditTrail: updated.AuditTrail,
          SignedUrl: uploaded.imageUrl,
          DocumentHash: updated.DocumentHash,
        };
        if (isSelfSign) {
          await sendSelfSignSaveCertificate(
            completedDoc,
            pfx,
            Boolean(isCustomCompletionMail),
            mailProvider || '',
            `corporate_signed_${filename}`,
            signer,
            req.headers.public_url
          );
        } else {
          await sendMailsaveCertifcate(
            completedDoc,
            pfx,
            Boolean(isCustomCompletionMail),
            mailProvider || '',
            `corporate_signed_${filename}`
          );
        }
      }
    }
    return { status: 'success', data: uploaded.imageUrl };
  } catch (error) {
    if (error.response?.data?.detail) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, error.response.data.detail);
    }
    throw error;
  } finally {
    if (outputPath) {
      await unlinkFile(outputPath);
    }
    if (certificatePath) {
      await unlinkFile(certificatePath);
    }
  }
}

export async function signCorporatePdfDirect(req) {
  const { data, signer, signerId, docId, className, userIP } =
    await getCorporateSigningContext(req);
  const {
    pdfFile,
    p12File,
    password,
    page,
    box,
    reason,
    location,
    mailProvider,
    isCustomCompletionMail,
  } = req.params;
  if (!pdfFile || !Array.isArray(box) || box.length !== 4) {
    throw new Parse.Error(
      Parse.Error.INVALID_JSON,
      'PDF y coordenadas de firma requeridas.'
    );
  }
  const completionRelevant =
    data.Placeholders?.length > 0
      ? data.Placeholders.filter(isCompletionRelevant)
      : [];
  const signedSignerIds = new Set(
    (data.AuditTrail || [])
      .filter(x => COMPLETION_ACTIVITIES.includes(x.Activity) && x.UserPtr?.objectId && x.UserPtr.objectId !== signerId)
      .map(x => x.UserPtr.objectId)
  );
  const signedSoFar = signedSignerIds.size;
  const totalExpected =
    completionRelevant.length > 0
      ? completionRelevant.length
      : (data.Signers?.length || 1);
  const isFinalSignature = Boolean(
    req.params.isSelfSign || (signedSoFar + 1 >= totalExpected)
  );
  const { baseUrl, headers: authHeaders } = getCorporateSignerConfig();
  let outputPath;
  let certificatePath;
  try {
    const response = await axios.post(
      `${baseUrl}/sign_direct`,
      {
        pdf: pdfFile,
        p12: p12File || '',
        password: password || '',
        document_id: docId,
        signer_id: signerId,
        email: signer.Email,
        page,
        box,
        reason: (reason && typeof reason === 'string' && reason.trim()) ? reason.trim() : undefined,
        location: (location && typeof location === 'string' && location.trim()) ? location.trim() : undefined,
        lock_document: isFinalSignature,
      },
      {
        headers: authHeaders,
        timeout: 120000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      }
    );
    const signedPdf = Buffer.from(response.data.pdf, 'base64');
    const filename = `${docId}_${Date.now()}.pdf`;
    outputPath = `./exports/corporate_signed_${filename}`;
    fs.writeFileSync(outputPath, signedPdf);
    const uploaded = await uploadFile(`corporate_signed_${filename}`, outputPath);
    if (!uploaded?.imageUrl) {
      throw new Error('No se pudo subir el PDF firmado corporativamente.');
    }
    const updated = await updateDoc(
      docId,
      uploaded.imageUrl,
      signerId,
      userIP,
      data,
      className,
      '',
      COMPLETION_ACTIVITIES.length ? generateDocumentHash(signedPdf) : undefined,
      'Signed',
      true
    );
    if (!updated || updated === 'err' || updated.message !== 'success') {
      throw new Error('No se pudo actualizar el documento tras la firma.');
    }
    // sendNotifyMail(docForNotify, signer, mailProvider || '', req.headers.public_url);
    const isSelfSign = req.params?.isSelfSign === true || data?.IsSignyourself === true;
    const placeholderSigners = new Set(
      (data?.Placeholders || [])
        .filter(isCompletionRelevant)
        .map(p => p?.signerObjId || p?.signerPtr?.objectId || p?.email)
        .filter(Boolean)
    );
    const totalSigners = Math.max((data?.Signers || []).length, placeholderSigners.size);
    const isSingleSigner = isSelfSign || totalSigners <= 1;

    if (isSingleSigner) {
      console.log(`[signCorporatePdfDirect] Documento con un solo firmante detectado para "${data?.Name}". Omitiendo notificación de avance.`);
    } else {
      const docForNotify = {
        ...data,
        AuditTrail: updated?.AuditTrail || data?.AuditTrail,
        SignedUrl: uploaded?.imageUrl || data?.SignedUrl,
      };
      sendNotifyMail(docForNotify, signer, mailProvider || '', req.headers.public_url);
    }
    saveFileUsage(signedPdf.length, uploaded.imageUrl, data?.CreatedBy?.objectId);
    if (updated.isCompleted) {
      const tenantPfx = data?.ExtUserPtr?.TenantId?.PfxFile;
      const pfxBytes = tenantPfx?.base64 || process.env.PFX_BASE64;
      if (pfxBytes) {
        certificatePath = `corporate_completion_${docId}_${Date.now()}.pfx`;
        fs.writeFileSync(certificatePath, Buffer.from(pfxBytes, 'base64'));
        const pfx = {
          name: certificatePath,
          passphrase: tenantPfx?.password || process.env.PASS_PHRASE || null,
        };
        const completedDoc = {
          ...data,
          CorporateSigning: true,
          AuditTrail: updated.AuditTrail,
          SignedUrl: uploaded.imageUrl,
          DocumentHash: updated.DocumentHash,
        };
        if (isSelfSign) {
          await sendSelfSignSaveCertificate(
            completedDoc,
            pfx,
            Boolean(isCustomCompletionMail),
            mailProvider || '',
            `corporate_signed_${filename}`,
            signer,
            req.headers.public_url
          );
        } else {
          await sendMailsaveCertifcate(
            completedDoc,
            pfx,
            Boolean(isCustomCompletionMail),
            mailProvider || '',
            `corporate_signed_${filename}`
          );
        }
      }
    }
    return { status: 'success', data: uploaded.imageUrl };
  } catch (error) {
    if (error.response?.data?.detail) {
      throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, error.response.data.detail);
    }
    throw error;
  } finally {
    if (outputPath) {
      await unlinkFile(outputPath);
    }
    if (certificatePath) {
      await unlinkFile(certificatePath);
    }
  }
}

export default PDF;
