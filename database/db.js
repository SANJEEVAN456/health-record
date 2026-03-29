import mongoose from 'mongoose'

let isConnected = false

function createDuplicateKey(reminder) {
  const timeValues = reminder.times.map((entry) => entry.time).sort().join('|')
  return `${reminder.medicineName.toLowerCase()}::${reminder.phoneNumber}::${timeValues}::${reminder.timezone}`
}

const reminderSchema = new mongoose.Schema(
  {
    medicineName: { type: String, required: true, trim: true },
    phoneNumber: { type: String, required: true, trim: true },
    timezone: { type: String, required: true, trim: true },
    enabled: { type: Number, required: true, default: 1 },
    repeatDaily: { type: Number, required: true, default: 1 },
    timeSlots: { type: mongoose.Schema.Types.Mixed, required: true },
    times: { type: [mongoose.Schema.Types.Mixed], required: true },
    duplicateKey: { type: String, required: true, unique: true, index: true },
    lastSentKey: { type: String, default: null },
    totalTablets: { type: Number, required: true, default: 0 },
    currentTablets: { type: Number, required: true, default: 0 },
    missedLeaves: { type: Number, required: true, default: 0 },
    lastLowStockAlertAt: { type: String, default: null },
    voiceEnabled: { type: Number, required: true, default: 0 },
    caregiverPhoneNumber: { type: String, default: null },
  },
  {
    timestamps: true,
  },
)

const doseEventSchema = new mongoose.Schema(
  {
    reminderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Reminder',
      required: true,
      index: true,
    },
    scheduledKey: { type: String, required: true },
    scheduledDate: { type: String, required: true },
    scheduledTime: { type: String, required: true },
    slotKey: { type: String, required: true },
    slotLabel: { type: String, required: true },
    status: { type: String, required: true, default: 'pending' },
    nextAlertAt: { type: String, required: true },
    lastAlertAt: { type: String, default: null },
    leaveCount: { type: Number, required: true, default: 0 },
  },
  {
    timestamps: true,
  },
)

doseEventSchema.index({ reminderId: 1, scheduledKey: 1 }, { unique: true })

const Reminder = mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema)
const DoseEvent = mongoose.models.DoseEvent || mongoose.model('DoseEvent', doseEventSchema)

function normalizeReminder(doc) {
  if (!doc) {
    return null
  }

  const reminder = doc.toObject ? doc.toObject() : doc
  return {
    id: String(reminder._id),
    medicineName: reminder.medicineName,
    phoneNumber: reminder.phoneNumber,
    timezone: reminder.timezone,
    enabled: reminder.enabled,
    repeatDaily: reminder.repeatDaily,
    timeSlots:
      typeof reminder.timeSlots === 'string'
        ? reminder.timeSlots
        : JSON.stringify(reminder.timeSlots),
    times:
      typeof reminder.times === 'string' ? reminder.times : JSON.stringify(reminder.times),
    duplicateKey: reminder.duplicateKey,
    lastSentKey: reminder.lastSentKey,
    totalTablets: reminder.totalTablets,
    currentTablets: reminder.currentTablets,
    missedLeaves: reminder.missedLeaves,
    lastLowStockAlertAt: reminder.lastLowStockAlertAt,
    voiceEnabled: reminder.voiceEnabled,
    caregiverPhoneNumber: reminder.caregiverPhoneNumber,
    createdAt: reminder.createdAt,
    updatedAt: reminder.updatedAt,
  }
}

function normalizeDoseEvent(doc, reminderDoc = null) {
  if (!doc) {
    return null
  }

  const dose = doc.toObject ? doc.toObject() : doc
  const reminder =
    reminderDoc ??
    (dose.reminderId && typeof dose.reminderId === 'object' && !Array.isArray(dose.reminderId)
      ? dose.reminderId
      : null)

  return {
    id: String(dose._id),
    reminderId: String(reminder?._id || dose.reminderId),
    scheduledKey: dose.scheduledKey,
    scheduledDate: dose.scheduledDate,
    scheduledTime: dose.scheduledTime,
    slotKey: dose.slotKey,
    slotLabel: dose.slotLabel,
    status: dose.status,
    nextAlertAt: dose.nextAlertAt,
    lastAlertAt: dose.lastAlertAt,
    leaveCount: dose.leaveCount,
    createdAt: dose.createdAt,
    updatedAt: dose.updatedAt,
    medicineName: reminder?.medicineName,
    phoneNumber: reminder?.phoneNumber,
    timezone: reminder?.timezone,
    currentTablets: reminder?.currentTablets,
    totalTablets: reminder?.totalTablets,
    missedLeaves: reminder?.missedLeaves,
    lastLowStockAlertAt: reminder?.lastLowStockAlertAt,
    repeatDaily: reminder?.repeatDaily,
    enabled: reminder?.enabled,
    caregiverPhoneNumber: reminder?.caregiverPhoneNumber,
    voiceEnabled: reminder?.voiceEnabled,
  }
}

function buildReminderPayload(reminder) {
  return {
    medicineName: reminder.medicineName,
    phoneNumber: reminder.phoneNumber,
    timezone: reminder.timezone,
    enabled: reminder.enabled,
    repeatDaily: reminder.repeatDaily,
    timeSlots:
      typeof reminder.timeSlots === 'string'
        ? JSON.parse(reminder.timeSlots)
        : reminder.timeSlots,
    times: Array.isArray(reminder.times) ? reminder.times : JSON.parse(reminder.times),
    duplicateKey: createDuplicateKey(reminder),
    totalTablets: reminder.totalTablets,
    currentTablets: reminder.currentTablets,
    voiceEnabled: reminder.voiceEnabled,
    caregiverPhoneNumber: reminder.caregiverPhoneNumber,
  }
}

