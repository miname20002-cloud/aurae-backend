import { createContext, useContext, useState, ReactNode } from "react";

type GenderPreference = "female" | "male";
type Tone = "gentle" | "witty";

type OnboardingState = {
  name: string;
  genderPreference: GenderPreference | null;
  companionId: string | null;
  tone: Tone | null;
};

type OnboardingContextValue = OnboardingState & {
  setName: (name: string) => void;
  setGenderPreference: (g: GenderPreference) => void;
  setCompanionId: (id: string) => void;
  setTone: (t: Tone) => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [name, setName] = useState("");
  const [genderPreference, setGenderPreference] = useState<GenderPreference | null>(null);
  const [companionId, setCompanionId] = useState<string | null>(null);
  const [tone, setTone] = useState<Tone | null>(null);

  return (
    <OnboardingContext.Provider
      value={{ name, genderPreference, companionId, tone, setName, setGenderPreference, setCompanionId, setTone }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const ctx = useContext(OnboardingContext);
  if (!ctx) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return ctx;
}
