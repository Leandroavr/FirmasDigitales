import { appName } from '../../Utils.js';
import sendSystemMail from './sendSystemMail.js';

async function sendDeclineMail(doc, publicUrl, userId, reason, isRevoke = false) {
  try {
    const TenantAppName = 'Firma Digital Brascuba';
    const basePublicUrl = process.env.PUBLIC_URL || publicUrl || 'https://localhost:3001';
    const pdfName = doc?.Name || 'Documento';
    const sender = doc?.ExtUserPtr;
    const creatorName = sender?.Name || doc?.CreatedBy?.name || 'Propietario';
    const creatorEmail = (sender?.Email || doc?.SenderMail || doc?.CreatedBy?.email || '').toLowerCase().trim();

    // 1. Recopilar a todos los firmantes convocados (email -> nombre)
    const allSigners = new Map();
    if (Array.isArray(doc?.Signers)) {
      for (const s of doc.Signers) {
        const m = (s?.Email || s?.email || '').toLowerCase().trim();
        if (m) allSigners.set(m, s?.Name || m);
      }
    }
    if (Array.isArray(doc?.Placeholders)) {
      for (const p of doc.Placeholders) {
        if (p?.Role === 'prefill') continue;
        const m = (p?.email || p?.signerPtr?.Email || p?.signerPtr?.email || '').toLowerCase().trim();
        if (m) {
          const n = p?.signerName || p?.signerPtr?.Name || m;
          if (!allSigners.has(m) || allSigners.get(m) === m) {
            allSigners.set(m, n);
          }
        }
      }
    }

    const reasonText = reason && reason.trim() ? reason.trim() : (isRevoke ? 'Revocado por el propietario' : 'No especificado');

    // Helper para armar plantilla HTML estándar con estilo Brascuba
    const buildMailHtml = ({ title, greeting, intro, detailsHeader, detailsRows, note, actionUrl }) => {
      let rowsHtml = '';
      for (const row of detailsRows) {
        rowsHtml += `<tr><td style='padding:5px 0;width:130px;font-weight:600;color:#64748b;'>${row.label}:</td><td style='padding:5px 0;${row.style || "font-weight:600;color:#0f172a;"}'>${row.value}</td></tr>`;
      }
      return (
        "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8'/></head><body style='margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;'>" +
        "<div style='background-color:#f4f6f9;padding:25px 15px;'>" +
        "<div style='background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;margin:0 auto;border:1px solid #e5e7eb;'>" +
        "<div style='padding:20px 24px;background-color:#c53030;'><h2 style='font-size:18px;margin:0;color:#ffffff;font-weight:600;letter-spacing:0.3px;'>" + title + "</h2></div>" +
        "<div style='padding:24px;color:#334155;font-size:14px;line-height:1.6;'>" +
        "<p style='margin-top:0;margin-bottom:14px;font-size:15px;color:#1e293b;'>" + greeting + "</p>" +
        "<p style='margin-top:0;margin-bottom:18px;'>" + intro + "</p>" +
        "<div style='background-color:#fef2f2;border:1px solid #fecaca;border-left:4px solid #c53030;border-radius:6px;padding:16px 18px;margin:18px 0;'>" +
        "<div style='font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;border-bottom:1px solid #fecaca;padding-bottom:5px;'>" + detailsHeader + "</div>" +
        "<table style='width:100%;border-collapse:collapse;font-size:13px;color:#334155;'>" +
        rowsHtml +
        "</table></div>" +
        (note ? "<p style='font-size:13px;color:#64748b;margin:14px 0;'>" + note + "</p>" : '') +
        (actionUrl ? "<div style='margin:28px 0 20px 0;text-align:center;'><a target='_blank' href='" + actionUrl + "' style='display:inline-block;padding:12px 28px;background-color:#0b3c6d;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;box-shadow:0 2px 4px rgba(11,60,109,0.25);'>Ver en la Plataforma</a></div>" : '') +
        "<div style='background-color:#fefce8;border:1px solid #fef08a;border-radius:4px;padding:10px 14px;margin-top:20px;'>" +
        "<p style='font-size:12px;color:#854d0e;margin:0;line-height:1.5;'><strong>Aviso de seguridad:</strong> Cada usuario debe iniciar sesión con sus credenciales institucionales para acceder a la plataforma.</p>" +
        "</div></div></div>" +
        "<div><p style='padding:16px;color:#94a3b8;font-size:12px;text-align:center;margin:0;'>Mensaje automático generado por " + TenantAppName + ".</p></div>" +
        "</div></body></html>"
      );
    };

    // ==========================================
    // CASO 1: REVOCACIÓN POR EL PROPIETARIO
    // ==========================================
    if (isRevoke) {
      // A. Confirmación al propietario
      if (creatorEmail) {
        try {
          const ownerHtml = buildMailHtml({
            title: 'Documento Revocado',
            greeting: 'Estimado(a) <strong>' + creatorName + '</strong>,',
            intro: 'Le confirmamos que ha <strong>revocado</strong> formalmente la solicitud de firma para el documento <strong>"' + pdfName + '"</strong>.',
            detailsHeader: 'Datos de la Revocación',
            detailsRows: [
              { label: 'Documento', value: pdfName, style: 'font-weight:700;color:#0f172a;' },
              { label: 'Revocado por', value: creatorName + ' (' + creatorEmail + ')', style: 'color:#0f172a;' },
              { label: 'Motivo', value: reasonText, style: 'color:#991b1b;font-weight:600;' },
              ...(doc?.DocumentType ? [{ label: 'Tipo de doc', value: doc.DocumentType, style: 'color:#334155;' }] : []),
              { label: 'Estado final', value: 'Revocado por el propietario', style: 'color:#c53030;font-weight:700;' }
            ],
            note: 'La solicitud ha sido anulada y los enlaces de firma han quedado deshabilitados. Si lo requiere, puede realizar una nueva solicitud de firma en la plataforma.',
            actionUrl: basePublicUrl + '/recipientSignPdf/' + doc.objectId
          });

          await sendSystemMail({
            params: {
              extUserId: sender?.objectId,
              from: TenantAppName,
              recipient: creatorEmail,
              subject: '[Firma Digital] Confirmación de revocación: "' + pdfName + '"',
              pdfName: pdfName,
              html: ownerHtml,
            },
          });
          console.log('[sendDeclineMail] Revocación notificada al propietario: ' + creatorEmail);
        } catch (errOwner) {
          console.error('[sendDeclineMail] Error notificando revocación al propietario:', errOwner);
        }
      }

      // B. Notificar a cada firmante convocado
      for (const [recipEmail, recipName] of allSigners.entries()) {
        if (recipEmail === creatorEmail) continue;
        try {
          const signerHtml = buildMailHtml({
            title: 'Solicitud de Firma Revocada',
            greeting: 'Estimado(a) <strong>' + recipName + '</strong>,',
            intro: 'Le informamos que el propietario del documento, <strong>' + creatorName + '</strong>, ha <strong>revocado</strong> la solicitud de firma para el documento <strong>"' + pdfName + '"</strong>.',
            detailsHeader: 'Información de la Solicitud',
            detailsRows: [
              { label: 'Documento', value: pdfName, style: 'font-weight:700;color:#0f172a;' },
              { label: 'Revocado por', value: creatorName + ' (Propietario)', style: 'color:#0f172a;' },
              { label: 'Motivo', value: reasonText, style: 'color:#991b1b;font-weight:600;' },
              ...(doc?.DocumentType ? [{ label: 'Tipo de doc', value: doc.DocumentType, style: 'color:#334155;' }] : []),
              { label: 'Estado final', value: 'Solicitud revocada', style: 'color:#c53030;font-weight:700;' }
            ],
            note: 'No se requiere ninguna acción de su parte. El documento ha quedado sin efecto y ya no se encuentra disponible para su firma.',
          });

          await sendSystemMail({
            params: {
              extUserId: sender?.objectId,
              from: TenantAppName,
              recipient: recipEmail,
              subject: '[Firma Digital] Solicitud de firma revocada: "' + pdfName + '"',
              pdfName: pdfName,
              html: signerHtml,
            },
          });
          console.log('[sendDeclineMail] Revocación notificada a firmante: ' + recipEmail);
          await new Promise(r => setTimeout(r, 300));
        } catch (errOther) {
          console.error('[sendDeclineMail] Error notificando revocación a firmante ' + recipEmail + ':', errOther);
        }
      }

      return;
    }

    // ==========================================
    // CASO 2: RECHAZO POR UN FIRMANTE
    // ==========================================
    let signerName = 'Un firmante';
    let signerEmail = '';

    if (Array.isArray(doc?.Placeholders)) {
      const p = doc.Placeholders.find(
        x =>
          x?.signerPtr?.UserId?.objectId === userId ||
          x?.signerPtr?.objectId === userId ||
          x?.signerObjId === userId
      );
      if (p) {
        signerName = p?.signerPtr?.Name || p?.signerName || signerName;
        signerEmail = (p?.signerPtr?.Email || p?.email || '').toLowerCase().trim();
      }
    }

    if (!signerEmail && Array.isArray(doc?.Signers)) {
      const s = doc.Signers.find(x => x?.objectId === userId || x?.UserId?.objectId === userId);
      if (s) {
        signerName = s?.Name || signerName;
        signerEmail = (s?.Email || s?.email || '').toLowerCase().trim();
      }
    }

    if (!signerEmail && userId) {
      try {
        const uQ = new Parse.Query(Parse.User);
        const u = await uQ.get(userId, { useMasterKey: true });
        if (u) {
          signerEmail = (u.get('email') || u.get('username') || '').toLowerCase().trim();
          signerName = u.get('name') || signerEmail || signerName;
        }
      } catch (_) {}
    }

    // A. Notificar al Propietario/Creador
    if (creatorEmail) {
      try {
        const ownerHtml = buildMailHtml({
          title: 'Documento Rechazado',
          greeting: 'Estimado(a) <strong>' + creatorName + '</strong>,',
          intro: 'Le informamos que el firmante <strong>' + signerName + '</strong> (' + (signerEmail || 'N/D') + ') ha <strong>rechazado la firma</strong> del documento <strong>"' + pdfName + '"</strong>.',
          detailsHeader: 'Información del Rechazo',
          detailsRows: [
            { label: 'Documento', value: pdfName, style: 'font-weight:700;color:#0f172a;' },
            { label: 'Rechazado por', value: signerName + ' (' + (signerEmail || 'N/D') + ')', style: 'color:#0f172a;' },
            { label: 'Motivo', value: reasonText, style: 'color:#991b1b;font-weight:600;' },
            ...(doc?.DocumentType ? [{ label: 'Tipo de doc', value: doc.DocumentType, style: 'color:#334155;' }] : []),
            { label: 'Estado final', value: 'Cancelado por rechazo', style: 'color:#c53030;font-weight:700;' }
          ],
          note: 'El proceso de firma ha sido cancelado. Si desea reiniciar el trámite, puede crear una nueva solicitud en la plataforma corrigiendo los puntos señalados.',
          actionUrl: basePublicUrl + '/recipientSignPdf/' + doc.objectId
        });
        await sendSystemMail({
          params: {
            extUserId: sender?.objectId,
            from: TenantAppName,
            recipient: creatorEmail,
            subject: '[Firma Digital] Documento rechazado: "' + pdfName + '"',
            pdfName: pdfName,
            html: ownerHtml,
          },
        });
        console.log('[sendDeclineMail] Notificado propietario: ' + creatorEmail);
      } catch (errOwner) {
        console.error('[sendDeclineMail] Error notificando al propietario:', errOwner);
      }
    }

    // B. Notificar al propio firmante que rechazó (Confirmación / Acuse)
    if (signerEmail && signerEmail !== creatorEmail) {
      try {
        const signerHtml = buildMailHtml({
          title: 'Confirmación de Rechazo de Firma',
          greeting: 'Estimado(a) <strong>' + signerName + '</strong>,',
          intro: 'Le confirmamos que ha <strong>rechazado</strong> formalmente la solicitud de firma para el documento <strong>"' + pdfName + '"</strong>.',
          detailsHeader: 'Datos de su Registro de Rechazo',
          detailsRows: [
            { label: 'Documento', value: pdfName, style: 'font-weight:700;color:#0f172a;' },
            { label: 'Rechazado por', value: signerName + ' (' + (signerEmail || 'N/D') + ')', style: 'color:#0f172a;' },
            { label: 'Motivo', value: reasonText, style: 'color:#991b1b;font-weight:600;' },
            ...(doc?.DocumentType ? [{ label: 'Tipo de doc', value: doc.DocumentType, style: 'color:#334155;' }] : []),
            { label: 'Estado final', value: 'Cancelado por rechazo', style: 'color:#c53030;font-weight:700;' }
          ],
          note: 'Se ha informado al creador del documento y a los demás participantes. El documento ha quedado cancelado.',
        });
        await sendSystemMail({
          params: {
            extUserId: sender?.objectId,
            from: TenantAppName,
            recipient: signerEmail,
            subject: '[Firma Digital] Confirmación de rechazo: "' + pdfName + '"',
            pdfName: pdfName,
            html: signerHtml,
          },
        });
        console.log('[sendDeclineMail] Notificado firmante declinante: ' + signerEmail);
      } catch (errSigner) {
        console.error('[sendDeclineMail] Error notificando al firmante declinante:', errSigner);
      }
    }

    // C. Notificar a todos los demás firmantes convocados
    for (const [recipEmail, recipName] of allSigners.entries()) {
      if (recipEmail === creatorEmail || recipEmail === signerEmail) {
        continue;
      }
      try {
        const othersHtml = buildMailHtml({
          title: 'Proceso de Firma Cancelado',
          greeting: 'Estimado(a) <strong>' + recipName + '</strong>,',
          intro: 'Le informamos que el proceso de firma para el documento <strong>"' + pdfName + '"</strong> ha sido <strong>cancelado</strong> debido a que el firmante <strong>' + signerName + '</strong> ha rechazado la solicitud.',
          detailsHeader: 'Información de la Cancelación',
          detailsRows: [
            { label: 'Documento', value: pdfName, style: 'font-weight:700;color:#0f172a;' },
            { label: 'Rechazado por', value: signerName + ' (' + (signerEmail || 'N/D') + ')', style: 'color:#0f172a;' },
            { label: 'Motivo', value: reasonText, style: 'color:#991b1b;font-weight:600;' },
            ...(doc?.DocumentType ? [{ label: 'Tipo de doc', value: doc.DocumentType, style: 'color:#334155;' }] : []),
            { label: 'Estado final', value: 'Cancelado por rechazo', style: 'color:#c53030;font-weight:700;' }
          ],
          note: 'No se requiere ninguna acción de su parte. El documento ha quedado cerrado definitivamente.',
        });
        await sendSystemMail({
          params: {
            extUserId: sender?.objectId,
            from: TenantAppName,
            recipient: recipEmail,
            subject: '[Firma Digital] Proceso cancelado por rechazo: "' + pdfName + '"',
            pdfName: pdfName,
            html: othersHtml,
          },
        });
        console.log('[sendDeclineMail] Notificado participante: ' + recipEmail);
        await new Promise(r => setTimeout(r, 300));
      } catch (errOther) {
        console.error('[sendDeclineMail] Error notificando a ' + recipEmail + ':', errOther);
      }
    }
  } catch (err) {
    console.log('Error global en sendDeclineMail:', err);
  }
}

