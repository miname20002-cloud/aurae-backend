import { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import Screen from "@/components/Screen";
import { useRouter } from "expo-router";
import { colors } from "@/theme/colors";
import { useOnboarding } from "@/context/OnboardingContext";
import { signup } from "@/lib/api";
import { saveSession } from "@/lib/session";

export default function ToneScreen() {
  const router = useRouter();
  const { name, genderPreference, companionId } = useOnboarding();

  useEffect(() => {
    const performSignup = async () => {
      if (!genderPreference || !companionId) {
        router.back();
        return;
      }

      try {
        const result = await signup({
          name,
          ageConfirmed: true,
          genderPreference,
          companionId,
        });
        await saveSession({ userId: result.user_id, companion: result.companion, name });
        router.replace({
          pathname: "/chat",
          params: { userId: String(result.user_id), companion: result.companion },
        });
      } catch (err) {
        router.back();
      }
    };

    performSignup();
  }, []);

  return (
    <Screen style={{ flex: 1, backgroundColor: colors.background, justifyContent: "center" }}>
      <View style={{ alignItems: "center" }}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    </Screen>
  );
}