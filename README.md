# Medicine Reminder System

A full-stack medicine reminder app for elderly users. It includes:

- A simple React frontend with large controls
- An Express API
- SQLite storage
- A `node-cron` scheduler that checks reminders every minute
- Twilio SMS and optional WhatsApp support for sending medicine alerts
- Optional Twilio voice calls for spoken reminders

## Project Structure

- `frontend/` - Vite + React user interface
- `backend/` - Express API and cron scheduler
- `database/` - SQLite connection setup and local database file

## Features

- Add, edit, view, enable, disable, and delete reminders
- Support multiple daily times like morning and night
- Daily repeating reminders
- Tablet stock tracking with total and current counts
- Due-dose actions: `Taken`, `Snooze`, and `Leave`
- Snooze repeats the same reminder every 5 minutes until marked `Taken`
- After 3 `Leave` actions, an awareness message is sent to the registered number by SMS and WhatsApp
- When stock reaches 0 after taking a tablet, a medicine-buying reminder is sent
- The user can reply directly from SMS or WhatsApp with `TAKEN`, `SNOOZE`, or `LEAVE`
- A separate family member phone number can receive stock and awareness alerts
- Optional voice reminder calls can ring the medicine user's phone at reminder time
- Timezone-aware scheduling
- Input validation and duplicate reminder checks
- Mobile-friendly UI

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your environment file:

   ```bash
   copy .env.example .env
   ```

3. Add your Twilio values inside `.env`.
4. If you want WhatsApp alerts, add your Twilio WhatsApp-enabled sender number too.
5. Set `VITE_API_BASE_URL` when frontend and backend are deployed on different URLs.

## Run Locally

Start frontend and backend together:

```bash
npm run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:4000/api`

## Deployment Notes

- If frontend and backend are deployed separately, set `VITE_API_BASE_URL` to your backend URL, for example `https://your-api.example.com`
- Set `FRONTEND_URL` on the backend to the frontend origin. You can provide multiple frontend URLs separated by commas
- Keep the backend running continuously because the cron scheduler sends reminders every minute

Production build:

```bash
npm run build
```

Run only the backend server:

```bash
npm run start
```

## Deploy

### Frontend on Vercel

This repo includes [vercel.json](c:/Users/venka/OneDrive/Desktop/health-record/health-record/vercel.json).

1. Push the repo to GitHub
2. Import the repo into Vercel
3. Set `VITE_API_BASE_URL` to your Render backend URL, for example `https://your-backend.onrender.com`
4. Deploy

### Backend on Render

This repo includes [render.yaml](c:/Users/venka/OneDrive/Desktop/health-record/health-record/render.yaml).

1. Push the repo to GitHub
2. Create a new Render Blueprint or Web Service from the repo
3. Add the environment variables from `.env.example`
4. Set `FRONTEND_URL` to your Vercel domain
5. Deploy

The Render config includes:

- `/api/health` health check
- Persistent disk for SQLite
- `DATABASE_PATH` pointing to the mounted disk

### Docker

This repo also includes [Dockerfile](c:/Users/venka/OneDrive/Desktop/health-record/health-record/Dockerfile).

Build and run:

```bash
docker build -t medicine-reminder .
docker run -p 4000:4000 --env-file .env medicine-reminder
```

Then open `http://localhost:4000`

## Twilio Notes

- Phone numbers must be stored in E.164 format, for example `+919876543210`
- The scheduler checks reminders every minute
- If Twilio SMS credentials are missing, the API still runs, but SMS sending will fail until valid credentials are added
- WhatsApp alerts require `TWILIO_WHATSAPP_NUMBER` and a Twilio WhatsApp-enabled setup or sandbox
- Voice reminders use the same Twilio number and require voice capability on that number
- For direct reply handling, configure Twilio incoming webhooks to point to your backend

## Twilio Webhooks

Set these webhook URLs in the Twilio console:

- SMS webhook: `POST /api/webhooks/twilio/sms`
- WhatsApp webhook: `POST /api/webhooks/twilio/whatsapp`

Example local development with a tunnel:

```bash
ngrok http 4000
```

If ngrok gives you `https://abc123.ngrok-free.app`, use:

- `https://abc123.ngrok-free.app/api/webhooks/twilio/sms`
- `https://abc123.ngrok-free.app/api/webhooks/twilio/whatsapp`

Reply examples from the user phone:

- `TAKEN`
- `SNOOZE`
- `LEAVE`
- `TAKEN 12`
- `SNOOZE 12`
- `LEAVE 12`

## Cron Behavior

- Every minute, the backend checks enabled reminders
- It compares each reminder time against the current time in that reminder's timezone
- A due dose is created for that time and appears in the app with `Taken`, `Snooze`, and `Leave`
- `Snooze` sends the reminder again every 5 minutes until `Taken`
- `Leave` closes that dose; after 3 leaves, the system sends an awareness alert
- `Taken` reduces the current stock by 1 tablet
- When stock reaches 0, the system sends a buy-medicine reminder
- The same actions can be completed from the app or by replying to SMS/WhatsApp
- If voice reminder is enabled, the user also gets a voice call at reminder time
- If a family member number is added, low-stock and awareness alerts are sent there too

## Beginner-Friendly Tip

Morning and night reminders are managed by selecting the time slots in the form and setting a time for each one. Stock is tracked using total tablets and current tablets.
