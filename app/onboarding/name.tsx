import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import Screen from "@/components/Screen";
import { useRouter } from "expo-router";
import { colors, spacing, radius } from "@/theme/colors";
import { useOnboarding } from "@/context/OnboardingContext";

const NAME_REGEX = /^[a-zA-Z가-힣\s]+$/;

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
