import { useState } from "react";
import { View, Text, Pressable, Image, StyleSheet } from "react-native";
import Screen from "@/components/Screen";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";
import { useOnboarding } from "@/context/OnboardingContext";
import { companionsFor, Companion } from "@/lib/companions";
import { assetUrl } from "@/lib/api";

function CompanionAvatar({ companion }: { companion: Companion }) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <View style={[styles.avatar, { backgroundColor: companion.accent }]}>
      {!imageFailed && (
        <Image
          source={{ uri: assetUrl(companion.facePath) }}
          style={styles.avatarImage}
          onError={() => setImageFailed(true)}
        />
      )}
      {imageFailed && <Text style={styles.avatarText}>{companion.initial}</Text>}
    </View>
  );
}

export default function CompanionScreen() {
  const router = useRouter();
  const { genderPreference, setCompanionId } = useOnboarding();

  // Falls back to "female" if someone lands here directly without picking
  // a gender first - keeps this screen from crashing rather than enforcing
  // strict navigation order.
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
              <Text style={styles.optionText}>{companion.name}</Text>
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
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
    color: colors.textPrimary,
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
