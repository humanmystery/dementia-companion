# AI Builder Cup: Google Cloud resources

Everything created in project `amnet-sea` for the AI Builder Cup prototype. Names start with `ai-builder` and,
where the resource supports it, carry labels `project=ai-builder, app=companion`.
Nothing here touches the project's existing Firestore databases or App Hosting backends.

| Resource | Name | Region | Labelled |
| --- | --- | --- | --- |
| Firestore database (Native) | `ai-builder-companion` | asia-east1 | name only |
| Cloud Storage bucket (private) | `gs://amnet-sea-ai-builder-companion-photos` | asia-east1 | yes |
| Service account | `ai-builder-companion@amnet-sea.iam.gserviceaccount.com` | global | display name + description |
| Secret | `ai-builder-carer-passcode` | automatic | yes |
| Secret | `ai-builder-cron-secret` | automatic | yes |
| Secret | `ai-builder-maps-api-key` | automatic | yes |
| Secret | `ai-builder-live-relay-secret` | automatic | yes |
| Cloud Run service (Gemini Live relay) | `ai-builder-live-relay` | asia-east1 | yes |
| API key (Geocoding only) | display name `ai-builder-companion-geocoding` | global | name only |
| App Hosting backend | `ai-builder-companion` | asia-east1 | name only |
| Cloud Run service (created by App Hosting) | `ai-builder-companion` | asia-east1 | name only |
| Cloud Scheduler job | `ai-builder-companion-reminder-tick` | asia-east1 | name + description |
| Firebase web app (made by backend create) | `ai-builder-companion` | global | name only |
| Storage bucket (auto, App Hosting source uploads) | `firebaseapphosting-sources-40917271868-asia-east1` | asia-east1 | no (Google-managed name) |
| Artifact Registry repo (auto, App Hosting images) | `firebaseapphosting-images` | asia-east1 | no (Google-managed name) |
| Artifact Registry repo (auto, relay image) | `cloud-run-source-deploy` | asia-east1 | no (Google-managed name) |

Live URL: https://ai-builder-companion--amnet-sea.asia-east1.hosted.app
Live relay: wss://ai-builder-live-relay-40917271868.asia-east1.run.app (calls `gemini-3.8-live` on Vertex AI in
us-central1, the nearest region that serves it).

Relay source uploads went into the bucket `amnet-sea_cloudbuild`, which existed before this project
(only the `source/` objects from 9 Oct 2026 onward are ours).

The two auto-created resources at the bottom were created by Firebase App Hosting on its first deploy and are
only used by App Hosting. Nothing else in the project used App Hosting before this, so they belong to this app.
The Cloud Run service `shkaud` in asia-east1 existed before and is not ours.

Project-level IAM roles granted to the service account above: `roles/firebaseapphosting.computeRunner`,
`roles/aiplatform.user`, `roles/datastore.user`, `roles/firebasecloudmessaging.admin`,
`roles/serviceusage.serviceUsageConsumer`, `roles/logging.logWriter`; plus `roles/storage.objectAdmin` on the bucket
and `roles/secretmanager.secretAccessor` on the three secrets.

APIs newly enabled for this (project-wide, cannot be labelled): `texttospeech`, `geocoding-backend`,
`firebaseapphosting`, `developerconnect`, `apikeys`. All others were already on.

## Cleanup after the competition

```bash
P=amnet-sea
gcloud scheduler jobs delete ai-builder-companion-reminder-tick --location=asia-east1 --project=$P
firebase apphosting:backends:delete ai-builder-companion --project=$P
gcloud firestore databases delete --database=ai-builder-companion --project=$P
gcloud storage rm -r gs://amnet-sea-ai-builder-companion-photos
gcloud run services delete ai-builder-live-relay --region=asia-east1 --project=$P
gcloud artifacts repositories delete cloud-run-source-deploy --location=asia-east1 --project=$P
for s in ai-builder-carer-passcode ai-builder-cron-secret ai-builder-maps-api-key ai-builder-live-relay-secret; do gcloud secrets delete $s --project=$P; done
gcloud services api-keys list --project=$P --filter="displayName=ai-builder-companion-geocoding" --format="value(name)" | xargs -n1 gcloud services api-keys delete
gcloud iam service-accounts delete ai-builder-companion@$P.iam.gserviceaccount.com --project=$P
gcloud storage rm -r gs://firebaseapphosting-sources-40917271868-asia-east1
gcloud artifacts repositories delete firebaseapphosting-images --location=asia-east1 --project=$P
```

Also remove the `ai-builder-companion` web app in Firebase console > Project settings.
