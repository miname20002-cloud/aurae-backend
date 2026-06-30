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
        {/* 🏛️ 신뢰감 있고 묵직한 프리미엄 카피라이팅 */}
        <Text style={styles.title}>Select your companion.</Text>
        <Text style={styles.body}>Choose the intellectual presence to share your thoughts with.</Text>

        <View style={styles.optionRow}>
          {options.map((companion) => (
            <Pressable
              key={companion.id}
              onPress={() => choose(companion.id)}
              disabled={loading}
              style={({ pressed }) => [styles.option, pressed && styles.optionPressed]}
            >
              {/* 🏛️ 테두리를 정교하고 차분하게 미세 조정 */}
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
    letterSpacing: -0.3,
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
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.xl, // 여백을 넉넉히 주어 고급 브랜드 레이아웃 연출
    alignItems: "center",
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  optionPressed: {
    borderColor: colors.accent,
  },
  avatarWrapper: {
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 1.5, // 🏛️ 두께를 얇게 낮춰 캐주얼함을 빼고 클래식함 장착
    padding: 3,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: colors.background,
  },
  avatarImage: {
    width: 88,
    height: 88,
    borderRadius: 44,
  },
  optionText: {
    fontSize: 15, // 🏛️ 폰트 크기를 살짝 줄여 절제미 강조
    fontWeight: "600", // 너무 굵은 700보다 신뢰감을 주는 두께
    color: colors.textPrimary,
    letterSpacing: 0.2,
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