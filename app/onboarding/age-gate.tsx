import { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";

export default function AgeGate() {
  const router = useRouter();
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const canContinue = ageConfirmed && termsAccepted;

  function handleContinue() {
    if (!canContinue) return;
    router.push("/onboarding/name");
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Before we connect</Text>
        <Text style={styles.body}>
          Aurae includes mature, emotionally immersive conversations. You
          need to be 18 or older to continue.
        </Text>

        <Pressable
          style={styles.checkboxRow}
          onPress={() => setAgeConfirmed((prev) => !prev)}
        >
          <View style={[styles.checkbox, ageConfirmed && styles.checkboxChecked]}>
            {ageConfirmed && <View style={styles.checkboxDot} />}
          </View>
          <Text style={styles.checkboxLabel}>
            I confirm I am 18 years of age or older
          </Text>
        </Pressable>

        <Pressable
          style={styles.checkboxRow}
          onPress={() => setTermsAccepted((prev) => !prev)}
        >
          <View style={[styles.checkbox, termsAccepted && styles.checkboxChecked]}>
            {termsAccepted && <View style={styles.checkboxDot} />}
          </View>
          <Text style={styles.checkboxLabel}>
            I agree to the Terms of Service and Privacy Policy
          </Text>
        </Pressable>
      </View>

      <View style={styles.bottom}>
        <Pressable
          onPress={handleContinue}
          disabled={!canContinue}
          style={({ pressed }) => [
            styles.cta,
            !canContinue && styles.ctaDisabled,
            canContinue && pressed && styles.ctaPressed,
          ]}
        >
          <Text style={[styles.ctaText, !canContinue && styles.ctaTextDisabled]}>
            Continue
          </Text>
        </Pressable>

        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
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
  content: {
    flex: 2.2,
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
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.md / 2,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxChecked: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  checkboxDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.background,
  },
  checkboxLabel: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  bottom: {
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
  ctaDisabled: {
    backgroundColor: colors.surface,
  },
  ctaText: {
    color: colors.background,
    fontSize: 16,
    fontWeight: "700",
  },
  ctaTextDisabled: {
    color: colors.textTertiary,
  },
  back: {
    fontSize: 13,
    color: colors.textTertiary,
    marginTop: spacing.md,
  },
});
