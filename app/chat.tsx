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
  StatusBar,
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
import { getSession } from "@/lib/session";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const IDLE_EMOTIONS = ["smile", "think", "wink", "neutral", "joy"];
const IDLE_SWITCH_MS = 7500;
const REACTION_HOLD_MS = 7500;

function emotionClipPath(companionId: string, emotion: string): string {
  const cap = companionId.charAt(0).toUpperCase() + companionId.slice(1);
  return `assets/${cap}_Assets/${cap}_${emotion}.mp4`;
}

function emotionFromPath(path: string | null): string {
  if (!path) return "neutral";
  const match = path.match(/_(\w+)\.mp4$/);
  return match ? match[1] : "neutral";
}

function hexToRgba(hex: string, alpha: number): string {
  const sanitized = hex.replace("#", "");
  const bigint = parseInt(sanitized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
  const [idleIdx, setIdleIdx] = useState(0);
  const [activeIsA, setActiveIsA] = useState(true);
  const [reactionPath, setReactionPath] = useState<string | null>(null);
  const [resumeKey, setResumeKey] = useState(0);
  const [userName, setUserName] = useState<string | null>(null);
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

  // 안드로이드에서 영상 플레이어가 상태바를 숨겨버리는 경우가 있어서,
  // 주기적으로 강제로 다시 보이게 함 (방어적 우회)
  useEffect(() => {
    const interval = setInterval(() => {
      StatusBar.setHidden(false, "none");
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (session) setUserName(session.name);
    })();
  }, []);

  const playerA = useVideoPlayer(null, (p) => {
    p.loop = false;
  });
  const playerB = useVideoPlayer(null, (p) => {
    p.loop = false;
  });

  function getActive() {
    return activeIsA ? playerA : playerB;
  }
  function getHidden() {
    return activeIsA ? playerB : playerA;
  }

  useEffect(() => {
    if (!companion) return;
    playerA.replace(assetUrl(emotionClipPath(companion.id, IDLE_EMOTIONS[0])));
    playerA.play();
    playerB.replace(assetUrl(emotionClipPath(companion.id, IDLE_EMOTIONS[1 % IDLE_EMOTIONS.length])));
    playerB.pause();
  }, [companion]);

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
          getActive().replace(assetUrl(history.asset_path));
          getActive().play();
          setReactionPath(history.asset_path);
          setTimeout(() => setReactionPath(null), REACTION_HOLD_MS);
        }
      } catch {
        // 기록 불러오기 실패해도 빈 화면으로 시작
      }
    })();
  }, []);

  useEffect(() => {
    if (reactionPath || !companion) return;
    const timer = setTimeout(() => {
      const nextIdx = (idleIdx + 1) % IDLE_EMOTIONS.length;
      const bufferedIdx = (idleIdx + 2) % IDLE_EMOTIONS.length;

      const newActiveIsA = !activeIsA;
      getHidden().play();
      setActiveIsA(newActiveIsA);
      setIdleIdx(nextIdx);

      const stale = activeIsA ? playerA : playerB;
      stale.replace(assetUrl(emotionClipPath(companion.id, IDLE_EMOTIONS[bufferedIdx])));
      stale.pause();
    }, IDLE_SWITCH_MS);
    return () => clearTimeout(timer);
  }, [idleIdx, activeIsA, reactionPath, companion]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        getActive().play();
        setResumeKey((k) => k + 1);
      }
    });
    return () => subscription.remove();
  });

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
      getActive().replace(assetUrl(result.asset_path));
      getActive().play();
      setReactionPath(result.asset_path);
      setTimeout(() => setReactionPath(null), REACTION_HOLD_MS);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setError(`Message didn't go through. (${detail})`);
    } finally {
      setSending(false);
    }
  }

  const currentEmotion = reactionPath ? emotionFromPath(reactionPath) : IDLE_EMOTIONS[idleIdx];
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
                key={`a-${resumeKey}`}
                player={playerA}
                style={[styles.avatarMedia, { opacity: activeIsA ? 1 : 0 }]}
                contentFit="cover"
                nativeControls={false}
              />
              <VideoView
                key={`b-${resumeKey}`}
                player={playerB}
                style={[styles.avatarMedia, StyleSheet.absoluteFill, { opacity: activeIsA ? 0 : 1 }]}
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

          {userName && <Text style={styles.userName}>{userName}</Text>}
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
            style={[
              styles.input,
              companion?.accent && { borderColor: hexToRgba(companion.accent, 0.5) },
            ]}
            editable={!sending}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          {sending ? (
            <ActivityIndicator color={companion?.accent ?? colors.accent} style={styles.sendButton} />
          ) : (
            <Pressable onPress={handleSend} style={styles.sendButton}>
              <Text style={[styles.sendText, { color: companion?.accent ?? colors.accent }]}>Send</Text>
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
  userName: {
    fontSize: 13,
    color: colors.textTertiary,
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
    fontWeight: "700",
    fontSize: 15,
  },
});