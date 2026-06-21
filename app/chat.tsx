import { View, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { colors, spacing } from "@/theme/colors";

export default function ChatPlaceholder() {
  const { userId, companion } = useLocalSearchParams<{ userId: string; companion: string }>();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Connected</Text>
        <Text style={styles.body}>
          You're linked with {companion ?? "your companion"}.
        </Text>
        <Text style={styles.meta}>user_id: {userId ?? "—"}</Text>
        <Text style={styles.note}>
          Real chat screen is the next step — this just confirms signup worked.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: 16,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  meta: {
    fontSize: 13,
    color: colors.textTertiary,
    marginBottom: spacing.lg,
  },
  note: {
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: "center",
  },
});
