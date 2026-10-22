import { appName } from '../../Utils.js';
import sendSystemMail from './sendSystemMail.js';

async function sendDeclineMail(doc, publicUrl, userId, reason) {
  try {
    const TenantAppName = 'Firma Digital Brascuba';
    const removePrefill =
      doc?.Placeholders?.length > 0 && doc?.Placeholders?.filter(x => x?.Role !== 'prefill');
    const signUser =
      removePrefill?.length > 0 &&
      removePrefill?.find(x => x?.signerPtr?.UserId?.objectId === userId);

    const sender = doc.ExtUserPtr;
    const pdfName = doc.Name;
    const creatorName = doc.ExtUserPtr?.Name || 'Usuario';
    const creatorEmail = doc.ExtUserPtr?.Email;
    const signerName = signUser?.signerPtr?.Name || 'Un firmante';
    const signerEmail = signUser?.signerPtr?.Email || signUser?.email || '';
    const viewDocUrl = `${publicUrl}/recipientSignPdf/${doc.objectId}`;
    const subject = `[Firma Digital] El documento "${pdfName}" ha sido rechazado`;
    const body =
      "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8'/></head><body>" +
      "<div style='background-color:#f5f5f5;padding:20px'>" +
      "<div style='background-color:white;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)'>" +
      "<div style='padding:16px 20px;font-family:system-ui,sans-serif;background-color:#c53030'><h2 style='font-size:18px;margin:0;color:white;'>Documento Rechazado</h2></div>" +
      `<div style='padding:24px 20px;font-family:system-ui,sans-serif;font-size:14px;color:#333;line-height:1.6'>` +
      `<p>Estimado(a) ${creatorName},</p>` +
      `<p>Le informamos que el firmante <strong>${signerName}</strong> (${signerEmail}) ha rechazado la firma del documento <strong>"${pdfName}"</strong>.</p>` +
      `<div style='background-color:#fff5f5;border-left:4px solid #c53030;padding:12px 16px;margin:18px 0'>` +
      `<p style='margin:0;font-size:13px;color:#333'><strong>Motivo del rechazo:</strong> ${reason || 'No especificado'}</p>` +
      `</div>` +
      `<div style='margin:25px 0'><a target='_blank' href='${viewDocUrl}' style='display:inline-block;padding:12px 24px;background-color:#0b3c6d;color:white;text-decoration:none;border-radius:4px;font-weight:bold'>Ver Documento</a></div>` +
      `</div></div>` +
      `<div><p style='padding:15px;color:#888;font-size:12px;text-align:center'>Mensaje automático generado por ${TenantAppName}.</p></div>` +
      `</div></body></html>`;

    const params = {
      extUserId: sender?.objectId,
      from: TenantAppName,
      recipient: creatorEmail,
      subject: subject,
      pdfName: pdfName,
      html: body,
    };
    await sendSystemMail({ params });
  } catch (err) {
    console.log('err in sendDeclineMail', err);
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
    docCls.include('ExtUserPtr.TenantId,Placeholders.signerPtr,Signers');
    docCls.notEqualTo('IsCompleted', true);
    docCls.notEqualTo('IsArchive', true);
    const updateDoc = await docCls.get(docId, { useMasterKey: true });
    if (updateDoc) {
      const _doc = JSON.parse(JSON.stringify(updateDoc));
      const isEnableOTP = updateDoc?.get('IsEnableOTP') || false;
      const isCreator = _doc?.CreatedBy?.objectId === userId;
      if (!isEnableOTP) {
        updateDoc.set('IsDeclined', true);
        updateDoc.set('DeclineReason', reason);
        updateDoc.set('DeclineBy', declineBy);
        await updateDoc.save(null, { useMasterKey: true });
        if (!isCreator) {
          sendDeclineMail(_doc, publicUrl, userId, reason);
        }
        return 'document declined';
      } else {
        if (!request?.user) {
          throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
        }
        updateDoc.set('IsDeclined', true);
        updateDoc.set('DeclineReason', reason);
        updateDoc.set('DeclineBy', declineBy);
        await updateDoc.save(null, { useMasterKey: true });
        const isCreator = _doc?.CreatedBy?.objectId === request?.user?.id;
        if (!isCreator) {
          sendDeclineMail(_doc, publicUrl, userId, reason);
        }
        return 'document declined';
      }
    } else {
      throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
    }
  } catch (err) {
    console.log('err while decling doc', err);
    throw err;
  }
}