export async function initializeDatabase() {
  if (isConnected) {
    return
  }

  const mongoUri = process.env.MONGODB_URI

  if (!mongoUri) {
    throw new Error('MONGODB_URI is missing. Please add your MongoDB Atlas connection string.')
  }

  await mongoose.connect(mongoUri, {
    dbName: process.env.MONGODB_DB_NAME || undefined,
  })

  isConnected = true
}

export async function getReminders() {
  const reminders = await Reminder.find().sort({ createdAt: -1, _id: -1 })
  return reminders.map(normalizeReminder)
}

export async function getReminderById(id) {
  const reminder = await Reminder.findById(id)
  return normalizeReminder(reminder)
}

export async function createReminder(reminder) {
  try {
    const createdReminder = await Reminder.create(buildReminderPayload(reminder))
    return normalizeReminder(createdReminder)
  } catch (error) {
    if (error?.code === 11000) {
      throw new Error('DUPLICATE_REMINDER')
    }

    throw error
  }
}

export async function updateReminder(id, reminder) {
  try {
    const updatedReminder = await Reminder.findByIdAndUpdate(
      id,
      {
        ...buildReminderPayload(reminder),
        lastLowStockAlertAt: null,
      },
      { new: true, runValidators: true },
    )

    return normalizeReminder(updatedReminder)
  } catch (error) {
    if (error?.code === 11000) {
      throw new Error('DUPLICATE_REMINDER')
    }

    throw error
  }
}

export async function updateReminderCounts(id, values) {
  const updatedReminder = await Reminder.findByIdAndUpdate(
    id,
    {
      currentTablets: values.currentTablets,
      missedLeaves: values.missedLeaves,
      lastLowStockAlertAt: values.lastLowStockAlertAt,
    },
    { new: true },
  )

  return normalizeReminder(updatedReminder)
}

export async function markReminderSent(id, lastSentKey) {
  await Reminder.findByIdAndUpdate(id, { lastSentKey })
}

export async function setReminderEnabled(id, enabled) {
  await Reminder.findByIdAndUpdate(id, { enabled })
}

export async function createDoseEvent(event) {
  try {
    const createdDose = await DoseEvent.create({
      reminderId: event.reminderId,
      scheduledKey: event.scheduledKey,
      scheduledDate: event.scheduledDate,
      scheduledTime: event.scheduledTime,
      slotKey: event.slotKey,
      slotLabel: event.slotLabel,
      status: event.status,
      nextAlertAt: event.nextAlertAt,
    })

    return normalizeDoseEvent(createdDose)
  } catch (error) {
    if (error?.code === 11000) {
      return getDoseEventByReminderKey(event.reminderId, event.scheduledKey)
    }

    throw error
  }
}

export async function getDoseEventByReminderKey(reminderId, scheduledKey) {
  const doseEvent = await DoseEvent.findOne({ reminderId, scheduledKey })
  return normalizeDoseEvent(doseEvent)
}

export async function getDoseEventById(id) {
  const doseEvent = await DoseEvent.findById(id)
  return normalizeDoseEvent(doseEvent)
}

export async function getLatestOpenDoseByPhone(phoneNumber) {
  const reminder = await Reminder.findOne({ phoneNumber }).select('_id')

  if (!reminder) {
    return null
  }

  const doseEvent = await DoseEvent.findOne({
    reminderId: reminder._id,
    status: { $in: ['pending', 'snoozed'] },
  })
    .sort({ updatedAt: -1, _id: -1 })
    .populate('reminderId')

  if (!doseEvent || !doseEvent.reminderId) {
    return null
  }

  return normalizeDoseEvent(doseEvent, doseEvent.reminderId)
}

export async function getActiveDoseEvents() {
  const doseEvents = await DoseEvent.find({ status: { $in: ['pending', 'snoozed'] } })
    .sort({ nextAlertAt: 1, _id: 1 })
    .populate('reminderId')

  return doseEvents
    .filter((doseEvent) => doseEvent.reminderId)
    .map((doseEvent) => normalizeDoseEvent(doseEvent, doseEvent.reminderId))
}

export async function getDoseEventsReadyForAlert(nowIso) {
  const doseEvents = await DoseEvent.find({
    status: { $in: ['pending', 'snoozed'] },
    nextAlertAt: { $lte: nowIso },
  })
    .sort({ nextAlertAt: 1, _id: 1 })
    .populate({
      path: 'reminderId',
      match: { enabled: 1 },
    })

  return doseEvents
    .filter((doseEvent) => doseEvent.reminderId)
    .map((doseEvent) => normalizeDoseEvent(doseEvent, doseEvent.reminderId))
}

export async function markDoseAlertSent(id, values) {
  const updatedDose = await DoseEvent.findByIdAndUpdate(
    id,
    {
      lastAlertAt: values.lastAlertAt,
      nextAlertAt: values.nextAlertAt,
    },
    { new: true },
  )

  return normalizeDoseEvent(updatedDose)
}

export async function updateDoseEventAction(id, values) {
  const updatedDose = await DoseEvent.findByIdAndUpdate(
    id,
    {
      status: values.status,
      nextAlertAt: values.nextAlertAt,
      leaveCount: values.leaveCount,
    },
    { new: true },
  )

  return normalizeDoseEvent(updatedDose)
}

export async function deleteReminder(id) {
  await DoseEvent.deleteMany({ reminderId: id })
  await Reminder.findByIdAndDelete(id)
}
