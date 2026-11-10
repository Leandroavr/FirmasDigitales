import sendSystemMail from './sendSystemMail.js';

const COMPLETION_ACTIVITIES = ['Signed', 'Approved'];

/**
 * Función principal que inspecciona documentos activos y envía recordatorios
 * preventivos (3 días, 2 días, 1 día antes) y notificaciones de expiración.
 */
export async function runExpirationJob() {
  const TenantAppName = 'Firma Digital Brascuba';
  const basePublicUrl = process.env.PUBLIC_URL || 'https://localhost:3001';
  console.log('[ExpirationJob] Iniciando verificación de documentos por expirar y expirados...');

  const summary = {
    checkedDocs: 0,
    reminders3d: 0,
    reminders2d: 0,
    reminders1d: 0,
    expiredNotified: 0,
    errors: 0,
  };

  try {
    const docQuery = new Parse.Query('contracts_Document');
    docQuery.notEqualTo('IsCompleted', true);
    docQuery.notEqualTo('IsDeclined', true);
    docQuery.notEqualTo('IsArchive', true);
    docQuery.exists('ExpiryDate');
    docQuery.include('ExtUserPtr.TenantId,Placeholders.signerPtr,Signers');
    docQuery.limit(500);

    const activeDocs = await docQuery.find({ useMasterKey: true });
    summary.checkedDocs = activeDocs.length;

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    for (const doc of activeDocs) {
      try {
        const expiryDate = doc.get('ExpiryDate');
        if (!expiryDate || isNaN(new Date(expiryDate).getTime())) {
          continue;
        }

        const expObj = new Date(expiryDate);
        const expStart = new Date(expObj.getFullYear(), expObj.getMonth(), expObj.getDate());
        const diffMs = expStart.getTime() - todayStart.getTime();
        const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

        const pdfName = doc.get('Name') || 'Documento';
        const sender = doc.get('ExtUserPtr');
        const creatorEmail = (sender?.get?.('Email') || sender?.Email || doc.get('SenderMail') || '').toLowerCase().trim();
        const creatorName = sender?.get?.('Name') || sender?.Name || 'Propietario';

        // 1. Identificar firmantes que ya completaron su firma
        const auditTrail = doc.get('AuditTrail') || [];
        const completedEmails = new Set(
          auditTrail
            .filter(x => COMPLETION_ACTIVITIES.includes(x.Activity) && x.UserPtr)
            .map(x => (x.UserPtr?.Email || x.UserPtr?.email || x.Email || '').toLowerCase().trim())
            .filter(Boolean)
        );
        const completedUserIds = new Set(
          auditTrail
            .filter(x => COMPLETION_ACTIVITIES.includes(x.Activity) && x.UserPtr)
            .map(x => (x.UserPtr?.objectId || x.UserPtr?.id || x.UserPtr).toString())
        );

        // 2. Extraer todos los firmantes y filtrar los pendientes
        const allParticipants = new Map(); // email -> name
        const pendingSigners = []; // { email, name }

        const rawSigners = doc.get('Signers') || [];
        if (Array.isArray(rawSigners)) {
          for (const s of rawSigners) {
            const m = (s?.Email || s?.email || '').toLowerCase().trim();
            const sId = (s?.objectId || s?.id || '').toString();
            const name = s?.Name || s?.name || m;
            if (m) {
              allParticipants.set(m, name);
              if (!completedEmails.has(m) && (!sId || !completedUserIds.has(sId))) {
                if (!pendingSigners.some(p => p.email === m)) {
                  pendingSigners.push({ email: m, name });
                }
              }
            }
          }
        }

        const rawPlaceholders = doc.get('Placeholders') || [];
        if (Array.isArray(rawPlaceholders)) {
          for (const p of rawPlaceholders) {
            if (p?.Role === 'prefill') continue;
            const m = (p?.email || p?.signerPtr?.Email || p?.signerPtr?.email || '').toLowerCase().trim();
            const pId = (p?.signerObjId || p?.signerPtr?.objectId || '').toString();
            const name = p?.signerName || p?.signerPtr?.Name || m;
            if (m) {
              if (!allParticipants.has(m) || allParticipants.get(m) === m) {
                allParticipants.set(m, name);
              }
              if (!completedEmails.has(m) && (!pId || !completedUserIds.has(pId))) {
                if (!pendingSigners.some(ps => ps.email === m)) {
                  pendingSigners.push({ email: m, name });
                }
              }
            }
          }
        }

        // Si ya no hay pendientes (o todos firmaron), este documento está listo para sellado o completado
        if (pendingSigners.length === 0) {
          continue;
        }

        const sentNotices = doc.get('ExpirationNotices') || [];
        const localExpireDate = expObj.toLocaleDateString('es-ES', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });

        // =========================================================================
        // CASO 1: Faltan 3 días para expirar
        // =========================================================================
        if (diffDays === 3 && !sentNotices.includes('3d')) {
          console.log(`[ExpirationJob] Enviando aviso de 3 días para "${pdfName}" (Doc ID: ${doc.id}). Pendientes: ${pendingSigners.length}`);
          for (const pending of pendingSigners) {
            const encodeBase64 = Buffer.from(`${doc.id}/${pending.email}`).toString('base64');
            const signUrl = `${basePublicUrl}/login/${encodeBase64}`;
            const html =
              "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8'/></head><body style='margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;'>" +
              "<div style='background-color:#f4f6f9;padding:25px 15px;'>" +
              "<div style='background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;margin:0 auto;border:1px solid #e5e7eb;'>" +
              "<div style='padding:20px 24px;background-color:#d97706;'><h2 style='font-size:18px;margin:0;color:#ffffff;font-weight:600;letter-spacing:0.3px;'>Recordatorio de Firma (Expira en 3 días)</h2></div>" +
              "<div style='padding:24px;color:#334155;font-size:14px;line-height:1.6;'>" +
              `<p style='margin-top:0;margin-bottom:14px;font-size:15px;color:#1e293b;'>Estimado(a) <strong>${pending.name}</strong>,</p>` +
              `<p style='margin-top:0;margin-bottom:18px;'>Le recordamos que tiene pendiente la firma del documento <strong>"${pdfName}"</strong>, el cual <strong>expira en 3 días</strong> (el ${localExpireDate}).</p>` +
              "<div style='background-color:#fffbeb;border:1px solid #fde68a;border-left:4px solid #d97706;border-radius:6px;padding:16px 18px;margin:18px 0;'>" +
              "<div style='font-size:11px;font-weight:700;color:#b45309;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;border-bottom:1px solid #fde68a;padding-bottom:5px;'>Plazo de Firma</div>" +
              "<table style='width:100%;border-collapse:collapse;font-size:13px;color:#334155;'>" +
              `<tr><td style='padding:5px 0;width:130px;font-weight:600;color:#64748b;'>Documento:</td><td style='padding:5px 0;font-weight:700;color:#0f172a;'>${pdfName}</td></tr>` +
              `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Solicitado por:</td><td style='padding:5px 0;color:#334155;'>${creatorName}</td></tr>` +
              `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Fecha de expiración:</td><td style='padding:5px 0;color:#b45309;font-weight:700;'>${localExpireDate} (3 días restantes)</td></tr>` +
              "</table></div>" +
              `<div style='margin:28px 0 20px 0;text-align:center;'><a target='_blank' href='${signUrl}' style='display:inline-block;padding:12px 28px;background-color:#0b3c6d;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;box-shadow:0 2px 4px rgba(11,60,109,0.25);'>Firmar Documento Ahora</a></div>` +
              "<div style='background-color:#fefce8;border:1px solid #fef08a;border-radius:4px;padding:10px 14px;margin-top:20px;'>" +
              "<p style='font-size:12px;color:#854d0e;margin:0;line-height:1.5;'><strong>Aviso de seguridad:</strong> Cada usuario debe iniciar sesión con sus credenciales institucionales para acceder a la plataforma.</p>" +
              "</div></div></div>" +
              `<div><p style='padding:16px;color:#94a3b8;font-size:12px;text-align:center;margin:0;'>Mensaje automático generado por ${TenantAppName}.</p></div>` +
              "</div></body></html>";

            await sendSystemMail({
              params: {
                extUserId: sender?.id,
                from: TenantAppName,
                recipient: pending.email,
                subject: `[Firma Digital] Recordatorio: El documento "${pdfName}" expira en 3 días`,
                pdfName: pdfName,
                html: html,
              },
            });
            await new Promise(r => setTimeout(r, 300));
          }
          sentNotices.push('3d');
          doc.set('ExpirationNotices', sentNotices);
          await doc.save(null, { useMasterKey: true });
          summary.reminders3d++;
        }

        // =========================================================================
        // CASO 2: Faltan 2 días para expirar
        // =========================================================================
        if (diffDays === 2 && !sentNotices.includes('2d')) {
          console.log(`[ExpirationJob] Enviando aviso de 2 días para "${pdfName}" (Doc ID: ${doc.id}). Pendientes: ${pendingSigners.length}`);
          for (const pending of pendingSigners) {
            const encodeBase64 = Buffer.from(`${doc.id}/${pending.email}`).toString('base64');
            const signUrl = `${basePublicUrl}/login/${encodeBase64}`;
            const html =
              "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8'/></head><body style='margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;'>" +
              "<div style='background-color:#f4f6f9;padding:25px 15px;'>" +
              "<div style='background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;margin:0 auto;border:1px solid #e5e7eb;'>" +
              "<div style='padding:20px 24px;background-color:#ea580c;'><h2 style='font-size:18px;margin:0;color:#ffffff;font-weight:600;letter-spacing:0.3px;'>Urgente: Firma Pendiente (Expira en 2 días)</h2></div>" +
              "<div style='padding:24px;color:#334155;font-size:14px;line-height:1.6;'>" +
              `<p style='margin-top:0;margin-bottom:14px;font-size:15px;color:#1e293b;'>Estimado(a) <strong>${pending.name}</strong>,</p>` +
              `<p style='margin-top:0;margin-bottom:18px;'>Le recordamos de forma urgente que el documento <strong>"${pdfName}"</strong> <strong>vencerá en 2 días</strong> (${localExpireDate}).</p>` +
              "<div style='background-color:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #ea580c;border-radius:6px;padding:16px 18px;margin:18px 0;'>" +
              "<div style='font-size:11px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;border-bottom:1px solid #fed7aa;padding-bottom:5px;'>Atención Requerida</div>" +
              "<table style='width:100%;border-collapse:collapse;font-size:13px;color:#334155;'>" +
              `<tr><td style='padding:5px 0;width:130px;font-weight:600;color:#64748b;'>Documento:</td><td style='padding:5px 0;font-weight:700;color:#0f172a;'>${pdfName}</td></tr>` +
              `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Solicitado por:</td><td style='padding:5px 0;color:#334155;'>${creatorName}</td></tr>` +
              `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Fecha de expiración:</td><td style='padding:5px 0;color:#ea580c;font-weight:700;'>${localExpireDate} (2 días restantes)</td></tr>` +
              "</table></div>" +
              `<div style='margin:28px 0 20px 0;text-align:center;'><a target='_blank' href='${signUrl}' style='display:inline-block;padding:12px 28px;background-color:#0b3c6d;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;box-shadow:0 2px 4px rgba(11,60,109,0.25);'>Firmar Documento Ahora</a></div>` +
              "<div style='background-color:#fefce8;border:1px solid #fef08a;border-radius:4px;padding:10px 14px;margin-top:20px;'>" +
              "<p style='font-size:12px;color:#854d0e;margin:0;line-height:1.5;'><strong>Aviso de seguridad:</strong> Cada usuario debe iniciar sesión con sus credenciales institucionales para acceder a la plataforma.</p>" +
              "</div></div></div>" +
              `<div><p style='padding:16px;color:#94a3b8;font-size:12px;text-align:center;margin:0;'>Mensaje automático generado por ${TenantAppName}.</p></div>` +
              "</div></body></html>";

            await sendSystemMail({
              params: {
                extUserId: sender?.id,
                from: TenantAppName,
                recipient: pending.email,
                subject: `[Firma Digital] Urgente: El documento "${pdfName}" expira en 2 días`,
                pdfName: pdfName,
                html: html,
              },
            });
            await new Promise(r => setTimeout(r, 300));
          }
          sentNotices.push('2d');
          doc.set('ExpirationNotices', sentNotices);
          await doc.save(null, { useMasterKey: true });
          summary.reminders2d++;
        }

        // =========================================================================
        // CASO 3: Falta 1 día para expirar (Mañana)
        // =========================================================================
        if (diffDays === 1 && !sentNotices.includes('1d')) {
          console.log(`[ExpirationJob] Enviando aviso de 1 día para "${pdfName}" (Doc ID: ${doc.id}). Pendientes: ${pendingSigners.length}`);
          for (const pending of pendingSigners) {
            const encodeBase64 = Buffer.from(`${doc.id}/${pending.email}`).toString('base64');
            const signUrl = `${basePublicUrl}/login/${encodeBase64}`;
            const html =
              "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8'/></head><body style='margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;'>" +
              "<div style='background-color:#f4f6f9;padding:25px 15px;'>" +
              "<div style='background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;margin:0 auto;border:1px solid #e5e7eb;'>" +
              "<div style='padding:20px 24px;background-color:#dc2626;'><h2 style='font-size:18px;margin:0;color:#ffffff;font-weight:600;letter-spacing:0.3px;'>Último Aviso: El Documento Expira Mañana</h2></div>" +
              "<div style='padding:24px;color:#334155;font-size:14px;line-height:1.6;'>" +
              `<p style='margin-top:0;margin-bottom:14px;font-size:15px;color:#1e293b;'>Estimado(a) <strong>${pending.name}</strong>,</p>` +
              `<p style='margin-top:0;margin-bottom:18px;'>Este es el <strong>último aviso</strong>: el plazo para firmar el documento <strong>"${pdfName}"</strong> <strong>vence mañana</strong> (${localExpireDate}).</p>` +
              "<div style='background-color:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;border-radius:6px;padding:16px 18px;margin:18px 0;'>" +
              "<div style='font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;border-bottom:1px solid #fecaca;padding-bottom:5px;'>Vencimiento Inminente</div>" +
              "<table style='width:100%;border-collapse:collapse;font-size:13px;color:#334155;'>" +
              `<tr><td style='padding:5px 0;width:130px;font-weight:600;color:#64748b;'>Documento:</td><td style='padding:5px 0;font-weight:700;color:#0f172a;'>${pdfName}</td></tr>` +
              `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Solicitado por:</td><td style='padding:5px 0;color:#334155;'>${creatorName}</td></tr>` +
              `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Fecha de expiración:</td><td style='padding:5px 0;color:#dc2626;font-weight:700;'>${localExpireDate} (Mañana)</td></tr>` +
              "</table></div>" +
              `<p style='font-size:13px;color:#dc2626;font-weight:600;'>Si no firma antes de que concluya el plazo, el documento expirará automáticamente y el trámite quedará cerrado.</p>` +
              `<div style='margin:28px 0 20px 0;text-align:center;'><a target='_blank' href='${signUrl}' style='display:inline-block;padding:12px 28px;background-color:#0b3c6d;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;box-shadow:0 2px 4px rgba(11,60,109,0.25);'>Firmar Documento Ahora</a></div>` +
              "<div style='background-color:#fefce8;border:1px solid #fef08a;border-radius:4px;padding:10px 14px;margin-top:20px;'>" +
              "<p style='font-size:12px;color:#854d0e;margin:0;line-height:1.5;'><strong>Aviso de seguridad:</strong> Cada usuario debe iniciar sesión con sus credenciales institucionales para acceder a la plataforma.</p>" +
              "</div></div></div>" +
              `<div><p style='padding:16px;color:#94a3b8;font-size:12px;text-align:center;margin:0;'>Mensaje automático generado por ${TenantAppName}.</p></div>` +
              "</div></body></html>";

            await sendSystemMail({
              params: {
                extUserId: sender?.id,
                from: TenantAppName,
                recipient: pending.email,
                subject: `[Firma Digital] Último aviso: El documento "${pdfName}" expira mañana`,
                pdfName: pdfName,
                html: html,
              },
            });
            await new Promise(r => setTimeout(r, 300));
          }
          sentNotices.push('1d');
          doc.set('ExpirationNotices', sentNotices);
          await doc.save(null, { useMasterKey: true });
          summary.reminders1d++;
        }

        // =========================================================================
        // CASO 4: Documento EXPIRADO (diffDays <= 0)
        // =========================================================================
        if (diffDays <= 0 && !sentNotices.includes('expired')) {
          console.log(`[ExpirationJob] Documento "${pdfName}" (Doc ID: ${doc.id}) ha EXPIRADO. Pendientes: ${pendingSigners.length}`);
          const pendingListStr = pendingSigners.map(p => `<strong>${p.name}</strong> (${p.email})`).join(', ');

          // A. Notificar al Propietario / Creador
          if (creatorEmail) {
            const ownerExpiredHtml =
              "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8'/></head><body style='margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;'>" +
              "<div style='background-color:#f4f6f9;padding:25px 15px;'>" +
              "<div style='background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;margin:0 auto;border:1px solid #e5e7eb;'>" +
              "<div style='padding:20px 24px;background-color:#991b1b;'><h2 style='font-size:18px;margin:0;color:#ffffff;font-weight:600;letter-spacing:0.3px;'>Documento Expirado</h2></div>" +
              "<div style='padding:24px;color:#334155;font-size:14px;line-height:1.6;'>" +
              `<p style='margin-top:0;margin-bottom:14px;font-size:15px;color:#1e293b;'>Estimado(a) <strong>${creatorName}</strong>,</p>` +
              `<p style='margin-top:0;margin-bottom:18px;'>Le informamos que el documento <strong>"${pdfName}"</strong> ha <strong>expirado</strong> al haberse alcanzado la fecha límite de firma (${localExpireDate}).</p>` +
              "<div style='background-color:#fef2f2;border:1px solid #fecaca;border-left:4px solid #991b1b;border-radius:6px;padding:16px 18px;margin:18px 0;'>" +
              "<div style='font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;border-bottom:1px solid #fecaca;padding-bottom:5px;'>Resumen de Expiración</div>" +
              "<table style='width:100%;border-collapse:collapse;font-size:13px;color:#334155;'>" +
              `<tr><td style='padding:5px 0;width:130px;font-weight:600;color:#64748b;'>Documento:</td><td style='padding:5px 0;font-weight:700;color:#0f172a;'>${pdfName}</td></tr>` +
              `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Fecha límite:</td><td style='padding:5px 0;color:#991b1b;font-weight:600;'>${localExpireDate}</td></tr>` +
              `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;vertical-align:top;'>Firmas no completadas:</td><td style='padding:5px 0;color:#991b1b;'>Se le venció el tiempo de firmar a: ${pendingListStr}</td></tr>` +
              `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Estado final:</td><td style='padding:5px 0;font-weight:700;color:#991b1b;'>Expirado y cerrado</td></tr>` +
              "</table></div>" +
              "<p style='font-size:13px;color:#64748b;'>El documento ya no admitirá más firmas en la plataforma. Si lo considera necesario, puede despachar una nueva solicitud de firma.</p>" +
              `<div style='margin:28px 0 20px 0;text-align:center;'><a target='_blank' href='${basePublicUrl}/recipientSignPdf/${doc.id}' style='display:inline-block;padding:12px 28px;background-color:#0b3c6d;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;box-shadow:0 2px 4px rgba(11,60,109,0.25);'>Ver Documento en la Plataforma</a></div>` +
              "<div style='background-color:#fefce8;border:1px solid #fef08a;border-radius:4px;padding:10px 14px;margin-top:20px;'>" +
              "<p style='font-size:12px;color:#854d0e;margin:0;line-height:1.5;'><strong>Aviso de seguridad:</strong> Cada usuario debe iniciar sesión con sus credenciales institucionales para acceder a la plataforma.</p>" +
              "</div></div></div>" +
              `<div><p style='padding:16px;color:#94a3b8;font-size:12px;text-align:center;margin:0;'>Mensaje automático generado por ${TenantAppName}.</p></div>` +
              "</div></body></html>";

            await sendSystemMail({
              params: {
                extUserId: sender?.id,
                from: TenantAppName,
                recipient: creatorEmail,
                subject: `[Firma Digital] Documento expirado: "${pdfName}"`,
                pdfName: pdfName,
                html: ownerExpiredHtml,
              },
            });
          }

          // B. Notificar a TODOS los participantes (tanto a los pendientes como a los que ya habían firmado)
          for (const [recipEmail, recipName] of allParticipants.entries()) {
            if (recipEmail === creatorEmail) continue;

            const isPending = pendingSigners.some(p => p.email === recipEmail);
            const recipIntro = isPending
              ? `Le informamos que el documento <strong>"${pdfName}"</strong> ha <strong>expirado</strong> debido a que se venció el plazo establecido sin registrar su firma (${localExpireDate}).`
              : `Le informamos que el documento <strong>"${pdfName}"</strong> ha <strong>expirado</strong> debido a que concluyó el plazo de firma sin que todos los firmantes requeridos completaran su rúbrica (pendiente por: ${pendingListStr}).`;

            const participantExpiredHtml =
              "<html><head><meta http-equiv='Content-Type' content='text/html; charset=UTF-8'/></head><body style='margin:0;padding:0;background-color:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,Helvetica,Arial,sans-serif;'>" +
              "<div style='background-color:#f4f6f9;padding:25px 15px;'>" +
              "<div style='background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);max-width:600px;margin:0 auto;border:1px solid #e5e7eb;'>" +
              "<div style='padding:20px 24px;background-color:#991b1b;'><h2 style='font-size:18px;margin:0;color:#ffffff;font-weight:600;letter-spacing:0.3px;'>Documento Expirado</h2></div>" +
              "<div style='padding:24px;color:#334155;font-size:14px;line-height:1.6;'>" +
              `<p style='margin-top:0;margin-bottom:14px;font-size:15px;color:#1e293b;'>Estimado(a) <strong>${recipName}</strong>,</p>` +
              `<p style='margin-top:0;margin-bottom:18px;'>${recipIntro}</p>` +
              "<div style='background-color:#fef2f2;border:1px solid #fecaca;border-left:4px solid #991b1b;border-radius:6px;padding:16px 18px;margin:18px 0;'>" +
              "<div style='font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px;border-bottom:1px solid #fecaca;padding-bottom:5px;'>Información del Documento</div>" +
              "<table style='width:100%;border-collapse:collapse;font-size:13px;color:#334155;'>" +
              `<tr><td style='padding:5px 0;width:130px;font-weight:600;color:#64748b;'>Documento:</td><td style='padding:5px 0;font-weight:700;color:#0f172a;'>${pdfName}</td></tr>` +
              `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Solicitado por:</td><td style='padding:5px 0;color:#334155;'>${creatorName}</td></tr>` +
              `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;'>Fecha de expiración:</td><td style='padding:5px 0;color:#991b1b;font-weight:600;'>${localExpireDate}</td></tr>` +
              `<tr><td style='padding:5px 0;font-weight:600;color:#64748b;vertical-align:top;'>Firmas pendientes:</td><td style='padding:5px 0;color:#991b1b;'>${pendingListStr}</td></tr>` +
              "</table></div>" +
              "<p style='font-size:13px;color:#64748b;'>El documento ha quedado cerrado en la plataforma y no admite acciones posteriores.</p>" +
              `<div style='margin:28px 0 20px 0;text-align:center;'><a target='_blank' href='${basePublicUrl}/recipientSignPdf/${doc.id}' style='display:inline-block;padding:12px 28px;background-color:#0b3c6d;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;box-shadow:0 2px 4px rgba(11,60,109,0.25);'>Ver Documento</a></div>` +
              "<div style='background-color:#fefce8;border:1px solid #fef08a;border-radius:4px;padding:10px 14px;margin-top:20px;'>" +
              "<p style='font-size:12px;color:#854d0e;margin:0;line-height:1.5;'><strong>Aviso de seguridad:</strong> Cada usuario debe iniciar sesión con sus credenciales institucionales para acceder a la plataforma.</p>" +
              "</div></div></div>" +
              `<div><p style='padding:16px;color:#94a3b8;font-size:12px;text-align:center;margin:0;'>Mensaje automático generado por ${TenantAppName}.</p></div>` +
              "</div></body></html>";

            await sendSystemMail({
              params: {
                extUserId: sender?.id,
                from: TenantAppName,
                recipient: recipEmail,
                subject: `[Firma Digital] El documento "${pdfName}" ha expirado`,
                pdfName: pdfName,
                html: participantExpiredHtml,
              },
            });
            await new Promise(r => setTimeout(r, 300));
          }

          doc.set('IsExpired', true);
          sentNotices.push('expired');
          doc.set('ExpirationNotices', sentNotices);
          await doc.save(null, { useMasterKey: true });
          summary.expiredNotified++;
        }
      } catch (docErr) {
        summary.errors++;
        console.error(`[ExpirationJob] Error procesando documento ${doc.id}:`, docErr);
      }
    }
  } catch (err) {
    console.error('[ExpirationJob] Error general en el job de expiración:', err);
  }

  console.log(`[ExpirationJob] Finalizado. Resumen: Documentos revisados: ${summary.checkedDocs}, Avisos 3d: ${summary.reminders3d}, Avisos 2d: ${summary.reminders2d}, Avisos 1d: ${summary.reminders1d}, Expirados notificados: ${summary.expiredNotified}, Errores: ${summary.errors}`);
  return summary;
}

export default async function checkExpirationsJob(request) {
  return await runExpirationJob();
}
