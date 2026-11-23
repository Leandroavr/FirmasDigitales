import sendSystemMail from './sendSystemMail.js';

export default async function delegateDocumentToSecretary(request) {
  if (!request.user) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'User is not authenticated.');
  }

  const { docId, secretaryUserId } = request.params;
  if (!docId) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'docId is required.');
  }

  // 1. Obtener usuario remitente (el Jefe)
  const callerUserPtr = { __type: 'Pointer', className: '_User', objectId: request.user.id };
  const bossQuery = new Parse.Query('contracts_Users');
  bossQuery.equalTo('UserId', callerUserPtr);
  bossQuery.notEqualTo('IsDisabled', true);
  const bossExt = await bossQuery.first({ useMasterKey: true });
  if (!bossExt) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Usuario no encontrado.');
  }

  // 2. Obtener la secretaria vinculada
  let secExt = null;
  if (secretaryUserId) {
    secExt = await new Parse.Query('contracts_Users').get(secretaryUserId, { useMasterKey: true });
  } else {
    const secQuery = new Parse.Query('contracts_Users');
    secQuery.equalTo('BossPtr', { __type: 'Pointer', className: 'contracts_Users', objectId: bossExt.id });
    secQuery.notEqualTo('IsDisabled', true);
    secExt = await secQuery.first({ useMasterKey: true });
  }

  if (!secExt) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'No se encontró una secretaria vinculada a este usuario.');
  }

  // 3. Obtener el documento
  const docQuery = new Parse.Query('contracts_Document');
  docQuery.include('CreatedBy');
  docQuery.include('ExtUserPtr');
  const doc = await docQuery.get(docId, { useMasterKey: true });
  if (!doc) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Documento no encontrado.');
  }

  const secPointer = { __type: 'Pointer', className: 'contracts_Users', objectId: secExt.id };
  doc.set('DelegatedTo', secPointer);
  doc.set('DelegationStatus', 'PENDING_PREPARATION');
  doc.set('Status', 'Delegated');

  // Registrar en AuditTrail
  const bossName = bossExt.get('Name') || request.user.get('username') || 'El Jefe';
  const secName = secExt.get('Name') || 'Secretaría';
  const auditEntry = {
    UserPtr: callerUserPtr,
    Activity: 'Delegated',
    DelegatedTo: secPointer,
    DelegatedOn: new Date(),
    Note: `Documento delegado para preparación y colocación de cuadros a ${secName}`,
  };

  const auditTrail = doc.get('AuditTrail') || [];
  auditTrail.push(auditEntry);
  doc.set('AuditTrail', auditTrail);

  await doc.save(null, { useMasterKey: true });

  // 4. Notificar a la Secretaria por correo electrónico
  const secEmail = (secExt.get('Email') || '').toLowerCase().trim();
  const docTitle = doc.get('Name') || 'Documento sin título';
  const docType = doc.get('DocumentType') || '';
  const docDesc = doc.get('Description') || '';
  const docNote = doc.get('Note') || '';

  const publicUrl = process.env.PUBLIC_URL || 'https://localhost:3001';
  const prepUrl = `${publicUrl}/placeHolderSign/${docId}`;
  const TenantAppName = 'Firma Digital Brascuba';

  const emailSubject = `[Firma Digital Brascuba] Documento delegado por ${bossName}: "${docTitle}"`;
  const emailBody =
    "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8'/></head><body style='margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;'>" +
    "<div style='background-color:#f4f6f9;padding:25px 15px;'>" +
    "<div style='background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;margin:0 auto;border:1px solid #e5e7eb;'>" +
    "<div style='padding:20px 24px;background-color:#0b3c6d;'><h2 style='font-size:18px;margin:0;color:#ffffff;font-weight:600;letter-spacing:0.3px;'>Nuevo Documento Delegado</h2></div>" +
    "<div style='padding:24px;color:#334155;font-size:14px;line-height:1.6;'>" +
    `<p style='margin-top:0;margin-bottom:14px;font-size:15px;color:#1e293b;'>Estimada <strong>${secName}</strong>,</p>` +
    `<p style='margin-top:0;margin-bottom:18px;'>El usuario <strong>${bossName}</strong> le ha delegado la preparación y gestión del siguiente documento:</p>` +
    "<div style='background-color:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid #0b3c6d;border-radius:6px;padding:16px 18px;margin:18px 0;'>" +
    "<div style='font-size:11px;font-weight:700;color:#0b3c6d;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;border-bottom:1px solid #e2e8f0;padding-bottom:5px;'>Detalles del Documento</div>" +
    "<table style='width:100%;border-collapse:collapse;font-size:13px;color:#334155;'>" +
    `<tr><td style='padding:5px 0;width:110px;font-weight:600;color:#64748b;'>Título:</td><td style='padding:5px 0;font-weight:700;color:#0f172a;'>${docTitle}</td></tr>` +
    (docType ? `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Tipo de documento:</td><td style='padding:5px 0;font-weight:600;color:#0f172a;'>${docType}</td></tr>` : '') +
    (docDesc ? `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Descripción:</td><td style='padding:5px 0;color:#334155;'>${docDesc}</td></tr>` : '') +
    (docNote ? `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Notas:</td><td style='padding:5px 0;color:#334155;'>${docNote}</td></tr>` : '') +
    `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Asignado por:</td><td style='padding:5px 0;font-weight:600;color:#0b3c6d;'>${bossName}</td></tr>` +
    `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Estado:</td><td style='padding:5px 0;font-weight:700;color:#d97706;'>Pendiente de colocación de cuadros</td></tr>` +
    "</table></div>" +
    `<div style='margin:28px 0 20px 0;text-align:center;'><a target='_blank' href='${prepUrl}' style='display:inline-block;padding:12px 28px;background-color:#0b3c6d;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;box-shadow:0 2px 4px rgba(11,60,109,0.25);'>Ingresar a Preparar Documento</a></div>` +
    "<div style='background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:4px;padding:10px 14px;margin-top:20px;'>" +
    "<p style='font-size:12px;color:#1e40af;margin:0;line-height:1.5;'>Por favor, ubique los recuadros de firma para los destinatarios y proceda con el envío oficial del trámite.</p>" +
    "</div></div></div>" +
    `<div><p style='padding:16px;color:#94a3b8;font-size:12px;text-align:center;margin:0;'>Mensaje automático generado por ${TenantAppName}.</p></div>` +
    "</div></body></html>";

  if (secEmail) {
    try {
      await sendSystemMail({
        params: {
          extUserId: bossExt.id,
          from: TenantAppName,
          recipient: secEmail,
          subject: emailSubject,
          pdfName: docTitle,
          html: emailBody,
        },
      });
    } catch (mailErr) {
      console.error('Error enviando notificación a secretaria:', mailErr);
    }
  }

  return {
    status: 'success',
    message: `Documento delegado exitosamente a ${secName}.`,
    docId: doc.id,
    delegatedTo: secName,
  };
}
