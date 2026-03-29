import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import cron from 'node-cron'
import path from 'path'
import { fileURLToPath } from 'url'
import { createTwilioService } from './services/smsService.js'
import {
  createDoseEvent,
  createReminder,
  deleteReminder,
  getActiveDoseEvents,
  getDoseEventById,
  getDoseEventByReminderKey,
  getDoseEventsReadyForAlert,
  getLatestOpenDoseByPhone,
  getReminderById,
  getReminders,
  initializeDatabase,
  markDoseAlertSent,
  markReminderSent,
  setReminderEnabled,
  updateDoseEventAction,
  updateReminder,
  updateReminderCounts,
} from '../database/db.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distPath = path.resolve(__dirname, '../dist')

const app = express()
const port = Number(process.env.PORT || 4000)
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const smsService = createTwilioService({
  accountSid: process.env.TWILIO_ACCOUNT_SID,
  authToken: process.env.TWILIO_AUTH_TOKEN,
  fromPhoneNumber: process.env.TWILIO_PHONE_NUMBER,
  whatsappFromNumber: process.env.TWILIO_WHATSAPP_NUMBER,
})

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true)
        return
      }

      callback(new Error('Origin not allowed by CORS'))
    },
  }),
)
app.use(express.json())
app.use(express.urlencoded({ extended: false }))

function isValidPhoneNumber(phoneNumber) {
  return /^\+[1-9]\d{7,14}$/.test(phoneNumber)
}

function isValidTime(value) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value)
}

function isValidTimezone(timezone) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date())
    return true
  } catch {
    return false
  }
}

function toPositiveInteger(value) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null
}

function normalizeTimes(slots = {}) {
  return Object.entries(slots)
    .filter(([, slot]) => slot?.selected)
    .map(([key, slot]) => ({
      key,
      label: slot.label,
      time: slot.time,
    }))
}

function validateReminderPayload(payload) {
  const medicineName = payload.medicineName?.trim()
  const phoneNumber = payload.phoneNumber?.trim()
  const caregiverPhoneNumber = payload.caregiverPhoneNumber?.trim() || ''
  const timezone = payload.timezone?.trim()
  const enabled = payload.enabled ?? true
  const repeatDaily = payload.repeatDaily ?? true
  const voiceEnabled = payload.voiceEnabled ?? false
  const totalTablets = toPositiveInteger(payload.totalTablets)
  const currentTablets = toPositiveInteger(payload.currentTablets)
  const times = normalizeTimes(payload.timeSlots)

  if (!medicineName || medicineName.length > 80) {
    return { error: 'Medicine name is required and should be under 80 characters.' }
  }

  if (!isValidPhoneNumber(phoneNumber)) {
    return {
      error: 'Phone number must be in international format, for example +919876543210.',
    }
  }

  if (caregiverPhoneNumber && !isValidPhoneNumber(caregiverPhoneNumber)) {
    return {
      error: 'Family member phone number must be in international format, for example +919876543210.',
    }
  }

  if (!isValidTimezone(timezone)) {
    return { error: 'Please choose a valid timezone.' }
  }

  if (!times.length) {
    return { error: 'Please select at least one reminder time.' }
  }

  if (totalTablets === null || currentTablets === null) {
    return { error: 'Tablet counts must be whole numbers of 0 or more.' }
  }

  if (currentTablets > totalTablets) {
    return { error: 'Current tablets cannot be higher than total tablets.' }
  }

  const seenTimes = new Set()
  for (const entry of times) {
    if (!isValidTime(entry.time)) {
      return { error: `Time for ${entry.label.toLowerCase()} must be in HH:MM format.` }
    }

    if (seenTimes.has(entry.time)) {
      return { error: 'Duplicate reminder times are not allowed.' }
    }

    seenTimes.add(entry.time)
  }

  return {
    data: {
      medicineName,
      phoneNumber,
      timezone,
      enabled: enabled ? 1 : 0,
      repeatDaily: repeatDaily ? 1 : 0,
      timeSlots: JSON.stringify(payload.timeSlots),
      times,
      totalTablets,
      currentTablets,
      voiceEnabled: voiceEnabled ? 1 : 0,
      caregiverPhoneNumber: caregiverPhoneNumber || null,
    },
  }
}

