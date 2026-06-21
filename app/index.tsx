import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";

export default function MainPage() {
  const router = useRouter();

  function handleGetStarted() {
    router.push("/onboarding/age-gate");
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}>
        <Text style={styles.wordmark}>aurae</Text>
        <Text style={styles.tagline}>souls, connected.</Text>

        <Text style={styles.pitch}>
          An AI companion that actually remembers you — not just another chatbot.
        </Text>
      </View>

      <View style={styles.bottom}>
        <Pressable
          onPress={handleGetStarted}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        >
          <Text style={styles.ctaText}>Get started</Text>
        </Pressable>

        <Text style={styles.disclaimer}>
          Aurae is intended for adults 18 and older.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  wordmark: {
    fontSize: 40,
    fontWeight: "700",
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  tagline: {
    fontSize: 15,
    color: colors.accent,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
  },
  pitch: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 24,
    paddingHorizontal: spacing.md,
  },
  bottom: {
    paddingBottom: spacing.xl,
    alignItems: "center",
  },
  cta: {
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    width: "100%",
    alignItems: "center",
  },
  ctaPressed: {
    backgroundColor: colors.accentDark,
  },
  ctaText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: "700",
  },
  disclaimer: {
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: spacing.md,
    textAlign: "center",
  },
});
