import { appName } from '../../Utils.js';
import sendMailWithAttachment from './sendMailWithAttachment.js';

export default async function forwardDoc(request) {
  try {
    if (!request.user) {
      throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'unauthorized.');
    }
    const { docId, recipients } = request.params;
    const isReceipents = recipients?.length > 0 && recipients?.length <= 10;
    if (docId && isReceipents) {
      const userPtr = { __type: 'Pointer', className: '_User', objectId: request.user.id };
      const docQuery = new Parse.Query('contracts_Document');
      docQuery
        .equalTo('objectId', docId)
        .equalTo('CreatedBy', userPtr)
        .notEqualTo('IsArchive', true)
        .notEqualTo('IsDeclined', true)
        .include('Signers')
        .include('ExtUserPtr')
        .include('Placeholders.signerPtr')
        .include('ExtUserPtr.TenantId');
      const docRes = await docQuery.first({ useMasterKey: true });
      if (!docRes) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Document not found.');
      }
      const _docRes = docRes?.toJSON();
      const docName = _docRes.Name;
      const extUserId = _docRes?.ExtUserPtr?.objectId;
      const TenantAppName = 'Firma Digital Brascuba';
      const from = _docRes?.SenderName || _docRes?.ExtUserPtr?.Email;
      const replyTo = _docRes?.SenderMail || _docRes?.ExtUserPtr?.Email || request.user.get('email');
      const senderName = _docRes?.SenderName || _docRes?.ExtUserPtr?.Name || 'El firmante';
      const basePublicUrl = process.env.PUBLIC_URL || 'https://localhost:3001';
      const loginUrl = `${basePublicUrl}/login`;

      try {
        let mailRes;
        for (let i = 0; i < recipients.length; i++) {
          const recipientEmail = recipients[i];
          const subject = `[Firma Digital] Documento firmado: "${docName}"`;
          const body =
            "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8'/></head><body><div style='background-color:#f5f5f5;padding:20px'><div style='background-color:white;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)'>" +
            `<div style='padding:16px 20px;font-family:system-ui,sans-serif;background-color:#0b3c6d'><h2 style='font-size:18px;margin:0;color:white;'>Copia de Documento Firmado</h2></div>` +
            `<div style='padding:24px 20px;font-family:system-ui,sans-serif;font-size:14px;color:#333;line-height:1.6'>` +
            `<p>Estimado(a) usuario(a),</p>` +
            `<p>Le informamos que el documento <strong>"${docName}"</strong> ha sido firmado y sellado digitalmente por <strong>${senderName}</strong>.</p>` +
            `<div style='background-color:#f0f4f8;border-left:4px solid #0b3c6d;padding:12px 16px;margin:18px 0'>` +
            `<p style='margin:0;font-size:13px;color:#333'><strong>Archivo adjunto:</strong> Una copia completa del documento firmado y certificado se encuentra adjunta a este correo en formato PDF.</p>` +
            `</div>` +
            `<div style='margin:25px 0'><a target='_blank' href='${loginUrl}' style='display:inline-block;padding:12px 24px;background-color:#0b3c6d;color:white;text-decoration:none;border-radius:4px;font-weight:bold'>Ingresar a la Plataforma</a></div>` +
            `<p style='font-size:12px;color:#777;margin-top:20px'><strong>Aviso de seguridad:</strong> El documento adjunto contiene una firma electrónica corporativa válida. Puede verificar su validez e integridad abriéndolo con visores PDF estándar (como PDF-XChange Editor o Adobe Acrobat).</p>` +
            `</div></div>` +
            `<div><p style='padding:15px;color:#888;font-size:12px;text-align:center'>Mensaje automático generado por Firma Digital Brascuba.</p></div>` +
            `</div></body></html>`;

          let params = {
            extUserId: extUserId,
            pdfName: docName,
            url: _docRes?.SignedUrl || '',
            recipient: recipientEmail,
            subject: subject,
            replyto: replyTo || '',
            from: from,
            html: body,
          };
          mailRes = await sendMailWithAttachment(params);
        }
        return mailRes;
      } catch (error) {
        const msg =
          error?.response?.data?.error ||
          error?.response?.data ||
          error?.message ||
          'Something went wrong.';
        throw new Parse.Error(400, msg);
      }
    } else {
      throw new Parse.Error(Parse.Error.INVALID_QUERY, 'please provide parameters.');
    }
  } catch (err) {
    console.log('Err in forwardDoc', err);
    throw err;
  }
}
