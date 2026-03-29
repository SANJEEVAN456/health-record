import { useCallback, useEffect, useRef, useState } from 'react'
import './App.css'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '')
const profileStorageKey = 'medicine-reminder-profile'

const defaultTimeSlots = {
  morning: { label: 'Morning', selected: true, time: '08:00' },
  night: { label: 'Night', selected: true, time: '20:00' },
}

const timezoneOptions = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
]

const emptyForm = {
  medicineName: '',
  phoneNumber: '',
  caregiverPhoneNumber: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
  enabled: true,
  repeatDaily: true,
  voiceEnabled: false,
  totalTablets: 30,
  currentTablets: 30,
  timeSlots: defaultTimeSlots,
}

function copyTimeSlots(timeSlots) {
  return JSON.parse(JSON.stringify(timeSlots))
}

function createFreshForm() {
  return {
    ...emptyForm,
    timeSlots: copyTimeSlots(defaultTimeSlots),
  }
}

function apiUrl(path) {
  return apiBaseUrl ? `${apiBaseUrl}${path}` : path
}

function isValidPhoneNumber(phoneNumber) {
  return /^\+[1-9]\d{7,14}$/.test(phoneNumber)
}

function App() {
  const [reminders, setReminders] = useState([])
  const [activeDoses, setActiveDoses] = useState([])
  const [form, setForm] = useState(createFreshForm)
  const [profile, setProfile] = useState(null)
  const [profileForm, setProfileForm] = useState({
    userName: '',
    phoneNumber: '',
    caregiverPhoneNumber: '',
  })
  const [editingId, setEditingId] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [pageError, setPageError] = useState('')
  const [message, setMessage] = useState('')
  const [health, setHealth] = useState(null)
  const latestLoadId = useRef(0)

  async function readJson(response, fallbackMessage) {
    const text = await response.text()
    const data = text ? JSON.parse(text) : {}

    if (!response.ok) {
      throw new Error(data.error || fallbackMessage)
    }

    return data
  }

  const fetchReminders = useCallback(async () => {
    const response = await fetch(apiUrl('/api/reminders'))
    return readJson(response, 'Unable to load reminders.')
  }, [])

  const fetchActiveDoses = useCallback(async () => {
    const response = await fetch(apiUrl('/api/doses/active'))
    return readJson(response, 'Unable to load active medicine alerts.')
  }, [])

  const fetchHealth = useCallback(async () => {
    const response = await fetch(apiUrl('/api/health'))
    return readJson(response, 'Unable to load system status.')
  }, [])

  function validateForm() {
    if (!form.medicineName.trim()) {
      return 'Medicine name is required.'
    }

    if (!isValidPhoneNumber(form.phoneNumber.trim())) {
      return 'Registered phone number must be in international format, for example +919876543210.'
    }

    if (
      form.caregiverPhoneNumber.trim() &&
      !isValidPhoneNumber(form.caregiverPhoneNumber.trim())
    ) {
      return 'Family member phone number must be in international format.'
    }

    const selectedTimes = Object.values(form.timeSlots).filter((slot) => slot.selected)
    if (selectedTimes.length === 0) {
      return 'Please select at least one reminder time.'
    }

    if (Number(form.currentTablets) > Number(form.totalTablets)) {
      return 'Current tablets cannot be higher than total tablets.'
    }

    return ''
  }

  function validateProfileForm() {
    if (!profileForm.userName.trim()) {
      return 'User name is required.'
    }

    if (!isValidPhoneNumber(profileForm.phoneNumber.trim())) {
      return 'Phone number must be in international format, for example +919876543210.'
    }

    if (
      profileForm.caregiverPhoneNumber.trim() &&
      !isValidPhoneNumber(profileForm.caregiverPhoneNumber.trim())
    ) {
      return 'Family member phone number must be in international format.'
    }

    return ''
  }

  useEffect(() => {
    const savedProfile = window.localStorage.getItem(profileStorageKey)

    if (!savedProfile) {
      setIsLoading(false)
      return
    }

    try {
      const parsedProfile = JSON.parse(savedProfile)
      setProfile(parsedProfile)
      setProfileForm(parsedProfile)
      setForm((current) => ({
        ...current,
        phoneNumber: parsedProfile.phoneNumber || '',
        caregiverPhoneNumber: parsedProfile.caregiverPhoneNumber || '',
      }))
    } catch {
      window.localStorage.removeItem(profileStorageKey)
      setIsLoading(false)
    }
  }, [])

  const loadDashboard = useCallback(async () => {
    const loadId = Date.now() + Math.random()
    latestLoadId.current = loadId
    setIsLoading(true)

    try {
      const [remindersResult, dosesResult, healthResult] = await Promise.allSettled([
        fetchReminders(),
        fetchActiveDoses(),
        fetchHealth(),
      ])

      const errors = []

      if (remindersResult.status === 'fulfilled') {
        if (latestLoadId.current === loadId) {
          setReminders(remindersResult.value)
        }
      } else {
        errors.push(remindersResult.reason.message)
      }

      if (dosesResult.status === 'fulfilled') {
        if (latestLoadId.current === loadId) {
          setActiveDoses(dosesResult.value)
        }
      } else {
        errors.push(dosesResult.reason.message)
      }

      if (healthResult.status === 'fulfilled') {
        if (latestLoadId.current === loadId) {
          setHealth(healthResult.value)
        }
      } else {
        errors.push(healthResult.reason.message)
      }

      if (errors.length > 0 && latestLoadId.current === loadId) {
        setPageError(errors[0])
      }
    } finally {
      if (latestLoadId.current === loadId) {
        setIsLoading(false)
      }
    }
  }, [fetchActiveDoses, fetchHealth, fetchReminders])

  useEffect(() => {
    if (!profile) {
      return
    }

    loadDashboard()
  }, [loadDashboard, profile])

  useEffect(() => {
    if (!profile) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      loadDashboard()
    }, 30000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [loadDashboard, profile])

  function resetForm() {
    setForm({
      ...createFreshForm(),
      phoneNumber: profile?.phoneNumber || '',
      caregiverPhoneNumber: profile?.caregiverPhoneNumber || '',
    })
    setEditingId(null)
  }

  function handleProfileFieldChange(field, value) {
    setProfileForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function handleProfileSubmit(event) {
    event.preventDefault()
    const validationError = validateProfileForm()

    if (validationError) {
      setPageError(validationError)
      return
    }

    const nextProfile = {
      userName: profileForm.userName.trim(),
      phoneNumber: profileForm.phoneNumber.trim(),
      caregiverPhoneNumber: profileForm.caregiverPhoneNumber.trim(),
    }

    window.localStorage.setItem(profileStorageKey, JSON.stringify(nextProfile))
    setProfile(nextProfile)
    setPageError('')
    setMessage(`Welcome ${nextProfile.userName}.`)
    setForm({
      ...createFreshForm(),
      phoneNumber: nextProfile.phoneNumber,
      caregiverPhoneNumber: nextProfile.caregiverPhoneNumber,
    })
  }

  function handleProfileReset() {
    window.localStorage.removeItem(profileStorageKey)
    setProfile(null)
    setProfileForm({
      userName: '',
      phoneNumber: '',
      caregiverPhoneNumber: '',
    })
    setReminders([])
    setActiveDoses([])
    setHealth(null)
    setEditingId(null)
    setPageError('')
    setMessage('')
    setIsLoading(false)
    setForm(createFreshForm())
  }

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  function updateTimeSlot(slotKey, changes) {
    setForm((current) => ({
      ...current,
      timeSlots: {
        ...current.timeSlots,
        [slotKey]: {
          ...current.timeSlots[slotKey],
          ...changes,
        },
      },
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const validationError = validateForm()

    if (validationError) {
      setPageError(validationError)
      setMessage('')
      return
    }

    setIsSaving(true)
    setPageError('')
    setMessage('')

    const method = editingId ? 'PUT' : 'POST'
    const url = editingId
      ? apiUrl(`/api/reminders/${editingId}`)
      : apiUrl('/api/reminders')

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      })

      const savedReminder = await readJson(response, 'Unable to save reminder.')
      latestLoadId.current = Date.now() + Math.random()

      setReminders((current) => {
        if (editingId) {
          return current.map((item) => (item.id === savedReminder.id ? savedReminder : item))
        }

        return [savedReminder, ...current.filter((item) => item.id !== savedReminder.id)]
      })

      setMessage(editingId ? 'Reminder updated.' : 'Reminder saved.')
      resetForm()
      await loadDashboard()
    } catch (error) {
      setPageError(error.message)
      setMessage('')
    } finally {
      setIsSaving(false)
    }
  }

  function handleEdit(reminder) {
    setForm({
      medicineName: reminder.medicineName,
      phoneNumber: reminder.phoneNumber,
      timezone: reminder.timezone,
      enabled: reminder.enabled,
      repeatDaily: reminder.repeatDaily,
      voiceEnabled: reminder.voiceEnabled,
      caregiverPhoneNumber: reminder.caregiverPhoneNumber || '',
      totalTablets: reminder.totalTablets,
      currentTablets: reminder.currentTablets,
      timeSlots: copyTimeSlots(reminder.timeSlots),
    })
    setEditingId(reminder.id)
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function handleDelete(id) {
    setPageError('')
    setMessage('')

    try {
      const response = await fetch(apiUrl(`/api/reminders/${id}`), {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Unable to delete reminder.')
      }

      if (editingId === id) {
        resetForm()
      }

      setMessage('Reminder deleted.')
      await loadDashboard()
    } catch (error) {
      setPageError(error.message)
    }
  }

  async function handleToggle(id) {
    setPageError('')
    setMessage('')

    try {
      const response = await fetch(apiUrl(`/api/reminders/${id}/toggle`), {
        method: 'PATCH',
      })

      await readJson(response, 'Unable to change reminder status.')
      setMessage('Reminder status updated.')
      await loadDashboard()
    } catch (error) {
      setPageError(error.message)
    }
  }

  async function handleDoseAction(doseId, action) {
    setPageError('')
    setMessage('')

    try {
      const response = await fetch(apiUrl(`/api/doses/${doseId}/action`), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      })

      await readJson(response, 'Unable to update medicine alert.')

      if (action === 'taken') {
        setMessage('Medicine marked as taken.')
      }

      if (action === 'snooze') {
        setMessage('Reminder snoozed for 5 minutes.')
      }

      if (action === 'leave') {
        setMessage('Medicine marked as left.')
      }

      await loadDashboard()
    } catch (error) {
      setPageError(error.message)
    }
  }

  if (!profile) {
    return (
      <main className="app-shell">
        <section className="hero-card onboarding-card">
          <p className="eyebrow">Medicine Reminder</p>
          <h1>Welcome</h1>
          <p className="hero-text">
            Start with the user details first, then continue to the reminder page.
          </p>

          {pageError ? <div className="banner error">{pageError}</div> : null}

          <form className="reminder-form" onSubmit={handleProfileSubmit}>
            <label className="field">
              <span>User Name</span>
              <input
                type="text"
                placeholder="Example: Ramesh"
                value={profileForm.userName}
                onChange={(event) => handleProfileFieldChange('userName', event.target.value)}
              />
            </label>

            <label className="field">
              <span>Phone Number</span>
              <input
                type="tel"
                inputMode="tel"
                placeholder="+919876543210"
                value={profileForm.phoneNumber}
                onChange={(event) => handleProfileFieldChange('phoneNumber', event.target.value)}
              />
            </label>

            <label className="field">
              <span>Family Member Number</span>
              <input
                type="tel"
                inputMode="tel"
                placeholder="+919812345678"
                value={profileForm.caregiverPhoneNumber}
                onChange={(event) =>
                  handleProfileFieldChange('caregiverPhoneNumber', event.target.value)
                }
              />
            </label>

            <button className="primary-button" type="submit">
              Enter
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">Daily Medicine Care</p>
        <h1>Medicine Reminder</h1>
        <p className="hero-text">
          SMS reminders, snooze support, stock tracking, and awareness alerts for missed doses.
        </p>
        <p className="reply-help">
          Hello {profile.userName}. Your phone and family alert numbers are ready below.
        </p>

        {health ? (
          <div className="hero-badges">
            <span className="hero-badge">
              SMS: {health.twilioConfigured ? 'Ready' : 'Add Twilio .env'}
            </span>
            <span className="hero-badge">
              WhatsApp: {health.whatsappConfigured ? 'Ready' : 'Optional setup'}
            </span>
            <span className="hero-badge">
              Voice: {health.voiceConfigured ? 'Ready' : 'Needs Twilio voice'}
            </span>
            <span className="hero-badge">Active alerts: {health.activeDoseCount}</span>
          </div>
        ) : null}

        <p className="reply-help">
          Reply by SMS or WhatsApp with <strong>TAKEN</strong>, <strong>SNOOZE</strong>, or <strong>LEAVE</strong>.
          You can also reply with the alert number, for example <strong>TAKEN 12</strong>.
        </p>

        <div className="hero-actions">
          <button className="ghost-button" type="button" onClick={handleProfileReset}>
            Change User Details
          </button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Medicine Alert Now</h2>
            <p>Choose what happened for each due tablet, or reply from SMS/WhatsApp.</p>
          </div>
        </div>

        {activeDoses.length === 0 ? (
          <div className="empty-state">No active medicine alerts right now.</div>
        ) : (
          <div className="reminder-list">
            {activeDoses.map((dose) => (
              <article className="dose-card" key={dose.id}>
                <div className="reminder-top">
                  <div>
                    <h3>{dose.medicineName}</h3>
                    <p>
                      {dose.slotLabel} at {dose.scheduledTime}
                    </p>
                  </div>
                  <span className={dose.status === 'snoozed' ? 'status warm' : 'status on'}>
                    {dose.status === 'snoozed' ? 'Snoozed' : 'Pending'}
                  </span>
                </div>

                <div className="pill-row">
                  <span className="time-pill">Stock: {dose.currentTablets} left</span>
                  <span className="time-pill">Phone: {dose.phoneNumber}</span>
                  <span className="time-pill">Leaves: {dose.missedLeaves}</span>
                </div>

                <div className="triple-action-row">
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => handleDoseAction(dose.id, 'taken')}
                  >
                    Taken
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => handleDoseAction(dose.id, 'snooze')}
                  >
                    Snooze 5 Min
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => handleDoseAction(dose.id, 'leave')}
                  >
                    Leave
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>{editingId ? 'Edit Reminder' : 'Add Reminder'}</h2>
            <p>Set the times and tablet stock for each medicine.</p>
          </div>
          {editingId ? (
            <button className="ghost-button" type="button" onClick={resetForm}>
              Cancel Edit
            </button>
          ) : null}
        </div>

        {pageError ? <div className="banner error">{pageError}</div> : null}
        {message ? <div className="banner success">{message}</div> : null}

        <form className="reminder-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Medicine Name</span>
            <input
              type="text"
              placeholder="Example: BP tablet"
              required
              value={form.medicineName}
              onChange={(event) => updateField('medicineName', event.target.value)}
            />
          </label>

          <label className="field">
            <span>Registered Phone Number</span>
            <input
              type="tel"
              placeholder="+919876543210"
              inputMode="tel"
              required
              value={form.phoneNumber}
              onChange={(event) => updateField('phoneNumber', event.target.value)}
            />
          </label>

          <label className="field">
            <span>Family Member Phone Number</span>
            <input
              type="tel"
              placeholder="+919812345678"
              inputMode="tel"
              value={form.caregiverPhoneNumber}
              onChange={(event) =>
                updateField('caregiverPhoneNumber', event.target.value)
              }
            />
          </label>

          <label className="field">
            <span>Timezone</span>
            <select
              value={form.timezone}
              onChange={(event) => updateField('timezone', event.target.value)}
            >
              {Array.from(new Set([form.timezone, ...timezoneOptions])).map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </select>
          </label>

          <div className="time-grid count-grid">
            <label className="field">
              <span>Total Tablets</span>
              <input
                type="number"
                min="0"
                value={form.totalTablets}
                onChange={(event) => updateField('totalTablets', Number(event.target.value))}
              />
            </label>

            <label className="field">
              <span>Current Tablets</span>
              <input
                type="number"
                min="0"
                value={form.currentTablets}
                onChange={(event) => updateField('currentTablets', Number(event.target.value))}
              />
            </label>
          </div>

          <div className="time-grid">
            {Object.entries(form.timeSlots).map(([slotKey, slot]) => (
              <div className="time-card" key={slotKey}>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={slot.selected}
                    onChange={(event) =>
                      updateTimeSlot(slotKey, { selected: event.target.checked })
                    }
                  />
                  <span>{slot.label}</span>
                </label>

                <input
                  type="time"
                  value={slot.time}
                  onChange={(event) => updateTimeSlot(slotKey, { time: event.target.value })}
                  disabled={!slot.selected}
                />
              </div>
            ))}
          </div>

          <div className="switch-row">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => updateField('enabled', event.target.checked)}
              />
              <span>Reminder enabled</span>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.repeatDaily}
                onChange={(event) => updateField('repeatDaily', event.target.checked)}
              />
              <span>Repeat every day</span>
            </label>

            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.voiceEnabled}
                onChange={(event) => updateField('voiceEnabled', event.target.checked)}
              />
              <span>Voice reminder call</span>
            </label>
          </div>

          <button className="primary-button" type="submit" disabled={isSaving}>
            {isSaving ? 'Saving...' : editingId ? 'Update Reminder' : 'Save Reminder'}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Saved Reminders</h2>
            <p>{isLoading ? 'Loading reminders...' : `${reminders.length} reminders found`}</p>
          </div>
        </div>

        {pageError ? <div className="banner error">{pageError}</div> : null}
        {message ? <div className="banner success">{message}</div> : null}

        {isLoading ? (
          <div className="empty-state">Loading reminders...</div>
        ) : reminders.length === 0 ? (
          <div className="empty-state">No reminders yet. Add the first one above.</div>
        ) : (
          <div className="reminder-list">
            {reminders.map((reminder) => (
              <article className="reminder-card" key={reminder.id}>
                <div className="reminder-top">
                  <div>
                    <h3>{reminder.medicineName}</h3>
                    <p>{reminder.phoneNumber}</p>
                  </div>
                  <span className={reminder.enabled ? 'status on' : 'status off'}>
                    {reminder.enabled ? 'Enabled' : 'Paused'}
                  </span>
                </div>

                <div className="pill-row">
                  {reminder.times.map((entry) => (
                    <span className="time-pill" key={`${reminder.id}-${entry.key}`}>
                      {entry.label}: {entry.time}
                    </span>
                  ))}
                </div>

                <p className="meta-text">Timezone: {reminder.timezone}</p>
                <p className="meta-text">
                  Stock: {reminder.currentTablets} / {reminder.totalTablets}
                </p>
                <p className="meta-text">
                  Voice call: {reminder.voiceEnabled ? 'On' : 'Off'}
                </p>
                <p className="meta-text">
                  Family alert: {reminder.caregiverPhoneNumber || 'Not added'}
                </p>
                <p className="meta-text">Missed leaves: {reminder.missedLeaves}</p>

                <div className="action-row">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => handleEdit(reminder)}
                  >
                    Edit
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => handleToggle(reminder.id)}
                  >
                    {reminder.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button
                    className="danger-button"
                    type="button"
                    onClick={() => handleDelete(reminder.id)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}

export default App
