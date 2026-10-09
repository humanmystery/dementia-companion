import "server-only";
import type { Place } from "./types";

export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function savedPlaceAt(lat: number, lng: number, places: Place[]): Place | null {
  let best: { place: Place; d: number } | null = null;
  for (const place of places) {
    const d = distanceM(lat, lng, place.lat, place.lng);
    if (d <= place.radiusM && (!best || d < best.d)) best = { place, d };
  }
  return best?.place ?? null;
}

const townCache = new Map<string, string | null>();

/** Town or area only, never a street, shop or park. */
export async function townAt(lat: number, lng: number): Promise<string | null> {
  const key = process.env.MAPS_API_KEY;
  if (!key) return null;
  const cacheKey = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  if (townCache.has(cacheKey)) return townCache.get(cacheKey)!;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&result_type=locality|sublocality|administrative_area_level_2&key=${key}`;
    const res = await fetch(url);
    const json = (await res.json()) as {
      results?: { address_components: { long_name: string; types: string[] }[] }[];
    };
    const comps = json.results?.[0]?.address_components ?? [];
    const town =
      comps.find((c) => c.types.includes("locality"))?.long_name ??
      comps.find((c) => c.types.includes("sublocality"))?.long_name ??
      comps.find((c) => c.types.includes("administrative_area_level_2"))?.long_name ??
      null;
    townCache.set(cacheKey, town);
    return town;
  } catch {
    return null;
  }
}

export async function resolvePlace(
  lat: number | undefined,
  lng: number | undefined,
  places: Place[],
): Promise<{ label: string; kind: "saved" | "town" } | null> {
  if (lat == null || lng == null) return null;
  const saved = savedPlaceAt(lat, lng, places);
  if (saved) return { label: saved.name, kind: "saved" };
  const town = await townAt(lat, lng);
  return town ? { label: town, kind: "town" } : null;
}
