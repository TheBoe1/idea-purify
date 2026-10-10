import nodemailer from 'nodemailer'
import { getSmtpConfiguration } from '../config.ts'
import { getEmailError } from '../../shared/contracts/auth.ts'

try {
    const config = getSmtpConfiguration()
    if (!config) throw new Error('SMTP 配置不完整，请补充 SMTP_HOST / USER / PASSWORD / FROM')
    const transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure,
        auth: { user: config.user, pass: config.password }, requireTLS: !config.secure,
        connectionTimeout: 10000, socketTimeout: 15000,
    })
    await transport.verify()
    console.log('SMTP 连接、TLS 和登录验证成功；这不代表收件箱已经收到邮件')
    if (process.argv.includes('--send')) {
        const to = process.env.MAIL_TEST_TO ?? ''
        if (getEmailError(to)) throw new Error('发送测试邮件需配置有效的 MAIL_TEST_TO')
        await transport.sendMail({ from: config.from, to, subject: 'Idea Purify 邮件验收', text: '这是已授权发送的 Idea Purify SMTP 测试邮件。' })
        console.log('测试邮件已交给 SMTP 服务，请在收件箱确认送达')
    }
    transport.close()
} catch (error) {
    // SMTP 服务错误可能包含认证或发送信息，不原样打印。
    const message = error instanceof Error && error.message.startsWith('SMTP 配置') ? error.message : '邮件检查失败，请检查配置、服务商授权和发件地址验证'
    console.error(message)
    process.exitCode = 1
}
