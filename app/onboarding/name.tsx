import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Screen from "@/components/Screen";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";
import { useOnboarding } from "@/context/OnboardingContext";

const NAME_REGEX = /^[a-zA-Z가-힣\s]+$/;

async function requestNotificationPermissionEarly() {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    if (existingStatus !== "granted") {
      await Notifications.requestPermissionsAsync();
    }
  } catch {
    // 거부/시뮬레이터 등에서 실패해도 무시
  }
}

export default function NameScreen() {
  const router = useRouter();
  const { setName } = useOnboarding();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  function handleNext() {
    const trimmed = input.trim();

    if (trimmed.length < 2) {
      setError("Name must be at least 2 characters.");
      return;
    }
    if (!NAME_REGEX.test(trimmed)) {
      setError("Letters only - no numbers, symbols, or emojis.");
      return;
    }

    setError(null);
    setName(trimmed);

    requestNotificationPermissionEarly();
    router.push("/onboarding/gender");
  }

  return (
    <Screen style={styles.container}>
      <View style={styles.content}>
        {/* 🌟 럭셔리 Gen Z 감성의 카피라이팅으로 변경 */}
        <Text style={styles.title}>Define your profile.</Text>
        <Text style={styles.body}>How should Aurae address you?</Text>
        
        <TextInput
          value={input}
          onChangeText={(text) => {
            setInput(text);
            if (error) setError(null);
          }}
          placeholder="Enter your name"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoFocus
          autoCapitalize="words"
          returnKeyType="next"
          onSubmitEditing={handleNext}
          maxLength={20}
        />
        
        <View style={styles.noticeRow}>
          <Text style={styles.noticeIcon}>✦</Text>
          <Text style={styles.noticeText}>
            Your registered name cannot be altered post-signup. Choose with intent.
          </Text>
        </View>
        {error && <Text style={styles.error}>{error}</Text>}
      </View>
      
      <View style={styles.bottom}>
        <Pressable
          onPress={handleNext}
          disabled={!input.trim()}
          style={({ pressed }) => [
            styles.cta,
            !input.trim() && styles.ctaDisabled,
            !!input.trim() && pressed && styles.ctaPressed,
          ]}
        >
          <Text style={[styles.ctaText, !input.trim() && styles.ctaTextDisabled]}>
            Continue
          </Text>
        </Pressable>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </Pressable>
      </View>
    </Screen>
  );
}

// 스타일 시트는 대장이 짠 레이아웃이 훌륭하므로 기존 그대로 유지!
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
    marginBottom: spacing.lg,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  noticeRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  noticeIcon: {
    fontSize: 12,
    color: colors.textTertiary,
  },
  noticeText: {
    flex: 1,
    fontSize: 12,
    color: colors.textTertiary,
    lineHeight: 17,
  },
  error: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.warning,
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
