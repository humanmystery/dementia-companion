# Companion: AI Builder Cup prototype

A friendly life companion for people living with early and mid-stage dementia, and support for their family.
One Next.js app with three surfaces, sharing one content store:

| Route      | Device                       | What it does                                                                    |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------- |
| `/frame`   | Tablet (the photo frame)     | Slideshow, morning recap of yesterday, tap a photo to chat about it             |
| `/capture` | Phone + earbuds (glasses stand-in) | "Who is this?", "Help me" (task support), "Take a photo", photo invitations |
| `/carer`   | Laptop                       | Enrol faces and places, add photos and notes, confirm tasks/schedule, demo controls |

## Google stack

- **Gemini on Vertex AI** (`@google/genai`, default `gemini-3.5-flash`): storybook narration and conversation, scene
  classification for task support, cue phrasing, drafting tasks from the setup questions, reminder phrasings.
- **Cloud Text-to-Speech** (Chirp 3 HD voice) for every spoken line, with browser voice fallback.
- **Firestore + Cloud Storage** (via `firebase-admin`) for people, places, photos, tasks, schedule, settings.
- **Firebase App Hosting** (Cloud Run) for the app, **Cloud Scheduler** for the reminder tick, **FCM** for push.
- **Maps Geocoding API** to turn GPS into a town name.
- Face matching uses `@vladmandic/face-api` in the browser: only 128-number face descriptors leave the device, and
  identity always comes from the carer's enrolled set, never from Gemini.

## Safety design

- `lib/facts.ts` builds a ranked fact pack per photo: **carer note > face labels > metadata > visual detail**.
- `lib/guard.ts` checks every generated line before it is spoken (no recall questions, no "you forgot", no names
  outside the facts, no present tense for someone who has died), retries once, then falls back to a safe template.
- Task support: Gemini only classifies the scene; the spoken steps are the carer's own words (`lib/task.ts`).
- Reminders: code decides when (`lib/reminders.ts`), Gemini only suggests phrasings that the carer approves.

## Run locally

```bash
cp .env.example .env.local      # DATA_BACKEND=local keeps data in ./.data
gcloud auth application-default login
npm install
npm run dev
```

Open `/carer` → **Demo controls** → **Load demo setup**, then add people and photos.
Camera and microphone need HTTPS on phones; use the deployed URL (or `next dev --experimental-https`).

## Deploy (Firebase App Hosting)

Push to `main`; App Hosting builds and deploys. Runtime config lives in `apphosting.yaml`.
Cloud Scheduler calls `POST /api/reminders/tick` every 15 minutes with header `x-cron-secret`.

## Demo script

1. Carer: Demo controls → "Make it 8:00 this morning". Frame: tap once → yesterday's recap, then a chat.
2. Frame: tap an old photo of someone marked as passed away → gentle, past tense.
3. Phone: point at an enrolled person → **Who is this?** → "Mei, your daughter."
4. Phone: point at the ironing scene → **Help me** → next step from the carer's list + Dr. Chan reminder.
5. Carer: Photo invitations → "Send one now" → phone asks "Shall we take a photo?" → Yes → appears in tomorrow's recap.
