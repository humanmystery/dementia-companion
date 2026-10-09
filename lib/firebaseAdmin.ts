import "server-only";

export async function adminApp() {
  const { getApps, initializeApp, applicationDefault } = await import("firebase-admin/app");
  return (
    getApps()[0] ??
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
      storageBucket: process.env.GCS_BUCKET,
    })
  );
}
