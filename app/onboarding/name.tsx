import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Screen from "@/components/Screen";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";
import { useOnboarding } from "@/context/OnboardingContext";

const NAME_REGEX = /^[a-zA-Z가-힣\s]+$/;

// 알림 권한(OS 다이얼로그)을 온보딩 첫 페이지를 넘어가는 시점에 미리
// 요청해둔다. 이걸 chat.tsx(인트로 영상 재생 화면)에서 요청하면 다이얼로그가
// 인트로 영상 위에 끼어들어서 몰입이 깨지기 때문에, 여기서 끝내놓고
// chat.tsx에서는 "이미 허용됐는지"만 조회해서 토큰 등록만 한다.
//
// 실패(거부/시뮬레이터 등)해도 조용히 무시 - 온보딩 진행 자체를 막지 않는다.
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

    // await 하지 않는다 - 다이얼로그 응답을 기다리느라 다음 화면 전환이
    // 막히면 안 된다. 사용자가 gender 화면으로 넘어간 직후(=첫 페이지를
    // 넘어간 시점) 다이얼로그가 뜨고, 그 위에서 응답하면 된다.
    requestNotificationPermissionEarly();

    router.push("/onboarding/gender");
  }

  return (
    <Screen style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>What should we call you?</Text>
        <Text style={styles.body}>Enter your name to continue.</Text>
        <TextInput
          value={input}
          onChangeText={(text) => {
            setInput(text);
            if (error) setError(null);
          }}
          placeholder="Your name"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          autoFocus
          autoCapitalize="words"
          returnKeyType="next"
          onSubmitEditing={handleNext}
          maxLength={20}
        />
       <View style={styles.noticeRow}>
          <Text style={styles.noticeIcon}>⚠️</Text>
          <Text style={styles.noticeText}>
            Your name can't be changed after signup. Choose carefully.
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
            Next
          </Text>
        </Pressable>
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
