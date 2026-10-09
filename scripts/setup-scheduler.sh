#!/usr/bin/env bash
# Creates the Cloud Scheduler job that ticks photo invitations every 15 minutes.
# Usage: scripts/setup-scheduler.sh https://<your-backend>.hosted.app
set -euo pipefail

URL="${1:?Pass the deployed App Hosting URL}"
PROJECT="${PROJECT:-amnet-sea}"
REGION="${REGION:-asia-east1}"
TZ_NAME="${TZ_NAME:-Asia/Hong_Kong}"
JOB="ai-builder-companion-reminder-tick"
SECRET="$(gcloud secrets versions access latest --secret=ai-builder-cron-secret --project="$PROJECT")"

args=(
  --project="$PROJECT" --location="$REGION"
  --schedule="*/15 * * * *" --time-zone="$TZ_NAME"
  --uri="${URL%/}/api/reminders/tick" --http-method=POST
  --headers="x-cron-secret=${SECRET},Content-Type=application/json"
  --message-body='{}'
  --description="AI Builder Cup prototype (companion): photo invitation tick"
)
if gcloud scheduler jobs describe "$JOB" --project="$PROJECT" --location="$REGION" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB" "${args[@]}"
else
  gcloud scheduler jobs create http "$JOB" "${args[@]}"
fi
echo "Scheduler job ready: $JOB -> ${URL%/}/api/reminders/tick"
