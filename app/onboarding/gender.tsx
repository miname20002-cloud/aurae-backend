import { View, Text, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";
import { useOnboarding } from "@/context/OnboardingContext";

export default function GenderScreen() {
  const router = useRouter();
  const { setGenderPreference } = useOnboarding();

  function choose(gender: "female" | "male") {
    setGenderPreference(gender);
    router.push("/onboarding/companion");
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Who do you want to connect with?</Text>
        <Text style={styles.body}>Pick the energy you vibe with.</Text>

        <View style={styles.optionRow}>
          <Pressable
            onPress={() => choose("female")}
            style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
          >
            <Text style={styles.optionText}>Female AI</Text>
          </Pressable>
          <Pressable
            onPress={() => choose("male")}
            style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
          >
            <Text style={styles.optionText}>Male AI</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.bottom}>
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
  bottom: {
    paddingBottom: spacing.xl,
    alignItems: "center",
  },
  back: {
    fontSize: 13,
    color: colors.textTertiary,
  },
});
