#!/usr/bin/env bash
# Creates the Cloud Scheduler job that ticks photo invitations every 15 minutes.
# Usage: scripts/setup-scheduler.sh https://<your-backend>.hosted.app
set -euo pipefail

URL="${1:?Pass the deployed App Hosting URL}"
PROJECT="${PROJECT:-amnet-sea}"
REGION="${REGION:-asia-east1}"
TZ_NAME="${TZ_NAME:-Asia/Hong_Kong}"
SECRET="$(gcloud secrets versions access latest --secret=cron-secret --project="$PROJECT")"

args=(
  --project="$PROJECT" --location="$REGION"
  --schedule="*/15 * * * *" --time-zone="$TZ_NAME"
  --uri="${URL%/}/api/reminders/tick" --http-method=POST
  --headers="x-cron-secret=${SECRET},Content-Type=application/json"
  --message-body='{}'
)
if gcloud scheduler jobs describe companion-reminder-tick --project="$PROJECT" --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http companion-reminder-tick "${args[@]}"
else
  gcloud scheduler jobs create http companion-reminder-tick "${args[@]}"
fi
echo "Scheduler job ready: companion-reminder-tick -> ${URL%/}/api/reminders/tick"
