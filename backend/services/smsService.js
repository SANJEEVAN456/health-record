import twilio from 'twilio'

export function createTwilioService({
  accountSid,
  authToken,
  fromPhoneNumber,
  whatsappFromNumber,
}) {
  const hasSms = Boolean(accountSid && authToken && fromPhoneNumber)
  const hasVoice = Boolean(accountSid && authToken && fromPhoneNumber)
  const hasWhatsapp = Boolean(accountSid && authToken && whatsappFromNumber)
  const client = hasSms || hasWhatsapp ? twilio(accountSid, authToken) : null

  return {
    isConfigured() {
      return hasSms
    },
    isWhatsappConfigured() {
      return hasWhatsapp
    },
    isVoiceConfigured() {
      return hasVoice
    },
    async sendSms({ to, body }) {
      if (!client || !hasSms) {
        throw new Error('Twilio SMS credentials are missing. Please update your .env file.')
      }

      await client.messages.create({
        body,
        from: fromPhoneNumber,
        to,
      })
    },
    async sendWhatsapp({ to, body }) {
      if (!client || !hasWhatsapp) {
        throw new Error('Twilio WhatsApp settings are missing. Please update your .env file.')
      }

      await client.messages.create({
        body,
        from: `whatsapp:${whatsappFromNumber}`,
        to: `whatsapp:${to}`,
      })
    },
    async makeVoiceCall({ to, message }) {
      if (!client || !hasVoice) {
        throw new Error('Twilio voice settings are missing. Please update your .env file.')
      }

      const safeMessage = String(message)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;')

      await client.calls.create({
        from: fromPhoneNumber,
        to,
        twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">${safeMessage}</Say></Response>`,
      })
    },
  }
}