function formatReminder(reminder) {
  return {
    ...reminder,
    enabled: Boolean(reminder.enabled),
    repeatDaily: Boolean(reminder.repeatDaily),
    voiceEnabled: Boolean(reminder.voiceEnabled),
    timeSlots: JSON.parse(reminder.timeSlots),
    times: JSON.parse(reminder.times),
  }
}

function formatDoseEvent(doseEvent) {
  return {
    ...doseEvent,
    enabled: Boolean(doseEvent.enabled),
  }
}

function getCurrentMarker(timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )

  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  }
}

function addMinutesIso(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString()
}

async function sendReminderMessage(reminder, doseEvent, isSnooze = false) {
  const prefix = isSnooze ? 'Snoozed reminder' : 'Reminder'
  const body = `${prefix}: Take your medicine - ${reminder.medicineName}. Time: ${doseEvent.scheduledTime}. Reply TAKEN ${doseEvent.id}, SNOOZE ${doseEvent.id}, or LEAVE ${doseEvent.id}.`
  await smsService.sendSms({
    to: reminder.phoneNumber,
    body,
  })

  if (smsService.isWhatsappConfigured()) {
    await smsService.sendWhatsapp({
      to: reminder.phoneNumber,
      body,
    })
  }

  if (reminder.voiceEnabled && smsService.isVoiceConfigured()) {
    await smsService.makeVoiceCall({
      to: reminder.phoneNumber,
      message: `${prefix}. Please take your medicine ${reminder.medicineName}. Reply taken, snooze, or leave after checking your message.`,
    })
  }
}

async function sendCaregiverAlert(reminder, body) {
  if (!reminder.caregiverPhoneNumber) {
    return
  }

  try {
    await smsService.sendSms({
      to: reminder.caregiverPhoneNumber,
      body,
    })
  } catch (error) {
    console.error(`Failed to send caregiver SMS for reminder ${reminder.id}:`, error.message)
  }

  if (smsService.isWhatsappConfigured()) {
    try {
      await smsService.sendWhatsapp({
        to: reminder.caregiverPhoneNumber,
        body,
      })
    } catch (error) {
      console.error(
        `Failed to send caregiver WhatsApp for reminder ${reminder.id}:`,
        error.message,
      )
    }
  }
}

async function sendLowStockAlert(reminder) {
  const body = `Medicine stock finished for ${reminder.medicineName}. Please buy more tablets soon.`

  try {
    await smsService.sendSms({
      to: reminder.phoneNumber,
      body,
    })
  } catch (error) {
    console.error(`Failed to send stock SMS for reminder ${reminder.id}:`, error.message)
  }

  if (smsService.isWhatsappConfigured()) {
    try {
      await smsService.sendWhatsapp({
        to: reminder.phoneNumber,
        body,
      })
    } catch (error) {
      console.error(
        `Failed to send stock WhatsApp for reminder ${reminder.id}:`,
        error.message,
      )
    }
  }

  await sendCaregiverAlert(
    reminder,
    `Family alert: ${reminder.medicineName} stock has finished. Please help arrange a refill.`,
  )
}

async function sendAwarenessAlert(reminder) {
  const body = `Awareness alert: ${reminder.medicineName} has been marked as left 3 times. Please check on the user.`

  try {
    await smsService.sendSms({
      to: reminder.phoneNumber,
      body,
    })
  } catch (error) {
    console.error(`Failed to send awareness SMS for reminder ${reminder.id}:`, error.message)
  }

  if (smsService.isWhatsappConfigured()) {
    try {
      await smsService.sendWhatsapp({
        to: reminder.phoneNumber,
        body,
      })
    } catch (error) {
      console.error(
        `Failed to send awareness WhatsApp for reminder ${reminder.id}:`,
        error.message,
      )
    }
  }

  await sendCaregiverAlert(reminder, body)
}

