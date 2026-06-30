import { View, Text, Pressable, StyleSheet } from "react-native";
import Screen from "@/components/Screen";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";
import { useOnboarding } from "@/context/OnboardingContext";

const FEMME_COLOR = "#FF8FAB";
const HOMME_COLOR = "#4F9DFF";

def function hexToRgba(hex: string, alpha: number): string {
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
        {/* 🏛️ 세대를 아우르는 정중하고 직관적인 카피라이팅 */}
        <Text style={styles.title}>Select a presence.</Text>
        <Text style={styles.body}>Choose the voice you would like to converse with.</Text>

        <View style={styles.optionRow}>
          <Pressable
            onPress={() => choose("female")}
            style={({ pressed }) => [
              styles.option,
              { backgroundColor: hexToRgba(FEMME_COLOR, 0.10), borderColor: hexToRgba(FEMME_COLOR, 0.3) },
              pressed && { borderColor: FEMME_COLOR, backgroundColor: hexToRgba(FEMME_COLOR, 0.18) },
            ]}
          >
            {/* 🏛️ 가볍지 않고 명확한 클래식 라벨 */}
            <Text style={[styles.optionText, { color: FEMME_COLOR }]}>Woman</Text>
          </Pressable>
          
          <Pressable
            onPress={() => choose("male")}
            style={({ pressed }) => [
              styles.option,
              { backgroundColor: hexToRgba(HOMME_COLOR, 0.10), borderColor: hexToRgba(HOMME_COLOR, 0.3) },
              pressed && { borderColor: HOMME_COLOR, backgroundColor: hexToRgba(HOMME_COLOR, 0.18) },
            ]}
          >
            {/* 🏛️ 가볍지 않고 명확한 클래식 라벨 */}
            <Text style={[styles.optionText, { color: HOMME_COLOR }]}>Man</Text>
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
    letterSpacing: -0.3, // 묵직하고 밀도 있는 느낌을 위해 자간 밀착
  },
  body: {
    fontSize: 15,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    lineHeight: 21,
  },
  optionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  option: {
    flex: 1,
    borderWidth: 1.2,
    borderRadius: radius.md,
    paddingVertical: spacing.lg, // 너무 과하지 않은 안정적인 높이감 유지
    alignItems: "center",
  },
  optionText: {
    fontSize: 17, 
    fontWeight: "600", // 너무 두꺼워서 스포티해 보이는 것보다 신뢰감 있는 굵기
    letterSpacing: 0.2,
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
