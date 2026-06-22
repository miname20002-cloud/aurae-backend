import { useState } from "react";
import { View, Text, Pressable, Image, StyleSheet } from "react-native";
import Screen from "@/components/Screen";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";
import { useOnboarding } from "@/context/OnboardingContext";
import { companionsFor, Companion } from "@/lib/companions";
import { assetUrl } from "@/lib/api";

function hexToRgba(hex: string, alpha: number): string {
  const sanitized = hex.replace("#", "");
  const bigint = parseInt(sanitized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function CompanionAvatar({ companion }: { companion: Companion }) {
  const [attempt, setAttempt] = useState(0);
  const [imageFailed, setImageFailed] = useState(false);

  function handleError() {
    if (attempt < 2) {
      setTimeout(() => setAttempt((a) => a + 1), 1500);
    } else {
      setImageFailed(true);
    }
  }

  const glowOuter = hexToRgba(companion.accent, 0.12);
  const glowMid = hexToRgba(companion.accent, 0.22);
  const glowInner = hexToRgba(companion.accent, 0.35);
  const borderColor = hexToRgba(companion.accent, 0.6);

  return (
    <View style={[styles.glowOuter, { backgroundColor: glowOuter }]}>
      <View style={[styles.glowMid, { backgroundColor: glowMid }]}>
        <View style={[styles.glowInner, { backgroundColor: glowInner }]}>
          <View style={[styles.avatar, { backgroundColor: companion.accent, borderColor }]}>
            {!imageFailed && (
              <Image
                key={attempt}
                source={{ uri: assetUrl(companion.facePath) }}
                style={styles.avatarImage}
                onError={handleError}
              />
            )}
            {imageFailed && <Text style={styles.avatarText}>{companion.initial}</Text>}
          </View>
        </View>
      </View>
    </View>
  );
}

export default function CompanionScreen() {
  const router = useRouter();
  const { genderPreference, setCompanionId } = useOnboarding();
  const options = companionsFor(genderPreference ?? "female");

  function choose(id: string) {
    setCompanionId(id);
    router.push("/onboarding/tone");
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
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            >
              <CompanionAvatar companion={companion} />
              <Text style={[styles.optionText, { color: companion.accent }]}>
                {companion.name}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.bottom}>
        <Pressable onPress={() => router.back()}>
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
  glowOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  glowMid: {
    width: 64,
    height: 64,
    borderRadius: 32,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  glowInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: {
    width: 48,
    height: 48,
  },
  avatarText: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.background,
  },
  optionText: {
    fontSize: 16,
    fontWeight: "700",
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
