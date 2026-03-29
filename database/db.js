import fs from 'fs'
import path from 'path'
import sqlite3 from 'sqlite3'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const databasePath = process.env.DATABASE_PATH || path.join(__dirname, 'reminders.sqlite')

fs.mkdirSync(__dirname, { recursive: true })

const sqlite = sqlite3.verbose()
const db = new sqlite.Database(databasePath)

function run(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function onRun(error) {
      if (error) {
        reject(error)
        return
      }

      resolve({
        id: this.lastID,
        changes: this.changes,
      })
    })
  })
}

function get(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (error, row) => {
      if (error) {
        reject(error)
        return
      }

      resolve(row)
    })
  })
}

function all(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (error, rows) => {
      if (error) {
        reject(error)
        return
      }

      resolve(rows)
    })
  })
}

function createDuplicateKey(reminder) {
  const timeValues = reminder.times.map((entry) => entry.time).sort().join('|')
  return `${reminder.medicineName.toLowerCase()}::${reminder.phoneNumber}::${timeValues}::${reminder.timezone}`
}

async function ensureReminderColumns() {
  const columns = await all('PRAGMA table_info(reminders)')
  const columnNames = new Set(columns.map((column) => column.name))

  if (!columnNames.has('totalTablets')) {
    await run('ALTER TABLE reminders ADD COLUMN totalTablets INTEGER NOT NULL DEFAULT 0')
  }

  if (!columnNames.has('currentTablets')) {
    await run('ALTER TABLE reminders ADD COLUMN currentTablets INTEGER NOT NULL DEFAULT 0')
  }

  if (!columnNames.has('missedLeaves')) {
    await run('ALTER TABLE reminders ADD COLUMN missedLeaves INTEGER NOT NULL DEFAULT 0')
  }

  if (!columnNames.has('lastLowStockAlertAt')) {
    await run('ALTER TABLE reminders ADD COLUMN lastLowStockAlertAt TEXT')
  }

  if (!columnNames.has('voiceEnabled')) {
    await run('ALTER TABLE reminders ADD COLUMN voiceEnabled INTEGER NOT NULL DEFAULT 0')
  }

  if (!columnNames.has('caregiverPhoneNumber')) {
    await run('ALTER TABLE reminders ADD COLUMN caregiverPhoneNumber TEXT')
  }
}

export async function initializeDatabase() {
  await run('PRAGMA foreign_keys = ON')

  await run(`
    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      medicineName TEXT NOT NULL,
      phoneNumber TEXT NOT NULL,
      timezone TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      repeatDaily INTEGER NOT NULL DEFAULT 1,
      timeSlots TEXT NOT NULL,
      times TEXT NOT NULL,
      duplicateKey TEXT NOT NULL UNIQUE,
      lastSentKey TEXT,
      totalTablets INTEGER NOT NULL DEFAULT 0,
      currentTablets INTEGER NOT NULL DEFAULT 0,
      missedLeaves INTEGER NOT NULL DEFAULT 0,
      lastLowStockAlertAt TEXT,
      voiceEnabled INTEGER NOT NULL DEFAULT 0,
      caregiverPhoneNumber TEXT,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)

  await ensureReminderColumns()

  await run(`
    CREATE TABLE IF NOT EXISTS dose_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reminderId INTEGER NOT NULL,
      scheduledKey TEXT NOT NULL,
      scheduledDate TEXT NOT NULL,
      scheduledTime TEXT NOT NULL,
      slotKey TEXT NOT NULL,
      slotLabel TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      nextAlertAt TEXT NOT NULL,
      lastAlertAt TEXT,
      leaveCount INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(reminderId, scheduledKey),
      FOREIGN KEY (reminderId) REFERENCES reminders(id) ON DELETE CASCADE
    )
  `)
}

export async function getReminders() {
  return all('SELECT * FROM reminders ORDER BY createdAt DESC, id DESC')
}

export async function getReminderById(id) {
  return get('SELECT * FROM reminders WHERE id = ?', [id])
}

export async function createReminder(reminder) {
  const duplicateKey = createDuplicateKey(reminder)

  try {
    const result = await run(
      `
        INSERT INTO reminders (
          medicineName,
          phoneNumber,
          timezone,
          enabled,
          repeatDaily,
          timeSlots,
          times,
          duplicateKey,
          totalTablets,
          currentTablets,
          voiceEnabled,
          caregiverPhoneNumber
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        reminder.medicineName,
        reminder.phoneNumber,
        reminder.timezone,
        reminder.enabled,
        reminder.repeatDaily,
        reminder.timeSlots,
        JSON.stringify(reminder.times),
        duplicateKey,
        reminder.totalTablets,
        reminder.currentTablets,
        reminder.voiceEnabled,
        reminder.caregiverPhoneNumber,
      ],
    )

    return getReminderById(result.id)
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      throw new Error('DUPLICATE_REMINDER')
    }

    throw error
  }
}

