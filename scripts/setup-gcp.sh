#!/usr/bin/env bash
# One-time Google Cloud setup for the Companion prototype.
# Prereqs: gcloud auth login && gcloud auth application-default login && firebase login
set -euo pipefail

PROJECT="${PROJECT:-amnet-sea}"
REGION="${REGION:-asia-east1}"
BUCKET="${BUCKET:-${PROJECT}-companion-photos}"
RUNTIME_SA="firebase-app-hosting-compute@${PROJECT}.iam.gserviceaccount.com"

echo "==> Project: $PROJECT  Region: $REGION  Bucket: gs://$BUCKET"
gcloud config set project "$PROJECT" >/dev/null

echo "==> Enabling APIs"
gcloud services enable \
  aiplatform.googleapis.com \
  texttospeech.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  geocoding-backend.googleapis.com \
  cloudscheduler.googleapis.com \
  fcm.googleapis.com \
  firebase.googleapis.com \
  firebaseapphosting.googleapis.com \
  secretmanager.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  developerconnect.googleapis.com

echo "==> Adding Firebase to the project (safe to re-run)"
firebase projects:addfirebase "$PROJECT" 2>/dev/null || echo "    (already a Firebase project)"

echo "==> Firestore (Native mode)"
gcloud firestore databases describe --database="(default)" >/dev/null 2>&1 \
  || gcloud firestore databases create --database="(default)" --location="$REGION" --type=firestore-native

echo "==> Photo bucket (private, uniform access)"
gcloud storage buckets describe "gs://$BUCKET" >/dev/null 2>&1 \
  || gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention

echo "==> Secrets (you will be prompted for values that don't exist yet)"
make_secret() {
  local name="$1" prompt="$2" generate="${3:-}"
  if gcloud secrets describe "$name" >/dev/null 2>&1; then
    echo "    $name exists"
    return
  fi
  local value
  if [[ -n "$generate" ]]; then
    value="$(openssl rand -hex 16)"
    echo "    generated $name"
  else
    read -r -s -p "    $prompt: " value
    echo
  fi
  [[ -z "$value" ]] && value="unset"
  printf "%s" "$value" | gcloud secrets create "$name" --data-file=- --replication-policy=automatic >/dev/null
}
make_secret carer-passcode "Carer page passcode"
make_secret cron-secret "" generate
make_secret maps-api-key "Maps Geocoding API key (create one in APIs & Services > Credentials; Enter to skip)"

echo "==> Runtime service account permissions ($RUNTIME_SA)"
if gcloud iam service-accounts describe "$RUNTIME_SA" >/dev/null 2>&1; then
  for role in roles/aiplatform.user roles/datastore.user roles/firebasecloudmessaging.admin roles/serviceusage.serviceUsageConsumer; do
    gcloud projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$RUNTIME_SA" --role="$role" --condition=None >/dev/null
  done
  gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$RUNTIME_SA" --role=roles/storage.objectAdmin >/dev/null
  for s in carer-passcode cron-secret maps-api-key; do
    gcloud secrets add-iam-policy-binding "$s" --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor >/dev/null
  done
  echo "    granted"
else
  echo "    App Hosting service account not created yet."
  echo "    Create the backend first (see README), then re-run this script to grant permissions."
fi

echo
echo "Done. Next: create the App Hosting backend linked to GitHub (README > Deploy), then run scripts/setup-scheduler.sh <backend-url>."
