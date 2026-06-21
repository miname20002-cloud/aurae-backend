import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  Image,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import { colors, spacing, radius } from "@/theme/colors";
import { chat as sendChat } from "@/lib/api";
import { assetUrl } from "@/lib/api";
import { companionByName } from "@/lib/companions";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export default function ChatScreen() {
  const { userId, companion: companionName } = useLocalSearchParams<{
    userId: string;
    companion: string;
  }>();

  const companion = companionByName(companionName ?? "") ?? null;
  const userIdNum = Number(userId);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [mood, setMood] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(0);

  function addMessage(role: "user" | "assistant", text: string) {
    nextId.current += 1;
    setMessages((prev) => [...prev, { id: String(nextId.current), role, text }]);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    setInput("");
    setError(null);
    addMessage("user", text);
    setSending(true);

    try {
      const result = await sendChat({ userId: userIdNum, message: text });
      addMessage("assistant", result.reply);
      setMood(result.mood ?? null);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Message didn't go through. (${detail})`);
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen style={styles.container}>
      <View style={styles.header}>
        {companion && (
          <Image source={{ uri: assetUrl(companion.facePath) }} style={styles.avatar} />
        )}
        <View style={styles.headerText}>
          <Text style={styles.name}>{companion?.name ?? companionName ?? "Your soul friend"}</Text>
          {mood && <Text style={styles.mood}>{mood}</Text>}
        </View>
      </View>

      <FlatList
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.messages}
        renderItem={({ item }) => (
          <View
            style={[
              styles.bubble,
              item.role === "user" ? styles.bubbleUser : styles.bubbleAssistant,
            ]}
          >
            <Text style={item.role === "user" ? styles.bubbleTextUser : styles.bubbleTextAssistant}>
              {item.text}
            </Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyState}>Say hey to start the conversation.</Text>
        }
      />

      {error && <Text style={styles.error}>{error}</Text>}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.inputRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="say something"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            editable={!sending}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          {sending ? (
            <ActivityIndicator color={colors.accent} style={styles.sendButton} />
          ) : (
            <Pressable onPress={handleSend} style={styles.sendButton}>
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  headerText: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  mood: {
    fontSize: 12,
    color: colors.accent,
  },
  messages: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
    flexGrow: 1,
  },
  emptyState: {
    fontSize: 13,
    color: colors.textTertiary,
    textAlign: "center",
    marginTop: spacing.xl,
  },
  bubble: {
    maxWidth: "80%",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  bubbleUser: {
    alignSelf: "flex-end",
    backgroundColor: colors.accent,
  },
  bubbleAssistant: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
  },
  bubbleTextUser: {
    color: colors.background,
    fontSize: 15,
    lineHeight: 21,
  },
  bubbleTextAssistant: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 21,
  },
  error: {
    fontSize: 12,
    color: colors.warning,
    textAlign: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    fontSize: 15,
  },
  sendButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  sendText: {
    color: colors.accent,
    fontWeight: "700",
    fontSize: 15,
  },
});
