#!/usr/bin/env bash
# Deploys the Gemini Live relay (relay/) to Cloud Run as "ai-builder-live-relay", labelled project=ai-builder.
# Usage: bash scripts/deploy-relay.sh https://<app-hosting-url>
# Then set LIVE_RELAY_URL in apphosting.yaml to the wss:// URL this prints, and redeploy the app.
set -euo pipefail

APP_URL="${1:?Usage: deploy-relay.sh https://<app-url>}"
PROJECT="${PROJECT:-amnet-sea}"
REGION="${REGION:-asia-east1}"
SERVICE="ai-builder-live-relay"
SECRET="ai-builder-live-relay-secret"
SA="ai-builder-companion@${PROJECT}.iam.gserviceaccount.com"
LABELS="project=ai-builder,app=companion"

echo "==> Shared secret between the app and the relay: $SECRET"
if ! gcloud secrets describe "$SECRET" --project "$PROJECT" >/dev/null 2>&1; then
  openssl rand -hex 24 | tr -d '\n' | gcloud secrets create "$SECRET" --project "$PROJECT" --data-file=- \
    --replication-policy=automatic --labels="$LABELS" >/dev/null
fi
gcloud secrets add-iam-policy-binding "$SECRET" --project "$PROJECT" --member="serviceAccount:$SA" \
  --role=roles/secretmanager.secretAccessor >/dev/null

echo "==> Cloud Run service: $SERVICE ($REGION)"
gcloud run deploy "$SERVICE" --project "$PROJECT" --region "$REGION" --source "$(dirname "$0")/../relay" \
  --service-account "$SA" --labels "$LABELS" --allow-unauthenticated \
  --timeout 3600 --session-affinity --min-instances 0 --max-instances 3 --concurrency 20 --cpu 1 --memory 512Mi \
  --set-env-vars "APP_URL=${APP_URL},GOOGLE_CLOUD_PROJECT=${PROJECT},LIVE_LOCATION=us-central1,LIVE_MODEL=gemini-3.8-live,LIVE_VOICE=Aoede" \
  --set-secrets "LIVE_RELAY_SECRET=${SECRET}:latest" \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)')"
echo
echo "Relay ready. In apphosting.yaml set LIVE_RELAY_URL to: ${URL/https:/wss:}"
