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
import Svg, { Defs, Mask, Rect, Circle, RadialGradient, Stop } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
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

// question.mp4는 음성이 들어있어서 평상시 로테이션에서는 제외 - 첫 채팅 응답에서만
// (백엔드에서 그 이후엔 재사용 안 되게 막아줌) 등장할 수 있음
const IDLE_EMOTIONS = ["smile", "think", "wink", "neutral", "joy"];

function emotionClipPath(companionId: string, emotion: string): string {
  const cap = companionId.charAt(0).toUpperCase() + companionId.slice(1);
  return `assets/${cap}_Assets/${cap}_${emotion}.mp4`;
}

function emotionFromPath(path: string | null): string {
  if (!path) return "neutral";
  const match = path.match(/_(\w+)\.mp4$/);
  return match ? match[1] : "neutral";
}

const EMOTION_GLOW_RGB: Record<string, string> = {
  neutral: "0, 242, 254",
  think: "0, 242, 254",
  smile: "255, 214, 107",
  joy: "255, 184, 77",
  blush: "255, 143, 171",
  pout: "155, 140, 255",
  wink: "255, 143, 203",
  question: "140, 217, 255",
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
  const [error, setError] = useState<string | null>(null);
  const [idleIndex, setIdleIndex] = useState(0);
  const [currentAssetPath, setCurrentAssetPath] = useState<string | null>(
    companion ? emotionClipPath(companion.id, IDLE_EMOTIONS[0]) : null
  );
  const [resumeKey, setResumeKey] = useState(0);
  const nextId = useRef(0);
  const listRef = useRef<FlatList>(null);

  const breath = useSharedValue(0.4);
  useEffect(() => {
    breath.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);
  const animatedGlowStyle = useAnimatedStyle(() => ({
    opacity: breath.value,
  }));

  const player = useVideoPlayer(currentAssetPath ? assetUrl(currentAssetPath) : null, (p) => {
    p.loop = false;
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
        // 기록 불러오기 실패해도 빈 화면으로 시작
      }
    })();
  }, []);

  useEffect(() => {
    if (!currentAssetPath) return;
    player.replace(assetUrl(currentAssetPath));
    player.loop = false;
    player.play();
  }, [currentAssetPath]);

  // 타이머 기반으로 다음 표정 전환 - playToEnd 네이티브 이벤트보다 안정적
  // (영상 ~5초 재생 + 마지막 프레임에서 잠깐 정지 후 다음 표정으로)
  useEffect(() => {
    if (!currentAssetPath || !companion) return;
    const timer = setTimeout(() => {
      const nextIdx = (idleIndex + 1) % IDLE_EMOTIONS.length;
      setIdleIndex(nextIdx);
      setCurrentAssetPath(emotionClipPath(companion.id, IDLE_EMOTIONS[nextIdx]));
    }, 7500);
    return () => clearTimeout(timer);
  }, [currentAssetPath]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (currentAssetPath) {
          player.replace(assetUrl(currentAssetPath));
          player.loop = false;
        }
        player.play();
        setResumeKey((k) => k + 1);
      }
    });
    return () => subscription.remove();
  }, [currentAssetPath]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 100);
    return () => clearTimeout(timeout);
  }, [messages]);

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
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Message didn't go through. (${detail})`);
    } finally {
      setSending(false);
    }
  }

  const currentEmotion = emotionFromPath(currentAssetPath);
  const glowRgb = EMOTION_GLOW_RGB[currentEmotion] || EMOTION_GLOW_RGB["neutral"];
  const hasGlow = Boolean(glowRgb);
  const glowColor = `rgb(${glowRgb})`;

  return (
    <Screen style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flexFill}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "android" ? 24 : 0}
      >
        <View style={styles.header}>
          <View style={styles.avatarStack}>
            <Animated.View style={[styles.glowSvgWrap, animatedGlowStyle]} pointerEvents="none">
              <Svg width={104} height={104} viewBox="0 0 104 104">
                <Defs>
                  <RadialGradient id="glowGradient" cx="52" cy="52" r="52" gradientUnits="userSpaceOnUse">
                    <Stop offset="0%" stopColor={glowColor} stopOpacity={hasGlow ? 0.9 : 0} />
                    <Stop offset="65%" stopColor={glowColor} stopOpacity={hasGlow ? 0.45 : 0} />
                    <Stop offset="100%" stopColor={glowColor} stopOpacity={0} />
                  </RadialGradient>
                </Defs>
                <Circle cx="52" cy="52" r="52" fill="url(#glowGradient)" />
              </Svg>
            </Animated.View>

            <View style={styles.avatarWrap}>
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
    paddingLeft: spacing.xs,
    paddingRight: spacing.lg,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatarStack: {
    width: 104,
    height: 104,
    alignItems: "center",
    justifyContent: "center",
  },
  glowSvgWrap: {
    position: "absolute",
    width: 104,
    height: 104,
  },
  avatarWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
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