import { env } from '../env.js'

/**
 * Development-safe mail transport.
 *
 * No external provider is configured out of the box. When SMTP_URL is set the
 * deployment is expected to plug its provider here; until then messages are
 * written to the server log and, in development only, the action link can be
 * returned to the client when DEV_EXPOSE_VERIFICATION_LINKS=true.
 */
export async function sendMail({ to, subject, text, html }) {
  if (!env.smtpUrl) {
    console.log(`\n[mail:disabled] would send "${subject}" to ${to}\n${text}\n`)
    return { delivered: false, reason: 'email_not_configured' }
  }
  // A provider integration point. Kept intentionally minimal: deployments add
  // their own transport (SMTP/API) without changing the calling code.
  console.log(`[mail:queued] "${subject}" -> ${to}`)
  return { delivered: false, reason: 'provider_adapter_missing' }
}

export function verificationLink(token) {
  return `${env.publicSiteUrl}/verify-email?token=${encodeURIComponent(token)}`
}

export function resetLink(token) {
  return `${env.publicSiteUrl}/reset-password?token=${encodeURIComponent(token)}`
}

export function emailTemplate({ title, body, actionLabel, actionUrl, footnote }) {
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#F0FDF4;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #E5E7EB">
    <p style="color:#14532D;font-weight:700;margin:0 0 4px">BetterGo Marinduque</p>
    <p style="color:#647067;font-size:12px;margin:0 0 24px">Independent, community-driven civic information initiative</p>
    <h1 style="color:#17231B;font-size:22px;margin:0 0 16px">${title}</h1>
    <p style="color:#17231B;line-height:1.6">${body}</p>
    ${actionUrl ? `<p style="margin:28px 0"><a href="${actionUrl}" style="background:#16A34A;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${actionLabel}</a></p><p style="color:#647067;font-size:12px;word-break:break-all">${actionUrl}</p>` : ''}
    <p style="color:#647067;font-size:12px;margin-top:24px">${footnote || 'If you did not request this message you can ignore it.'}</p>
  </div></body></html>`
}
