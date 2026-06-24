import { View, Text, Pressable, StyleSheet } from "react-native";
import Screen from "@/components/Screen";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";
import { useOnboarding } from "@/context/OnboardingContext";

const GIRL_COLOR = "#FF8FAB";
const GUY_COLOR = "#4F9DFF";

function hexToRgba(hex: string, alpha: number): string {
  const sanitized = hex.replace("#", "");
  const bigint = parseInt(sanitized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function GenderScreen() {
  const router = useRouter();
  const { setGenderPreference } = useOnboarding();

  function choose(gender: "female" | "male") {
    setGenderPreference(gender);
    router.push("/onboarding/companion");
  }

  return (
    <Screen style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Who do you want to connect with?</Text>
        <Text style={styles.body}>Pick the energy you vibe with.</Text>

        <View style={styles.optionRow}>
          <Pressable
            onPress={() => choose("female")}
            style={({ pressed }) => [
              styles.option,
              { backgroundColor: hexToRgba(GIRL_COLOR, 0.14), borderColor: hexToRgba(GIRL_COLOR, 0.4) },
              pressed && { borderColor: GIRL_COLOR, backgroundColor: hexToRgba(GIRL_COLOR, 0.22) },
            ]}
          >
            <Text style={[styles.optionText, { color: GIRL_COLOR }]}>Girl</Text>
          </Pressable>
          <Pressable
            onPress={() => choose("male")}
            style={({ pressed }) => [
              styles.option,
              { backgroundColor: hexToRgba(GUY_COLOR, 0.14), borderColor: hexToRgba(GUY_COLOR, 0.4) },
              pressed && { borderColor: GUY_COLOR, backgroundColor: hexToRgba(GUY_COLOR, 0.22) },
            ]}
          >
            <Text style={[styles.optionText, { color: GUY_COLOR }]}>Guy</Text>
          </Pressable>
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
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: spacing.lg,
    alignItems: "center",
  },
  optionText: {
    fontSize: 18,
    fontWeight: "800",
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
