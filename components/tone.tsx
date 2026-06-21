import { useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import Screen from "@/components/Screen";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";
import { useOnboarding } from "@/context/OnboardingContext";
import { signup } from "@/lib/api";
import { saveSession } from "@/lib/session";

export default function ToneScreen() {
  const router = useRouter();
  const { name, genderPreference, companionId, setTone } = useOnboarding();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(tone: "gentle" | "witty") {
    setTone(tone);
    setError(null);

    if (!genderPreference || !companionId) {
      setError("Something's missing — try going back and picking again.");
      return;
    }

    setLoading(true);
    try {
      const result = await signup({
        name,
        ageConfirmed: true,
        genderPreference,
        companionId,
        initialTone: tone,
      });
      await saveSession({ userId: result.user_id, companion: result.companion, name });
      router.replace({
        pathname: "/chat",
        params: { userId: String(result.user_id), companion: result.companion },
      });
    } catch (err) {
      setError("Couldn't connect right now. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Choose conversation style</Text>
        <Text style={styles.body}>Tune the behavioral matrix of your entity.</Text>

        <View style={styles.optionRow}>
          <Pressable
            onPress={() => choose("gentle")}
            disabled={loading}
            style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
          >
            <Text style={styles.optionText}>Gentle</Text>
          </Pressable>
          <Pressable
            onPress={() => choose("witty")}
            disabled={loading}
            style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
          >
            <Text style={styles.optionText}>Witty</Text>
          </Pressable>
        </View>

        {loading && <ActivityIndicator color={colors.accent} style={styles.spinner} />}
        {error && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.bottom}>
        <Pressable onPress={() => router.back()} disabled={loading}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  content: {
    flex: 1,
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  optionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  option: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  optionPressed: {
    borderColor: colors.accent,
  },
  optionText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  spinner: {
    marginTop: spacing.lg,
  },
  error: {
    marginTop: spacing.lg,
    fontSize: 13,
    color: colors.warning,
    textAlign: "center",
  },
  bottom: {
    paddingBottom: spacing.xl,
    alignItems: "center",
  },
  back: {
    fontSize: 13,
    color: colors.textTertiary,
  },
});
