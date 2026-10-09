#!/usr/bin/env bash
# One-time Google Cloud setup for the Companion prototype (AI Builder Cup).
# Everything created here is named "ai-builder-*" and labelled project=ai-builder where the resource supports labels.
# See AI_BUILDER_RESOURCES.md for the full inventory.
# Prereqs: gcloud auth login && gcloud auth application-default login && firebase login
set -euo pipefail

PROJECT="${PROJECT:-amnet-sea}"
REGION="${REGION:-asia-east1}"
DATABASE="ai-builder-companion"
BUCKET="${PROJECT}-ai-builder-companion-photos"
SA_NAME="ai-builder-companion"
SA="${SA_NAME}@${PROJECT}.iam.gserviceaccount.com"
LABELS="project=ai-builder,app=companion"

echo "==> Project: $PROJECT  Region: $REGION"

echo "==> Enabling APIs (project-wide; only ones not already on are new)"
gcloud services enable --project "$PROJECT" \
  aiplatform.googleapis.com texttospeech.googleapis.com firestore.googleapis.com storage.googleapis.com \
  geocoding-backend.googleapis.com cloudscheduler.googleapis.com fcm.googleapis.com \
  firebaseapphosting.googleapis.com secretmanager.googleapis.com run.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com developerconnect.googleapis.com apikeys.googleapis.com

echo "==> Firestore database: $DATABASE"
gcloud firestore databases describe --project "$PROJECT" --database="$DATABASE" >/dev/null 2>&1 \
  || gcloud firestore databases create --project "$PROJECT" --database="$DATABASE" --location="$REGION" --type=firestore-native

echo "==> Photo bucket: gs://$BUCKET"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 \
  || gcloud storage buckets create "gs://$BUCKET" --project "$PROJECT" --location="$REGION" \
       --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update "gs://$BUCKET" --update-labels="$LABELS" >/dev/null

echo "==> Service account: $SA"
gcloud iam service-accounts describe "$SA" --project "$PROJECT" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --project "$PROJECT" \
       --display-name="AI Builder - Companion runtime" \
       --description="AI Builder Cup prototype (dementia companion). Safe to delete after the competition."

for role in roles/firebaseapphosting.computeRunner roles/aiplatform.user roles/datastore.user \
  roles/firebasecloudmessaging.admin roles/serviceusage.serviceUsageConsumer roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$SA" --role="$role" \
    --condition=None >/dev/null
done
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" \
  --role=roles/storage.objectAdmin >/dev/null

echo "==> Secrets"
make_secret() {
  local name="$1" value="$2"
  if ! gcloud secrets describe "$name" --project "$PROJECT" >/dev/null 2>&1; then
    printf "%s" "$value" | gcloud secrets create "$name" --project "$PROJECT" --data-file=- \
      --replication-policy=automatic --labels="$LABELS" >/dev/null
    echo "    created $name"
  else
    echo "    $name exists"
  fi
  gcloud secrets add-iam-policy-binding "$name" --project "$PROJECT" --member="serviceAccount:$SA" \
    --role=roles/secretmanager.secretAccessor >/dev/null
}
make_secret ai-builder-carer-passcode "${CARER_PASSCODE:-$(openssl rand -hex 3)}"
make_secret ai-builder-cron-secret "$(openssl rand -hex 16)"

echo "==> Maps Geocoding API key"
if ! gcloud secrets describe ai-builder-maps-api-key --project "$PROJECT" >/dev/null 2>&1; then
  KEY_NAME="$(gcloud services api-keys create --project "$PROJECT" \
    --display-name="ai-builder-companion-geocoding" \
    --api-target=service=geocoding-backend.googleapis.com --format='value(response.name)' 2>/dev/null || true)"
  KEY="$( [[ -n "$KEY_NAME" ]] && gcloud services api-keys get-key-string "$KEY_NAME" --format='value(keyString)' || echo unset)"
  make_secret ai-builder-maps-api-key "$KEY"
else
  make_secret ai-builder-maps-api-key ""
fi

echo
echo "Done. Carer passcode: $(gcloud secrets versions access latest --secret=ai-builder-carer-passcode --project "$PROJECT")"
