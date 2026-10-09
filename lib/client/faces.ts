"use client";

import type { FaceBox } from "@/lib/types";

type FaceApi = typeof import("@vladmandic/face-api");
let loading: Promise<FaceApi> | null = null;

export function loadFaceApi(): Promise<FaceApi> {
  if (!loading) {
    loading = (async () => {
      const faceapi = await import("@vladmandic/face-api");
      await (faceapi.tf as unknown as { ready(): Promise<void> }).ready();
      await Promise.all([
        faceapi.nets.ssdMobilenetv1.loadFromUri("/models"),
        faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
        faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
      ]);
      return faceapi;
    })();
  }
  return loading;
}

export type Detected = { descriptor: number[]; box: FaceBox };

export async function detectFaces(input: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement): Promise<Detected[]> {
  const faceapi = await loadFaceApi();
  const results = await faceapi
    .detectAllFaces(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptors();
  return results.map((r) => ({
    descriptor: Array.from(r.descriptor),
    box: {
      x: Math.round(r.detection.box.x),
      y: Math.round(r.detection.box.y),
      width: Math.round(r.detection.box.width),
      height: Math.round(r.detection.box.height),
    },
  }));
}
