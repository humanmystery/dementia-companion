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
| API key (Geocoding only) | display name `ai-builder-companion-geocoding` | global | name only |
| App Hosting backend | `ai-builder-companion` | asia-east1 | name only |
| Cloud Run service (created by App Hosting) | `ai-builder-companion` | asia-east1 | name only |
| Cloud Scheduler job | `ai-builder-companion-reminder-tick` | asia-east1 | name + description |
| Firebase web app (push only, optional) | `ai-builder-companion` | global | name only |

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
for s in ai-builder-carer-passcode ai-builder-cron-secret ai-builder-maps-api-key; do gcloud secrets delete $s --project=$P; done
gcloud services api-keys list --project=$P --filter="displayName=ai-builder-companion-geocoding" --format="value(name)" | xargs -n1 gcloud services api-keys delete
gcloud iam service-accounts delete ai-builder-companion@$P.iam.gserviceaccount.com --project=$P
```
