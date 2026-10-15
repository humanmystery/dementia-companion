# Forget Me Not: AI Builder Cup prototype

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
- **Gemini Live API on Vertex AI** (`gemini-3.8-live`): the hands-free back-and-forth about a photo on the frame,
  after the opener. Vertex has no short-lived browser tokens for Live, so the frame gets a one-time, two-minute
  ticket from the app and connects to `relay/` (Cloud Run), which holds the Vertex login and builds the photo,
  facts and rules on the server. If Live can't connect or drops, the frame carries on with tap-to-talk.
- **Cloud Text-to-Speech** (Chirp 3 HD voice) for the recap, the opener and the goodbye, with browser voice fallback.
- **Firestore + Cloud Storage** (via `firebase-admin`) for people, places, photos, tasks, schedule, settings.
- **Firebase App Hosting** (Cloud Run) for the app, **Cloud Scheduler** for the reminder tick, **FCM** for push.
- **Maps Geocoding API** to turn GPS into a town name.
- Face matching uses `@vladmandic/face-api` in the browser: only 128-number face descriptors leave the device, and
  identity always comes from the carer's enrolled set, never from Gemini.

## Safety design

- `lib/facts.ts` builds a ranked fact pack per photo: **carer note > face labels > metadata > visual detail**.
- `lib/guard.ts` checks every generated line before it is spoken (no recall questions, no "you forgot", no names
  outside the facts, no present tense for someone who has died), retries once, then falls back to a safe template.
- Live chats can't be checked before they're spoken, so they start from the same fact pack and rules, and each
  transcript is checked afterwards and shown to the carer (Carer → Conversations) with rule breaks marked.
- Task support: Gemini only classifies the scene; the spoken steps are the carer's own words (`lib/task.ts`).
- Reminders: code decides when (`lib/reminders.ts`), Gemini only suggests phrasings that the carer approves.

## Run locally

```bash
cp .env.example .env.local      # DATA_BACKEND=local keeps data in ./.data
gcloud auth application-default login
npm install
npm run dev
npm --prefix relay install && npm run relay   # optional: Gemini Live for the frame chat (port 8081)
```

Open `/carer` → **Demo controls** → **Load demo setup**, then add people and photos.
Camera and microphone need HTTPS on phones; use the deployed URL (or `next dev --experimental-https`).

## Deploy (Firebase App Hosting)

```bash
gcloud auth login && gcloud auth application-default login && firebase login
bash scripts/setup-gcp.sh                 # APIs, Firestore db, photo bucket, service account, secrets
firebase apphosting:backends:create --project amnet-sea --backend ai-builder-companion \
  --primary-region asia-east1 --root-dir / \
  --service-account ai-builder-companion@amnet-sea.iam.gserviceaccount.com
firebase deploy --only apphosting --project amnet-sea   # uploads local source and rolls out
bash scripts/setup-scheduler.sh https://<backend-url>
bash scripts/deploy-relay.sh https://<backend-url>      # Live relay; put its wss:// URL in apphosting.yaml
```

Redeploy with `firebase deploy --only apphosting --project amnet-sea`. Every resource created for this project is
listed (with cleanup commands) in `AI_BUILDER_RESOURCES.md`. Runtime config lives in `apphosting.yaml`
(secrets come from Secret Manager). Cloud Scheduler calls `POST /api/reminders/tick` every 15 minutes with
header `x-cron-secret`.

Push notifications (optional): in the Firebase console add a Web app, generate a Web Push (VAPID) key under
Cloud Messaging, and add the `NEXT_PUBLIC_FIREBASE_*` values to `apphosting.yaml`. Without them, the phone and
frame still show invitations by polling.

## Demo script

1. Carer: Demo controls → "Make it 8:00 this morning". Frame: tap once → yesterday's recap, then a chat.
2. Frame: tap an old photo of someone marked as passed away → gentle, past tense.
3. Phone: point at an enrolled person → **Who is this?** → "Mei, your daughter."
4. Phone: point at the ironing scene → **Help me** → next step from the carer's list + Dr. Chan reminder.
5. Carer: Photo invitations → "Send one now" → phone asks "Shall we take a photo?" → Yes → appears in tomorrow's recap.