export default async function declinedocument(request) {
  const docId = request.params.docId;
  const reason = request.params?.reason || '';
  const userId = request.params.userId;
  const declineBy = { __type: 'Pointer', className: '_User', objectId: userId };
  const publicUrl = request.headers.public_url;
  if (!docId) {
    throw new Parse.Error(Parse.Error.SCRIPT_FAILED, 'missing parameter docId.');
  }
  try {
    const docCls = new Parse.Query('contracts_Document');
    docCls.include('ExtUserPtr.TenantId,Placeholders.signerPtr,Signers,CreatedBy');
    docCls.notEqualTo('IsCompleted', true);
    docCls.notEqualTo('IsArchive', true);
    const updateDoc = await docCls.get(docId, { useMasterKey: true });
    if (updateDoc) {
      const _doc = JSON.parse(JSON.stringify(updateDoc));

      const isRevoke = Boolean(request.params?.isRevoke) ||
        (updateDoc.get('CreatedBy')?.id === userId) ||
        (_doc?.CreatedBy?.objectId === userId);

      updateDoc.set('IsDeclined', true);
      if (isRevoke) {
        updateDoc.set('IsRevoked', true);
      }
      updateDoc.set('DeclineReason', reason || (isRevoke ? 'Revocado por el propietario' : ''));
      updateDoc.set('DeclineBy', declineBy);
      await updateDoc.save(null, { useMasterKey: true });

      // Enviar notificaciones a todos los implicados
      sendDeclineMail(_doc, publicUrl, userId, reason, isRevoke);

      return isRevoke ? 'document revoked' : 'document declined';
    } else {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
    }
  } catch (err) {
    console.log('err while decling doc', err);
    throw err;
  }
}
