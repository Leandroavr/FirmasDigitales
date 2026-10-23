import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { appName, smtpenable, smtpsecure, updateMailCount } from '../../Utils.js';
import { createTransport } from 'nodemailer';
async function sendMailProvider(req) {
  const app = appName;
  const extUserId = req.params?.extUserId || '';
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

    const platformName = process.env.PLATFORM_EMAIL_NAME || process.env.APP_NAME || 'Firma Digital Brascuba';
    const mailsender = smtpenable ? process.env.SMTP_USER_EMAIL : (process.env.MAILGUN_SENDER || 'firmadigital@empresa.cu');
    const fromHeader = `"${platformName}" <${mailsender}>`;
    const messageParams = {
      from: fromHeader,
      to: req.params.recipient,
      subject: req.params.subject,
      text: req.params.text || 'mail',
      html: req.params?.html ? req.params.html + reportMsg : '',
      bcc: req.params.bcc ? req.params.bcc : undefined,
    };

    if (transporterSMTP) {
      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await transporterSMTP.sendMail(messageParams);
          console.log(`smtp transporter res (${req.params?.recipient}, intento ${attempt}): `, res?.response);
          if (!res?.err) {
            if (extUserId) {
              await updateMailCount(extUserId);
            }
            return { status: 'success' };
          }
        } catch (sendErr) {
          lastErr = sendErr;
          console.warn(`[sendSystemMail] Intento ${attempt}/3 falló para ${req.params?.recipient}: ${sendErr.message}`);
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
  } catch (err) {
    console.log(`sendSystemMail Error: ${err}`);
    if (err) {
      return { status: 'error' };
    }
  } finally {
    if (transporterSMTP) {
      transporterSMTP?.close?.();
    }
  }
}

async function sendSystemMail(req) {
  const nonCustomMail = await sendMailProvider(req);
  return nonCustomMail;
}

export default sendSystemMail;