export async function updateReminder(id, reminder) {
  const duplicateKey = createDuplicateKey(reminder)

  try {
    await run(
      `
        UPDATE reminders
        SET
          medicineName = ?,
          phoneNumber = ?,
          timezone = ?,
          enabled = ?,
          repeatDaily = ?,
          timeSlots = ?,
          times = ?,
          duplicateKey = ?,
          totalTablets = ?,
          currentTablets = ?,
          voiceEnabled = ?,
          caregiverPhoneNumber = ?,
          lastLowStockAlertAt = NULL,
          updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      [
        reminder.medicineName,
        reminder.phoneNumber,
        reminder.timezone,
        reminder.enabled,
        reminder.repeatDaily,
        reminder.timeSlots,
        JSON.stringify(reminder.times),
        duplicateKey,
        reminder.totalTablets,
        reminder.currentTablets,
        reminder.voiceEnabled,
        reminder.caregiverPhoneNumber,
        id,
      ],
    )

    return getReminderById(id)
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      throw new Error('DUPLICATE_REMINDER')
    }

    throw error
  }
}

export async function updateReminderCounts(id, values) {
  await run(
    `
      UPDATE reminders
      SET
        currentTablets = ?,
        missedLeaves = ?,
        lastLowStockAlertAt = ?,
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [values.currentTablets, values.missedLeaves, values.lastLowStockAlertAt, id],
  )

  return getReminderById(id)
}

export async function markReminderSent(id, lastSentKey) {
  await run(
    `
      UPDATE reminders
      SET lastSentKey = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [lastSentKey, id],
  )
}

export async function setReminderEnabled(id, enabled) {
  await run(
    `
      UPDATE reminders
      SET enabled = ?, updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [enabled, id],
  )
}

export async function createDoseEvent(event) {
  const result = await run(
    `
      INSERT OR IGNORE INTO dose_events (
        reminderId,
        scheduledKey,
        scheduledDate,
        scheduledTime,
        slotKey,
        slotLabel,
        status,
        nextAlertAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      event.reminderId,
      event.scheduledKey,
      event.scheduledDate,
      event.scheduledTime,
      event.slotKey,
      event.slotLabel,
      event.status,
      event.nextAlertAt,
    ],
  )

  if (result.changes === 0) {
    return getDoseEventByReminderKey(event.reminderId, event.scheduledKey)
  }

  return getDoseEventById(result.id)
}

export async function getDoseEventByReminderKey(reminderId, scheduledKey) {
  return get(
    'SELECT * FROM dose_events WHERE reminderId = ? AND scheduledKey = ?',
    [reminderId, scheduledKey],
  )
}

export async function getDoseEventById(id) {
  return get('SELECT * FROM dose_events WHERE id = ?', [id])
}

export async function getLatestOpenDoseByPhone(phoneNumber) {
  return get(
    `
      SELECT
        dose_events.*,
        reminders.medicineName,
        reminders.phoneNumber,
        reminders.timezone,
        reminders.currentTablets,
        reminders.totalTablets,
        reminders.missedLeaves,
        reminders.lastLowStockAlertAt,
        reminders.enabled
      FROM dose_events
      INNER JOIN reminders ON reminders.id = dose_events.reminderId
      WHERE
        reminders.phoneNumber = ?
        AND dose_events.status IN ('pending', 'snoozed')
      ORDER BY dose_events.updatedAt DESC, dose_events.id DESC
      LIMIT 1
    `,
    [phoneNumber],
  )
}

export async function getActiveDoseEvents() {
  return all(
    `
      SELECT
        dose_events.*,
        reminders.medicineName,
        reminders.phoneNumber,
        reminders.timezone,
        reminders.currentTablets,
        reminders.totalTablets,
        reminders.missedLeaves,
        reminders.enabled
      FROM dose_events
      INNER JOIN reminders ON reminders.id = dose_events.reminderId
      WHERE dose_events.status IN ('pending', 'snoozed')
      ORDER BY dose_events.nextAlertAt ASC, dose_events.id ASC
    `,
  )
}

export async function getDoseEventsReadyForAlert(nowIso) {
  return all(
    `
      SELECT
        dose_events.*,
        reminders.medicineName,
        reminders.phoneNumber,
        reminders.timezone,
        reminders.currentTablets,
        reminders.totalTablets,
        reminders.missedLeaves,
        reminders.repeatDaily,
        reminders.enabled
      FROM dose_events
      INNER JOIN reminders ON reminders.id = dose_events.reminderId
      WHERE
        dose_events.status IN ('pending', 'snoozed')
        AND dose_events.nextAlertAt <= ?
        AND reminders.enabled = 1
      ORDER BY dose_events.nextAlertAt ASC, dose_events.id ASC
    `,
    [nowIso],
  )
}

export async function markDoseAlertSent(id, values) {
  await run(
    `
      UPDATE dose_events
      SET
        lastAlertAt = ?,
        nextAlertAt = ?,
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [values.lastAlertAt, values.nextAlertAt, id],
  )

  return getDoseEventById(id)
}

export async function updateDoseEventAction(id, values) {
  await run(
    `
      UPDATE dose_events
      SET
        status = ?,
        nextAlertAt = ?,
        leaveCount = ?,
        updatedAt = CURRENT_TIMESTAMP
      WHERE id = ?
    `,
    [values.status, values.nextAlertAt, values.leaveCount, id],
  )

  return getDoseEventById(id)
}

export async function deleteReminder(id) {
  await run('DELETE FROM reminders WHERE id = ?', [id])
}
