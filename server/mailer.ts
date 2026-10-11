import nodemailer from 'nodemailer';

// Envio de e-mail por SMTP (Gmail com senha de app, Outlook, Brevo, Resend, SES...).
// Variáveis: SMTP_HOST, SMTP_PORT (465 = TLS direto; 587 = STARTTLS), SMTP_USER, SMTP_PASS, SMTP_FROM.

export interface MailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}

export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export function recipients(variable: 'REPORT_EMAILS' | 'BACKUP_EMAILS'): string[] {
  const raw = process.env[variable] || (variable === 'BACKUP_EMAILS' ? process.env.REPORT_EMAILS : '') || '';
  return raw.split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
}

let transport: nodemailer.Transporter | null = null;

function getTransport(): nodemailer.Transporter {
  if (transport) return transport;
  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    connectionTimeout: 15_000,
    socketTimeout: 30_000
  });
  return transport;
}

export async function sendMail(to: string[], subject: string, html: string, attachments: MailAttachment[] = [], text?: string) {
  if (!smtpConfigured()) throw new Error('SMTP não configurado (defina SMTP_HOST e SMTP_FROM).');
  if (to.length === 0) throw new Error('Nenhum destinatário configurado.');
  await getTransport().sendMail({ from: process.env.SMTP_FROM, to: to.join(', '), subject, html, text, attachments });
}
