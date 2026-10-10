import nodemailer from 'nodemailer'
import type { EmailTokenPurpose } from '../db/auth.ts'

export interface Mailer { configured?: boolean; send(to: string, purpose: EmailTokenPurpose, link: string): Promise<void> }
export interface SmtpConfiguration {
    host: string; port: number; secure: boolean; user: string; password: string; from: string
}
export function createMailer(config: SmtpConfiguration | null): Mailer {
    if (!config) return { configured: false, async send() { throw new Error('SMTP 未配置') } }
    const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure,
        auth: { user: config.user, pass: config.password }, connectionTimeout: 10000, socketTimeout: 15000,
        requireTLS: !config.secure,
    })
    return { configured: true, async send(to, purpose, link) {
        const verification = purpose === 'verify-email'
        await transport.sendMail({ from: config.from, to, subject: verification ? 'Idea Purify 邮箱验证' : 'Idea Purify 重设密码',
            text: `${verification ? '验证邮箱' : '重设密码'}：${link}\n链接 30 分钟内有效，只能使用一次。如果不是本人操作，请忽略。`,
        })
    } }
}
