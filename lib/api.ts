import * as SecureStore from "expo-secure-store";
import { getSession } from "./session";

export const API_BASE_URL = "https://aurae-backend-fukx.onrender.com";

export function assetUrl(relativePath: string): string {
  return `${API_BASE_URL}/${relativePath}`;
}

const STORAGE_KEYS = {
  deviceId: "aurae_device_id",
  accessToken: "aurae_access_token",
  refreshToken: "aurae_refresh_token",
} as const;

function generateUUID(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(STORAGE_KEYS.deviceId);
  if (existing) return existing;
  const created = generateUUID();
  await SecureStore.setItemAsync(STORAGE_KEYS.deviceId, created);
  return created;
}

async function storeTokens(accessToken: string, refreshToken: string) {
  await SecureStore.setItemAsync(STORAGE_KEYS.accessToken, accessToken);
  await SecureStore.setItemAsync(STORAGE_KEYS.refreshToken, refreshToken);
}

async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(STORAGE_KEYS.accessToken);
}

async function getRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(STORAGE_KEYS.refreshToken);
}

export async function clearAuthTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEYS.accessToken);
  await SecureStore.deleteItemAsync(STORAGE_KEYS.refreshToken);
}

export async function isLoggedIn(): Promise<boolean> {
  return (await getAccessToken()) !== null;
}

export type SignupResponse = {
  user_id: number;
  companion: string;
  access_token: string;
  refresh_token: string;
  existing_account?: boolean;
};

export type StreakInfo = {
  current_streak: number;
  longest_streak: number;
  streak_freezes: number;
  milestone_hit: number | null;
};

export type BonusInfo = {
  text: string;
  reward_points_earned: number;
};

export type RelationshipLevelUp = {
  new_level: number;
  level_name: string;
};

export type ChatResponse = {
  reply: string;
  mood?: string;
  emotion_tag: string;
  asset_path: string;
  crisis_flagged: boolean;
  limit_reached?: boolean;
  streak?: StreakInfo;
  bonus?: BonusInfo | null;
  relationship_level?: number;
  relationship_level_up?: RelationshipLevelUp | null;
};

export type GreetingResponse = {
  reply: string;
  emotion_tag: string;
  asset_path: string;
  relationship_level?: number;
  relationship_level_name?: string;
};

export type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export type ChatHistoryResponse = {
  messages: ChatHistoryItem[];
  asset_path: string | null;
  relationship_level?: number;
  relationship_level_name?: string;
};

export type RewardsState = {
  current_streak: number;
  longest_streak: number;
  streak_freezes: number;
  reward_points: number;
  chat_theme: string;
};

export type ThemeInfo = {
  id: string;
  name: string;
  unlock_streak: number;
  bg: string;
  bubble_assistant: string;
  accent: string | null;
  unlocked: boolean;
};

export type ThemesResponse = {
  active_theme: string;
  themes: ThemeInfo[];
};

export type ShareResponse = {
  reward_granted: boolean;
  reward_points: number;
};

export async function signup(params: {
  name: string;
  ageConfirmed: boolean;
  genderPreference: string;
  companionId: string;
}): Promise<SignupResponse> {
  const deviceId = await getOrCreateDeviceId();

  const response = await fetch(`${API_BASE_URL}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      age_confirmed: params.ageConfirmed,
      gender_preference: params.genderPreference,
      companion_id: params.companionId,
      initial_tone: "unknown", // 성향타입 선택 제거 - 대화하면서 자동 학습
      device_id: deviceId,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Signup failed (${response.status}): ${body} | sent companionId="${params.companionId}"`);
  }

  const data: SignupResponse = await response.json();
  await storeTokens(data.access_token, data.refresh_token);
  return data;
}