async function ensureDoseEventsForCurrentMinute() {
  const reminders = await getReminders()

  for (const reminderRow of reminders) {
    const reminder = formatReminder(reminderRow)

    if (!reminder.enabled) {
      continue
    }

    const marker = getCurrentMarker(reminder.timezone)
    const matchingTime = reminder.times.find((entry) => entry.time === marker.time)

    if (!matchingTime) {
      continue
    }

    const scheduledKey = `${marker.date}-${matchingTime.time}`
    const existingDose = await getDoseEventByReminderKey(reminder.id, scheduledKey)

    if (!existingDose) {
      await createDoseEvent({
        reminderId: reminder.id,
        scheduledKey,
        scheduledDate: marker.date,
        scheduledTime: matchingTime.time,
        slotKey: matchingTime.key,
        slotLabel: matchingTime.label,
        status: 'pending',
        nextAlertAt: new Date().toISOString(),
      })
    }

    await markReminderSent(reminder.id, scheduledKey)

    if (!reminder.repeatDaily) {
      await setReminderEnabled(reminder.id, 0)
    }
  }
}

async function processDoseAlerts() {
  const dueDoseEvents = await getDoseEventsReadyForAlert(new Date().toISOString())

  for (const event of dueDoseEvents) {
    try {
      await sendReminderMessage(event, event, event.status === 'snoozed')

      const nextAlertAt = event.status === 'snoozed' ? addMinutesIso(5) : '9999-12-31T00:00:00.000Z'
      await markDoseAlertSent(event.id, {
        lastAlertAt: new Date().toISOString(),
        nextAlertAt,
      })
    } catch (error) {
      console.error(`Failed to send dose alert ${event.id}:`, error.message)
    }
  }
}

async function processReminderQueue() {
  await ensureDoseEventsForCurrentMinute()
  await processDoseAlerts()
}

function parseIncomingAction(messageText) {
  const normalized = String(messageText || '').trim().toUpperCase()
  const match = normalized.match(/^(TAKEN|SNOOZE|LEAVE)(?:\s+(\d+))?$/)

  if (!match) {
    return null
  }

  return {
    action:
      match[1] === 'TAKEN'
        ? 'taken'
        : match[1] === 'SNOOZE'
          ? 'snooze'
          : 'leave',
    doseId: match[2] ? Number(match[2]) : null,
  }
}

