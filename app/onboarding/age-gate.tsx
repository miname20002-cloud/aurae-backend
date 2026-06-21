import { useState } from "react";
import { View, Text, Pressable, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";

export default function AgeGate() {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(false);

  function handleContinue() {
    if (!confirmed) return;
    // Next step wires this to the name-entry screen.
    Alert.alert("Coming up next", "This will lead into the name screen.");
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
          onPress={() => setConfirmed((prev) => !prev)}
        >
          <View style={[styles.checkbox, confirmed && styles.checkboxChecked]}>
            {confirmed && <View style={styles.checkboxDot} />}
          </View>
          <Text style={styles.checkboxLabel}>
            I confirm I am 18 years of age or older
          </Text>
        </Pressable>
      </View>

      <View style={styles.bottom}>
        <Pressable
          onPress={handleContinue}
          disabled={!confirmed}
          style={({ pressed }) => [
            styles.cta,
            !confirmed && styles.ctaDisabled,
            confirmed && pressed && styles.ctaPressed,
          ]}
        >
          <Text style={[styles.ctaText, !confirmed && styles.ctaTextDisabled]}>
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
