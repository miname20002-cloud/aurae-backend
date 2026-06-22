import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  AppState,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import Svg, { Defs, Mask, Rect, Circle } from "react-native-svg";
import Screen from "@/components/Screen";
import { colors, spacing, radius } from "@/theme/colors";
import { chat as sendChat, getChatHistory } from "@/lib/api";
import { assetUrl } from "@/lib/api";
import { companionByName } from "@/lib/companions";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

function defaultNeutralPath(companionId: string): string {
  const cap = companionId.charAt(0).toUpperCase() + companionId.slice(1);
  return `assets/${cap}_Assets/${cap}_neutral.mp4`;
}

// 감정별 글로우 색상의 RGB 베이스값 (알파값은 레이어마다 다르게 조합)
const EMOTION_GLOW_RGB: Record<string, string> = {
  smile: "255,214,107",
  joy: "255,184,77",
  blush: "255,143,171",
  pout: "155,140,255",
  think: "110,201,255",
  wink: "255,143,203",
  question: "140,217,255",
};

export default function ChatScreen() {
  const { companion: companionName } = useLocalSearchParams<{
    userId: string;
    companion: string;
  }>();

  const companion = companionByName(companionName ?? "") ?? null;
  const initialPath = companion ? defaultNeutralPath(companion.id) : null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentAssetPath, setCurrentAssetPath] = useState<string | null>(initialPath);
  const [currentEmotion, setCurrentEmotion] = useState<string>("neutral");
  const [resumeKey, setResumeKey] = useState(0);
  const nextId = useRef(0);
  const listRef = useRef<FlatList>(null);

  const player = useVideoPlayer(initialPath ? assetUrl(initialPath) : null, (p) => {
    p.loop = true;
    p.play();
  });

  useEffect(() => {
    (async () => {
      try {
        const history = await getChatHistory();
        if (history.messages.length > 0) {
          setMessages(
            history.messages.map((m) => {
              nextId.current += 1;
              return {
                id: String(nextId.current),
                role: m.role === "user" ? "user" : "assistant",
                text: m.content,
              };
            })
          );
        }
        if (history.asset_path) {
          setCurrentAssetPath(history.asset_path);
        }
      } catch {
        // 기록 불러오기 실패해도 그냥 빈 화면으로 시작
      }
    })();
  }, []);

  useEffect(() => {
    if (!currentAssetPath) return;
    const url = assetUrl(currentAssetPath);
    player.replace(url);
    player.loop = currentAssetPath === initialPath;
    player.play();
  }, [currentAssetPath]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (currentAssetPath) {
          player.replace(assetUrl(currentAssetPath));
          player.loop = currentAssetPath === initialPath;
        }
        player.play();
        setResumeKey((k) => k + 1);
      }
    });
    return () => subscription.remove();
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
      setCurrentAssetPath(result.asset_path);
      setCurrentEmotion(result.emotion_tag ?? "neutral");
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Message didn't go through. (${detail})`);
    } finally {
      setSending(false);
    }
  }

  const glowRgb = EMOTION_GLOW_RGB[currentEmotion];
  const hasGlow = Boolean(glowRgb);
  const glowBoxShadow = hasGlow
    ? `0 0 10px rgba(${glowRgb}, 0.6), 0 0 20px rgba(${glowRgb}, 0.3), inset 0 0 10px rgba(${glowRgb}, 0.35)`
    : "none";
  const glowBorderColor = hasGlow ? `rgba(${glowRgb}, 0.5)` : "transparent";

  return (
    <Screen style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flexFill}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "android" ? 24 : 0}
      >
        <View style={styles.header}>
          <View
            style={[
              styles.avatarShadowHost,
              { boxShadow: glowBoxShadow },
            ]}
          >
            <View style={[styles.avatarWrap, { borderColor: glowBorderColor }]}>
              <VideoView
                key={resumeKey}
                player={player}
                style={styles.avatarMedia}
                contentFit="cover"
                nativeControls={false}
              />
              <Svg style={StyleSheet.absoluteFill} viewBox="0 0 72 72">
                <Defs>
                  <Mask id="avatarCircleMask">
                    <Rect x="0" y="0" width="72" height="72" fill="white" />
                    <Circle cx="36" cy="36" r="34" fill="black" />
                  </Mask>
                </Defs>
                <Rect
                  x="0"
                  y="0"
                  width="72"
                  height="72"
                  fill={colors.background}
                  mask="url(#avatarCircleMask)"
                />
              </Svg>
            </View>
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.name, { color: companion?.accent ?? colors.textPrimary }]}>
              {companion?.name ?? companionName ?? "Your soul friend"}
            </Text>
          </View>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
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
  avatarShadowHost: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  avatarMedia: {
    width: "100%",
    height: "100%",
  },
  headerText: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: "700",
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
