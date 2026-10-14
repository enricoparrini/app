import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "quota_session_token";

let memToken: string | null = null;

const isWeb = Platform.OS === "web";

async function readStored(): Promise<string | null> {
  if (isWeb) {
    try {
      return typeof localStorage !== "undefined"
        ? localStorage.getItem(TOKEN_KEY)
        : null;
    } catch {
      return null;
    }
  }
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

async function writeStored(token: string | null): Promise<void> {
  if (isWeb) {
    try {
      if (typeof localStorage === "undefined") return;
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {}
    return;
  }
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {}
}

export async function getToken(): Promise<string | null> {
  if (memToken) return memToken;
  const t = await readStored();
  memToken = t;
  return t;
}

let onUnauthorized: (() => void) | null = null;
export function setOnUnauthorized(cb: (() => void) | null) {
  onUnauthorized = cb;
}

export async function setToken(token: string | null) {
  memToken = token;
  await writeStored(token);
}

async function request<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const isAuth = path.startsWith("/auth/");
  const ctrl = isAuth ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 20000) : null;
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers,
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 401) {
    // un session_id scaduto non deve cancellare una sessione valida già salvata
    if (path !== "/auth/session") {
      await setToken(null);
      onUnauthorized?.();
    }
    throw new Error("Non autorizzato");
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.detail || msg;
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as any;
  return res.json();
}

export const api = {
  authSession: (session_id: string) =>
    request<{ session_token: string; user: any }>("/auth/session", {
      method: "POST",
      body: JSON.stringify({ session_id }),
    }),
  me: () => request<{ user: any }>("/auth/me"),
  logout: () => request("/auth/logout", { method: "POST" }),
  getConfig: () => request<{ config: any }>("/config"),
  putConfig: (payload: any) =>
    request<{ config: any }>("/config", {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  listBlocks: () => request<{ blocks: any[] }>("/blocks"),
  createBlock: (month: number, year: number) =>
    request<{ block: any }>("/blocks", {
      method: "POST",
      body: JSON.stringify({ month, year }),
    }),
  getBlock: (id: string) => request<{ block: any }>(`/blocks/${id}`),
  deleteBlock: (id: string) => request(`/blocks/${id}`, { method: "DELETE" }),
  addExpense: (id: string, payload: any) =>
    request<{ expense_id: string }>(`/blocks/${id}/expenses`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateExpense: (bid: string, eid: string, payload: any) =>
    request(`/blocks/${bid}/expenses/${eid}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteExpense: (bid: string, eid: string) =>
    request(`/blocks/${bid}/expenses/${eid}`, { method: "DELETE" }),
  getAttachment: (bid: string, eid: string) =>
    request<{ data: string; mime: string; name: string }>(
      `/blocks/${bid}/expenses/${eid}/attachment`
    ),
  closeBlock: (id: string, payload: any) =>
    request(`/blocks/${id}/close`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  resendEmail: (id: string) =>
    request(`/blocks/${id}/resend-email`, { method: "POST" }),
  reportHtmlUrl: async (id: string) => {
    const token = await getToken();
    return {
      uri: `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/blocks/${id}/report-html`,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    };
  },
  exportYear: (year: number) =>
    request<{ filename: string; mime: string; data: string }>(
      `/export/year/${year}`
    ),
  emailYear: (year: number) =>
    request(`/export/year/${year}/email`, { method: "POST" }),
};
