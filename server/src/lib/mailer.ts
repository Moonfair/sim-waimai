import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
}

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

/** SMTP_HOST 未配置时 no-op（调用方无需自己判断）。 */
export async function sendMail(message: MailMessage): Promise<void> {
  const t = getTransporter();
  if (!t) return;
  await t.sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to: message.to,
    subject: message.subject,
    html: message.html,
  });
}
