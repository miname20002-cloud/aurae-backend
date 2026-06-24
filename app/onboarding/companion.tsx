import { View, Text, Pressable, StyleSheet, ActivityIndicator, Image } from "react-native";
import Screen from "@/components/Screen";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";
import { useOnboarding } from "@/context/OnboardingContext";
import { companionsFor } from "@/lib/companions";
import { signup } from "@/lib/api";
import { saveSession } from "@/lib/session";
import { assetUrl } from "@/lib/api";
import { useState } from "react";

export default function CompanionScreen() {
  const router = useRouter();
  const { name, genderPreference, setCompanionId } = useOnboarding();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = companionsFor(genderPreference ?? "female");

  async function choose(id: string) {
    setCompanionId(id);
    setError(null);
    setLoading(true);

    try {
      const result = await signup({
        name,
        ageConfirmed: true,
        genderPreference: genderPreference ?? "female",
        companionId: id,
      });
      await saveSession({ userId: result.user_id, companion: result.companion, name });
      router.replace({
        pathname: "/chat",
        params: { userId: String(result.user_id), companion: result.companion },
      });
    } catch (err) {
      setError("Couldn't connect right now. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <Screen style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Pick your soul match</Text>
        <Text style={styles.body}>Choose who feels right.</Text>

        <View style={styles.optionRow}>
          {options.map((companion) => (
            <Pressable
              key={companion.id}
              onPress={() => choose(companion.id)}
              disabled={loading}
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            >
              <View style={[styles.avatarWrapper, { borderColor: companion.accent }]}>
                <Image 
                  source={{ uri: assetUrl(companion.facePath) }}
                  style={styles.avatarImage}
                />
              </View>
              <Text style={styles.optionText}>{companion.name}</Text>
            </Pressable>
          ))}
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
    gap: spacing.sm,
  },
  optionPressed: {
    borderColor: colors.accent,
  },
  avatarWrapper: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 3,
    padding: 2,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
  },
  avatarImage: {
    width: 96,
    height: 96,
    borderRadius: 48,
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
