import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import Animated, { useSharedValue, useAnimatedProps, withRepeat, withTiming, Easing } from "react-native-reanimated";
import { colors, spacing, radius } from "@/theme/colors";
import { getSession } from "@/lib/session";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// 화이트 단일색 글로우가 'a'부터 'e' 쪽으로 부드럽게 스윕하는 효과.
// 왼쪽 끝/오른쪽 끝에서 투명해지도록(sin 곡선) 해서, 한 바퀴 끝나고
// 다시 왼쪽에서 시작될 때 점프가 안 보이고 자연스럽게 반복된다.
function AuroraGlow() {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.ease) }), -1, false);
  }, []);

  const sweepProps = useAnimatedProps(() => {
    const cx = 70 + progress.value * 200; // 70~270, 반지름(60)+버퍼만큼 여유를 둬서 캔버스 끝에서 안 잘림
    const fillOpacity = Math.sin(progress.value * Math.PI); // 0 -> 1 -> 0
    return { cx, fillOpacity };
  });

  return (
    <Svg width={340} height={120} viewBox="0 0 340 120" style={styles.auroraSvg}>
      <Defs>
        <RadialGradient id="auroraWhite" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.9} />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <AnimatedCircle animatedProps={sweepProps} cy={60} r={60} fill="url(#auroraWhite)" />
    </Svg>
  );
}

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
        <View style={styles.wordmarkWrap}>
          <AuroraGlow />
          <Text style={styles.wordmark}>aurae</Text>
        </View>
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
  wordmarkWrap: {
    width: 340,
    height: 120,
    alignItems: "center",
    justifyContent: "center",
  },
  auroraSvg: {
    position: "absolute",
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
