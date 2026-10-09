"use client";

const KEY = "carer-passcode";

export function carerKey(): string {
  return typeof localStorage === "undefined" ? "" : localStorage.getItem(KEY) ?? "";
}

export function setCarerKey(k: string) {
  localStorage.setItem(KEY, k);
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-carer-key", carerKey());
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  const res = await fetch(path, { ...init, headers, body });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}