function formatTwimlMessage(message) {
  const safeMessage = String(message)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safeMessage}</Message></Response>`
}

async function applyDoseAction(doseEvent, reminder, action) {
  if (!['pending', 'snoozed'].includes(doseEvent.status)) {
    return {
      doseEvent: formatDoseEvent(doseEvent),
      reminder: formatReminder(reminder),
      resultMessage: `This medicine alert was already marked as ${doseEvent.status}.`,
    }
  }

  let updatedDose
  let updatedReminder = reminder
  let resultMessage = ''

  if (action === 'taken') {
    const nextCount = Math.max(0, reminder.currentTablets - 1)
    const shouldSendLowStock = nextCount === 0 && reminder.lastLowStockAlertAt !== 'finished'

    updatedDose = await updateDoseEventAction(doseEvent.id, {
      status: 'taken',
      nextAlertAt: '9999-12-31T00:00:00.000Z',
      leaveCount: doseEvent.leaveCount,
    })

    updatedReminder = await updateReminderCounts(reminder.id, {
      currentTablets: nextCount,
      missedLeaves: 0,
      lastLowStockAlertAt: shouldSendLowStock ? 'finished' : reminder.lastLowStockAlertAt,
    })

    if (shouldSendLowStock) {
      await sendLowStockAlert(updatedReminder)
    }

    resultMessage = `${reminder.medicineName} marked as taken. Stock left: ${nextCount}.`
  }

  if (action === 'snooze') {
    updatedDose = await updateDoseEventAction(doseEvent.id, {
      status: 'snoozed',
      nextAlertAt: addMinutesIso(5),
      leaveCount: doseEvent.leaveCount,
    })

    resultMessage = `${reminder.medicineName} snoozed. Another reminder will be sent in 5 minutes.`
  }

  if (action === 'leave') {
    const nextMissedLeaves = reminder.missedLeaves + 1
    const shouldSendAwareness = nextMissedLeaves >= 3

    updatedDose = await updateDoseEventAction(doseEvent.id, {
      status: 'left',
      nextAlertAt: '9999-12-31T00:00:00.000Z',
      leaveCount: doseEvent.leaveCount + 1,
    })

    updatedReminder = await updateReminderCounts(reminder.id, {
      currentTablets: reminder.currentTablets,
      missedLeaves: shouldSendAwareness ? 0 : nextMissedLeaves,
      lastLowStockAlertAt: reminder.lastLowStockAlertAt,
    })

    if (shouldSendAwareness) {
      await sendAwarenessAlert(reminder)
      resultMessage = `${reminder.medicineName} marked as left. Awareness alert sent after 3 missed doses.`
    } else {
      resultMessage = `${reminder.medicineName} marked as left. Missed count: ${nextMissedLeaves}.`
    }
  }

  return {
    doseEvent: formatDoseEvent(updatedDose),
    reminder: formatReminder(updatedReminder),
    resultMessage,
  }
}

async function resolveDoseForIncomingAction(parsedAction, incomingPhone) {
  if (parsedAction.doseId) {
    const doseEvent = await getDoseEventById(parsedAction.doseId)

    if (!doseEvent) {
      return { error: 'Dose not found. Reply with the number from the reminder message.' }
    }

    const reminder = await getReminderById(doseEvent.reminderId)

    if (!reminder || reminder.phoneNumber !== incomingPhone) {
      return { error: 'This reply does not match your registered medicine reminder.' }
    }

    return { doseEvent, reminder }
  }

  const doseEvent = await getLatestOpenDoseByPhone(incomingPhone)

  if (!doseEvent) {
    return {
      error:
        'No active medicine alert was found. Reply with TAKEN 123, SNOOZE 123, or LEAVE 123 using the number from the reminder.',
    }
  }

  const reminder = await getReminderById(doseEvent.reminderId)

  if (!reminder) {
    return { error: 'Reminder not found for this medicine alert.' }
  }

  return { doseEvent, reminder }
}

async function handleIncomingTwilioReply(req, res) {
  const incomingPhone = String(req.body?.From || '').replace(/^whatsapp:/, '')
  const parsedAction = parseIncomingAction(req.body?.Body)

  res.type('text/xml')

  if (!parsedAction) {
    return res.send(
      formatTwimlMessage(
        'Reply TAKEN, SNOOZE, or LEAVE. You can also include the alert number, for example TAKEN 12.',
      ),
    )
  }

  try {
    const resolved = await resolveDoseForIncomingAction(parsedAction, incomingPhone)

    if (resolved.error) {
      return res.send(formatTwimlMessage(resolved.error))
    }

    const result = await applyDoseAction(
      resolved.doseEvent,
      resolved.reminder,
      parsedAction.action,
    )

    return res.send(formatTwimlMessage(result.resultMessage))
  } catch {
    return res.send(
      formatTwimlMessage('Unable to process the reply right now. Please try again shortly.'),
    )
  }
}

app.get('/api/health', async (_req, res) => {
  const reminders = await getReminders()
  const activeDoses = await getActiveDoseEvents()

  res.json({
    ok: true,
    reminderCount: reminders.length,
    activeDoseCount: activeDoses.length,
    twilioConfigured: smsService.isConfigured(),
    whatsappConfigured: smsService.isWhatsappConfigured(),
    voiceConfigured: smsService.isVoiceConfigured(),
  })
})

app.get('/api/reminders', async (_req, res) => {
  try {
    const reminders = await getReminders()
    res.json(reminders.map(formatReminder))
  } catch {
    res.status(500).json({ error: 'Unable to load reminders.' })
  }
})

app.get('/api/doses/active', async (_req, res) => {
  try {
    const doseEvents = await getActiveDoseEvents()
    res.json(doseEvents.map(formatDoseEvent))
  } catch {
    res.status(500).json({ error: 'Unable to load active medicine alerts.' })
  }
})

app.post('/api/reminders', async (req, res) => {
  const validation = validateReminderPayload(req.body)

  if (validation.error) {
    return res.status(400).json({ error: validation.error })
  }

  try {
    const reminder = await createReminder(validation.data)
    return res.status(201).json(formatReminder(reminder))
  } catch (error) {
    if (error.message === 'DUPLICATE_REMINDER') {
      return res.status(409).json({
        error: 'This reminder already exists for the same medicine, phone number, times, and timezone.',
      })
    }

    return res.status(500).json({ error: 'Unable to create reminder.' })
  }
})

app.put('/api/reminders/:id', async (req, res) => {
  const validation = validateReminderPayload(req.body)

  if (validation.error) {
    return res.status(400).json({ error: validation.error })
  }

  try {
    const existingReminder = await getReminderById(req.params.id)

    if (!existingReminder) {
      return res.status(404).json({ error: 'Reminder not found.' })
    }

    const reminder = await updateReminder(req.params.id, validation.data)
    return res.json(formatReminder(reminder))
  } catch (error) {
    if (error.message === 'DUPLICATE_REMINDER') {
      return res.status(409).json({
        error: 'This reminder already exists for the same medicine, phone number, times, and timezone.',
      })
    }

    return res.status(500).json({ error: 'Unable to update reminder.' })
  }
})

app.patch('/api/reminders/:id/toggle', async (req, res) => {
  try {
    const existingReminder = await getReminderById(req.params.id)

    if (!existingReminder) {
      return res.status(404).json({ error: 'Reminder not found.' })
    }

    const reminder = await updateReminder(req.params.id, {
      medicineName: existingReminder.medicineName,
      phoneNumber: existingReminder.phoneNumber,
      timezone: existingReminder.timezone,
      enabled: existingReminder.enabled ? 0 : 1,
      repeatDaily: existingReminder.repeatDaily,
      timeSlots: existingReminder.timeSlots,
      times: JSON.parse(existingReminder.times),
      totalTablets: existingReminder.totalTablets,
      currentTablets: existingReminder.currentTablets,
      voiceEnabled: existingReminder.voiceEnabled,
      caregiverPhoneNumber: existingReminder.caregiverPhoneNumber,
    })

    return res.json(formatReminder(reminder))
  } catch {
    return res.status(500).json({ error: 'Unable to toggle reminder.' })
  }
})

app.patch('/api/doses/:id/action', async (req, res) => {
  const action = req.body?.action

  if (!['taken', 'snooze', 'leave'].includes(action)) {
    return res.status(400).json({ error: 'Action must be taken, snooze, or leave.' })
  }

  try {
    const doseEvent = await getDoseEventById(req.params.id)

    if (!doseEvent) {
      return res.status(404).json({ error: 'Medicine alert not found.' })
    }

    const reminder = await getReminderById(doseEvent.reminderId)

    if (!reminder) {
      return res.status(404).json({ error: 'Reminder not found.' })
    }

    const result = await applyDoseAction(doseEvent, reminder, action)
    return res.json(result)
  } catch {
    return res.status(500).json({ error: 'Unable to update medicine alert.' })
  }
})

app.post('/api/webhooks/twilio/sms', handleIncomingTwilioReply)
app.post('/api/webhooks/twilio/whatsapp', handleIncomingTwilioReply)

app.delete('/api/reminders/:id', async (req, res) => {
  try {
    const existingReminder = await getReminderById(req.params.id)

    if (!existingReminder) {
      return res.status(404).json({ error: 'Reminder not found.' })
    }

    await deleteReminder(req.params.id)
    return res.status(204).send()
  } catch {
    return res.status(500).json({ error: 'Unable to delete reminder.' })
  }
})

app.use(express.static(distPath))

app.get('{*splat}', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    next()
    return
  }

  res.sendFile(path.join(distPath, 'index.html'))
})

async function startServer() {
  await initializeDatabase()

  // The scheduler checks every minute for new dose alerts and snoozed reminders.
  cron.schedule('* * * * *', async () => {
    await processReminderQueue()
  })

  app.listen(port, () => {
    console.log(`Medicine reminder API running on http://localhost:${port}`)
  })
}

startServer().catch((error) => {
  console.error('Unable to start the server:', error)
  process.exit(1)
})
