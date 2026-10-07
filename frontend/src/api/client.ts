import * as SecureStore from "expo-secure-store";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "quota_session_token";

let memToken: string | null = null;

export async function getToken(): Promise<string | null> {
  if (memToken) return memToken;
  try {
    const t = await SecureStore.getItemAsync(TOKEN_KEY);
    memToken = t;
    return t;
  } catch {
    return null;
  }
}

export async function setToken(token: string | null) {
  memToken = token;
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
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
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers });
  if (res.status === 401) {
    await setToken(null);
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
  exportYear: (year: number) =>
    request<{ filename: string; mime: string; data: string }>(
      `/export/year/${year}`
    ),
  emailYear: (year: number) =>
    request(`/export/year/${year}/email`, { method: "POST" }),
};
