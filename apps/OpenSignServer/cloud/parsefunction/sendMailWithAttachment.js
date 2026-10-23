import fs from 'node:fs';
import path from 'node:path';
import https from 'https';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { appName, smtpenable, smtpsecure, updateMailCount } from '../../Utils.js';
import { createTransport } from 'nodemailer';
import axios from 'axios';

function safeUnlink(filePath, label = 'file') {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (err) {
      console.log(`sendMailWithAttachment unlink ${label} error`);
    }
  }
}
async function sendMailProvider(params) {
  const app = appName;
  const extUserId = params?.extUserId || '';
  const reportMsg = "";

  const mailgunApiKey = process.env.MAILGUN_API_KEY;
  let transporterSMTP;
  try {
    let mailgunClient;
    let mailgunDomain;
    if (smtpenable) {
      let transporterConfig = {
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT || 465,
        secure: smtpsecure,
        tls: {
          rejectUnauthorized: false,
        },
        connectionTimeout: 15000,
        greetingTimeout: 15000,
        socketTimeout: 20000,
      };

      // ✅ Add auth if password and username/email exist
      const smtpUser = process.env.SMTP_USERNAME || process.env.SMTP_USER_EMAIL;
      const smtpPass = process.env.SMTP_PASS;

      if (smtpUser && smtpPass) {
        transporterConfig.auth = {
          user: smtpUser,
          pass: smtpPass,
        };
      }
      transporterSMTP = createTransport(transporterConfig);
    } else {
      if (mailgunApiKey) {
        const mailgun = new Mailgun(formData);
        mailgunClient = mailgun.client({ username: 'api', key: mailgunApiKey });
        mailgunDomain = process.env.MAILGUN_DOMAIN;
      }
    }
    if (params.url) {
      try {
        let PdfBuffer;
        // 1. Intentar leer directamente del disco local (evita peticiones de red y problemas de certificados)
        try {
          let cleanUrl = params.url;
          let urlObj;
          try {
            urlObj = new URL(cleanUrl);
          } catch (_) {}
          const filenameInUrl = urlObj ? path.basename(urlObj.pathname) : path.basename(cleanUrl.split('?')[0]);
          const candidatePaths = [
            path.join('./files/files', filenameInUrl),
            path.join('./files', filenameInUrl),
            path.join('./exports', filenameInUrl),
            cleanUrl
          ];
          for (const p of candidatePaths) {
            if (fs.existsSync(p)) {
              const stat = fs.statSync(p);
              if (stat.isFile() && stat.size > 0) {
                PdfBuffer = fs.readFileSync(p);
                console.log(`[sendMailWithAttachment] Leído del almacenamiento local: ${p} (${PdfBuffer.length} bytes)`);
                break;
              }
            }
          }
        } catch (diskErr) {
          console.warn('[sendMailWithAttachment] Error comprobando disco local:', diskErr);
        }

        // 2. Si no se encontró en disco, descargarlo usando axios con bypass SSL
        if (!PdfBuffer || PdfBuffer.length === 0) {
          try {
            const httpsAgent = new https.Agent({ rejectUnauthorized: false });
            const res = await axios.get(params.url, {
              responseType: 'arraybuffer',
              httpsAgent,
              timeout: 30000,
              headers: {
                'X-Parse-Application-Id': process.env.APP_ID || 'opensign',
                'X-Parse-Master-Key': process.env.MASTER_KEY
              }
            });
            if (res?.data && res.data.length > 0) {
              PdfBuffer = Buffer.from(res.data);
              console.log(`[sendMailWithAttachment] Descargado por red: ${PdfBuffer.length} bytes`);
            }
          } catch (fetchErr) {
            console.warn('[sendMailWithAttachment] Error descargando archivo por red:', fetchErr.message);
          }
        }

        if (!PdfBuffer || PdfBuffer.length === 0) {
          console.error('[sendMailWithAttachment] ERROR: No se pudo obtener el PDF del documento.');
        }

        const pdfName = params.pdfName ? (params.pdfName.endsWith('.pdf') ? params.pdfName : `${params.pdfName}.pdf`) : 'documento_firmado.pdf';
        const filename = params.filename ? (params.filename.endsWith('.pdf') ? params.filename : `${params.filename}.pdf`) : pdfName;

        const file = {
          filename: filename,
          content: smtpenable ? PdfBuffer : undefined,
          data: smtpenable ? undefined : PdfBuffer,
        };

        // El usuario solicitó EXCLUSIVAMENTE enviar el documento firmado, SIN certificado adjunto
        const attachment = (file.content || file.data) ? [file] : [];
        const platformName = process.env.PLATFORM_EMAIL_NAME || process.env.APP_NAME || 'Firma Digital Brascuba';
        const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : (process.env.MAILGUN_SENDER || 'firmadigital@empresa.cu');
        const replyto = params?.replyto || params?.senderMail || '';
        const fromHeader = `"${platformName}" <${mailsender}>`;
        const messageParams = {
          from: fromHeader,
          to: params.recipient,
          subject: params.subject,
          text: params.text || 'mail',
          html: params?.html ? params.html + reportMsg : '',
          attachments: smtpenable ? attachment : undefined,
          attachment: smtpenable ? undefined : attachment,
          bcc: params.bcc ? params.bcc : undefined,
          cc: params.cc ? params.cc : undefined,
          replyTo: replyto ? replyto : undefined,
        };
        const certificatePath = params.certificatePath || `./exports/certificate.pdf`;

        if (transporterSMTP) {
          let lastErr;
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const res = await transporterSMTP.sendMail(messageParams);
              console.log(`smtp transporter res (${params?.recipient}, intento ${attempt}): `, res?.response);
              if (!res?.err) {
                if (extUserId) {
                  await updateMailCount(extUserId);
                }
                safeUnlink(certificatePath, 'certificate');
                return { status: 'success' };
              }
            } catch (sendErr) {
              lastErr = sendErr;
              console.warn(`[sendMailWithAttachment] Intento ${attempt}/3 falló para ${params?.recipient}: ${sendErr.message}`);
              if (attempt < 3) {
                await new Promise(r => setTimeout(r, 1500 * attempt));
              }
            }
          }
          if (lastErr) throw lastErr;
        } else {
          if (mailgunApiKey) {
            const res = await mailgunClient.messages.create(mailgunDomain, messageParams);
            console.log('mailgun res: ', res?.status);
            if (res.status === 200) {
              if (extUserId) {
                await updateMailCount(extUserId);
              }
              safeUnlink(certificatePath, 'certificate');
              return { status: 'success' };
            }
          } else {
            safeUnlink(certificatePath, 'certificate');
            return { status: 'error' };
          }
        }
      } catch (err) {
        console.log(`sendMailWithAttachment error: ${err}`);
        if (err) return { status: 'error' };
      }
    } else {
      const from = params.from || '';
      const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : process.env.MAILGUN_SENDER;
      const replyto = params?.replyto || '';
      const messageParams = {
        from: from + ' <' + mailsender + '>',
        to: params.recipient,
        subject: params.subject,
        text: params.text || 'mail',
        html: params?.html ? params.html + reportMsg : '',
        bcc: params.bcc ? params.bcc : undefined,
        cc: params.cc ? params.cc : undefined,
        replyTo: replyto ? replyto : undefined,
      };

      if (transporterSMTP) {
        let lastErr;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const res = await transporterSMTP.sendMail(messageParams);
            console.log(`smtp transporter res (${params?.recipient}, intento ${attempt}): `, res?.response);
            if (!res?.err) {
              if (extUserId) {
                await updateMailCount(extUserId);
              }
              cleanupPaths.forEach(file => safeUnlink(file.path, file.label));
              return { status: 'success' };
            }
          } catch (sendErr) {
            lastErr = sendErr;
            console.warn(`[sendMailWithAttachment] Intento ${attempt}/3 falló para ${params?.recipient}: ${sendErr.message}`);
            if (attempt < 3) {
              await new Promise(r => setTimeout(r, 1500 * attempt));
            }
          }
        }
        if (lastErr) throw lastErr;
      } else {
        if (mailgunApiKey) {
          const res = await mailgunClient.messages.create(mailgunDomain, messageParams);
          console.log('mailgun res: ', res?.status);
          if (res.status === 200) {
            if (extUserId) {
              await updateMailCount(extUserId);
            }
            return { status: 'success' };
          }
        } else {
          return { status: 'error' };
        }
      }
    }
  } catch (err) {
    console.log(`sendMailWithAttachment Error: ${err}`);
    if (err) {
      return { status: 'error' };
    }
  } finally {
    if (transporterSMTP) {
      transporterSMTP?.close?.();
    }
  }
}

// `sendMailWithAttachment` function is used to send completion and forwarded document mail and it also fix security issue.
export default async function sendMailWithAttachment(params) {
  const nonCustomMail = await sendMailProvider(params);
  return nonCustomMail;
}
