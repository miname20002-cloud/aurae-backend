import { useState, useRef, useEffect } from "react";
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
import { useVideoPlayer, VideoView } from "expo-video";
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
  const { companion: companionName } = useLocalSearchParams<{
    userId: string;
    companion: string;
  }>();

  const companion = companionByName(companionName ?? "") ?? null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [mood, setMood] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentAssetPath, setCurrentAssetPath] = useState<string | null>(null);
  const nextId = useRef(0);

  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  useEffect(() => {
    if (!currentAssetPath) return;
    const url = assetUrl(currentAssetPath);
    player.replace(url);
    player.play();
  }, [currentAssetPath]);

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
      const result = await sendChat({ message: text });
      addMessage("assistant", result.reply);
      setMood(result.mood ?? null);
      setCurrentAssetPath(result.asset_path);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Message didn't go through. (${detail})`);
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flexFill}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "android" ? 24 : 0}
      >
        <View style={styles.stage}>
          {currentAssetPath ? (
            <VideoView
              player={player}
              style={styles.stageMedia}
              contentFit="cover"
              nativeControls={false}
            />
          ) : companion ? (
            <Image
              source={{ uri: assetUrl(companion.facePath) }}
              style={styles.stageMedia}
              resizeMode="cover"
            />
          ) : null}
        </View>

        <View style={styles.header}>
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
  flexFill: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  stage: {
    width: "100%",
    height: 220,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  stageMedia: {
    width: "100%",
    height: "100%",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
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
