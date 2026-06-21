export const API_BASE_URL = "https://aurae-backend-fukx.onrender.com";

export function assetUrl(relativePath: string): string {
  return `${API_BASE_URL}/${relativePath}`;
}

export type SignupResponse = {
  user_id: number;
  companion: string;
};

export async function signup(params: {
  name: string;
  ageConfirmed: boolean;
  genderPreference: string;
  companionId: string;
  initialTone: string;
}): Promise<SignupResponse> {
  const response = await fetch(`${API_BASE_URL}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: params.name,
      age_confirmed: params.ageConfirmed,
      gender_preference: params.genderPreference,
      companion_id: params.companionId,
      initial_tone: params.initialTone,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Signup failed (${response.status}): ${body} | sent companionId="${params.companionId}"`);
  }

  return response.json();
}