async function refreshAccessToken(): Promise<string> {
  const session = await getSession();
  const refreshToken = await getRefreshToken();
  const deviceId = await getOrCreateDeviceId();

  if (!session || !refreshToken) {
    throw new Error("No session to refresh. Please log in again.");
  }

  const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: session.userId,
      refresh_token: refreshToken,
      device_id: deviceId,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    // Only treat this as a real logout if the server explicitly rejected the
    // refresh token (401). Other failures (502/503/timeouts during a cold
    // Render restart, etc.) are transient and shouldn't wipe a valid session.
    if (response.status === 401) {
      await clearAuthTokens();
    }
    throw new Error(`Refresh failed (${response.status}): ${body}`);
  }

  const data: { access_token: string; refresh_token: string } = await response.json();
  await storeTokens(data.access_token, data.refresh_token);
  return data.access_token;
}

/**
 * Resolves to a usable access token, recovering from a wiped/missing token
 * where possible instead of just failing:
 * 1. Use the stored access token if present.
 * 2. Otherwise try the refresh token, if one is still stored.
 * 3. Otherwise, if we still have a cached session (name/companion) and a
 *    device_id, silently re-establish the session via /signup's
 *    existing-account reconnect path - this is the same device, so the
 *    backend recognizes it and returns a fresh token pair without creating
 *    a duplicate account or losing any history.
 * Only throws "Not logged in" if none of the above are available at all
 * (e.g. truly first-ever launch, before onboarding).
 */
async function ensureValidToken(): Promise<string> {
  const existing = await getAccessToken();
  if (existing) return existing;

  const refreshToken = await getRefreshToken();
  if (refreshToken) {
    try {
      return await refreshAccessToken();
    } catch {
      // fall through to full reconnect below
    }
  }

  const session = await getSession();
  if (!session) {
    throw new Error("Not logged in.");
  }

  const reconnected = await signup({
    name: session.name,
    ageConfirmed: true,
    genderPreference: "female",
    companionId: session.companion.toLowerCase(),
    initialTone: "unknown",
  });
  return reconnected.access_token;
}

async function authorizedFetch(path: string, init: RequestInit): Promise<Response> {
  let token = await ensureValidToken();

  const withAuth = (t: string): RequestInit => ({
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` },
  });

  let response = await fetch(`${API_BASE_URL}${path}`, withAuth(token));

  if (response.status === 401) {
    token = await refreshAccessToken();
    response = await fetch(`${API_BASE_URL}${path}`, withAuth(token));
  }

  return response;
}

export async function chat(params: { message: string }): Promise<ChatResponse> {
  const response = await authorizedFetch("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: params.message }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Chat failed (${response.status}): ${body}`);
  }

  return response.json();
}

export async function getChatHistory(): Promise<ChatHistoryResponse> {
  const response = await authorizedFetch("/chat/history", { method: "GET" });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Chat history failed (${response.status}): ${body}`);
  }

  return response.json();
}

export async function getGreeting(): Promise<GreetingResponse> {
  const response = await authorizedFetch("/chat/greeting", { method: "POST" });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Greeting failed (${response.status}): ${body}`);
  }

  return response.json();
}

export async function getRewardsState(): Promise<RewardsState> {
  const response = await authorizedFetch("/rewards/state", { method: "GET" });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Rewards state failed (${response.status}): ${body}`);
  }

  return response.json();
}

export async function getThemes(): Promise<ThemesResponse> {
  const response = await authorizedFetch("/rewards/themes", { method: "GET" });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Themes failed (${response.status}): ${body}`);
  }

  return response.json();
}

export async function setChatTheme(themeId: string): Promise<{ active_theme: string }> {
  const response = await authorizedFetch("/rewards/theme", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme_id: themeId }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Set theme failed (${response.status}): ${body}`);
  }

  return response.json();
}

export async function sendShare(momentType: string): Promise<ShareResponse> {
  const response = await authorizedFetch("/rewards/share", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ moment_type: momentType }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Share failed (${response.status}): ${body}`);
  }

  return response.json();
}
