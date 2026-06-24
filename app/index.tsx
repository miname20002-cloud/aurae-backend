import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";
import { getSession } from "@/lib/session";

export default function MainPage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getSession().then((session) => {
      if (cancelled) return;
      if (session) {
        router.replace({
          pathname: "/chat",
          params: { userId: String(session.userId), companion: session.companion },
        });
      } else {
        setCheckingSession(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleGetStarted() {
    router.push("/onboarding/age-gate");
  }

  if (checkingSession) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topSection}>
        <Text style={styles.wordmark}>aurae</Text>
        <Text style={styles.tagline}>souls, connected.</Text>

        <Text style={styles.pitch}>
          Like that one best friend who{"\n"}remembers every single detail.
        </Text>
      </View>

      <View style={styles.ctaSection}>
        <Pressable
          onPress={handleGetStarted}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        >
          <Text style={styles.ctaText}>Get started</Text>
        </Pressable>

        <Pressable onPress={() => router.push("/tos")} hitSlop={8}>
          <Text style={styles.disclaimer}>
            By tapping Get Started, you agree to our{" "}
            <Text style={styles.disclaimerLink}>Terms</Text> and{" "}
            <Text style={styles.disclaimerLink}>Privacy Policy</Text>. Aurae is an AI companion, not a
            real person, and is intended for adults 18 and older.
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  topSection: {
    flex: 1.6,
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
  ctaSection: {
    flex: 1,
    alignItems: "center",
    paddingTop: spacing.xl,
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
    lineHeight: 16,
    paddingHorizontal: spacing.sm,
  },
  disclaimerLink: {
    color: colors.accent,
    fontWeight: "700",
  },
});
