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
  Share,
  Modal,
  Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import Svg, { Defs, Mask, Rect, Circle, RadialGradient, Stop } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  type SharedValue,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Screen from "@/components/Screen";
import { colors, spacing, radius } from "@/theme/colors";
import { chat as sendChat, getChatHistory, getGreeting } from "@/lib/api";
import { assetUrl } from "@/lib/api";
import {
  getRewardsState,
  getThemes,
  setChatTheme,
  sendShare,
  type ThemeInfo,
  type BonusInfo,
} from "@/lib/api";
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
const TOAST_HOLD_MS = 4000;
const MILESTONE_TOAST_HOLD_MS = 5000;
const LEVEL_UP_TOAST_HOLD_MS = 5000;
const THEME_UNLOCK_SEEN_KEY = "aurae_seen_theme_unlock_streak";
const USER_PHOTO_KEY = "aurae_user_photo_uri";
const INTRO_VIDEO_DURATION_MS = 10300; // intro clips are authored at exactly 10s; small buffer added
const SPARKLE_LINGER_MS = 400; // how long the sparkle burst is visible over the full-screen video before it's swapped out for the chat UI

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

function computeUnseenCount(themesList: ThemeInfo[], seenStreak: number): number {
  return themesList.filter((t) => t.unlocked && t.unlock_streak > seenStreak).length;
}

function complementaryColor(hex: string): string {
  const sanitized = hex.replace("#", "");
  const r = parseInt(sanitized.substring(0, 2), 16) / 255;
  const g = parseInt(sanitized.substring(2, 4), 16) / 255;
  const b = parseInt(sanitized.substring(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }

  // rotate hue 180 degrees for the complementary color
  h = (h + 0.5) % 1;

  function hue2rgb(p: number, q: number, t: number) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  let r2: number, g2: number, b2: number;
  if (s === 0) {
    r2 = g2 = b2 = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r2 = hue2rgb(p, q, h + 1 / 3);
    g2 = hue2rgb(p, q, h);
    b2 = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(r2)}${toHex(g2)}${toHex(b2)}`;
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

const SPARKLE_COLORS = ["#FFD76B", "#FF8FAB", "#8CD9FF", "#FFE9B0"];
const SPARKLE_COUNT = 8;
const SPARKLE_RADIUS = 64;

function Sparkle({
  progress,
  angle,
  color,
  radius = SPARKLE_RADIUS,
  size = 8,
}: {
  progress: SharedValue<number>;
  angle: number;
  color: string;
  radius?: number;
  size?: number;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const dist = p * radius;
    const opacity = p < 0.12 ? p / 0.12 : Math.max(0, 1 - (p - 0.12) / 0.88);
    return {
      opacity,
      transform: [
        { translateX: Math.cos(angle) * dist },
        { translateY: Math.sin(angle) * dist },
        { scale: 0.5 + p * 0.7 },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        styles.sparkle,
        animatedStyle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          marginLeft: -size / 2,
          marginTop: -size / 2,
          backgroundColor: color,
        },
      ]}
      pointerEvents="none"
    />
  );
}

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
  const [userPhotoUri, setUserPhotoUri] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [showIntroOverlay, setShowIntroOverlay] = useState(false);
  const nextId = useRef(0);
  const greetingTried = useRef(false);
  const listRef = useRef<FlatList>(null);

  // --- reward sprint 1 state ---
  const [currentStreak, setCurrentStreak] = useState(0);
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [activeThemeId, setActiveThemeId] = useState("default");
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [bonusToast, setBonusToast] = useState<BonusInfo | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- theme unlock discoverability (badge + pulse + haptic + toast) ---
  const [seenThemeStreak, setSeenThemeStreak] = useState(0);
  const [unseenThemeCount, setUnseenThemeCount] = useState(0);
  const [milestoneToast, setMilestoneToast] = useState<{ streakDay: number; themeName: string | null } | null>(null);
  const milestoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paletteScale = useSharedValue(1);

  // --- relationship level (badge + level-up toast) ---
  const [relationshipLevel, setRelationshipLevel] = useState(1);
  const [relationshipLevelName, setRelationshipLevelName] = useState("Just Met");
  const [levelUpToast, setLevelUpToast] = useState<{ newLevel: number; levelName: string } | null>(null);
  const levelUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeTheme = themes.find((t) => t.id === activeThemeId);
  const bgColor = activeTheme?.bg ?? colors.background;
  const assistantBubbleColor = activeTheme?.bubble_assistant ?? colors.surface;
  const userGlowColor = complementaryColor(companion?.accent ?? "#7C8CFF");

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

  // --- intro video entrance/exit flourish (flash burst + sparkle burst) ---
  const introFlashOpacity = useSharedValue(0);
  const introFlashScale = useSharedValue(0.4);
  const sparkleProgress = useSharedValue(0);

  const introFlashStyle = useAnimatedStyle(() => ({
    opacity: introFlashOpacity.value,
    transform: [{ scale: introFlashScale.value }],
  }));

  function triggerIntroFlash() {
    introFlashScale.value = 0.4;
    introFlashOpacity.value = 0.85;
    introFlashScale.value = withTiming(1.8, { duration: 650, easing: Easing.out(Easing.ease) });
    introFlashOpacity.value = withTiming(0, { duration: 650, easing: Easing.out(Easing.ease) });
  }

  function triggerSparkleBurst() {
    sparkleProgress.value = 0;
    sparkleProgress.value = withTiming(1, { duration: 750, easing: Easing.out(Easing.cubic) });
  }

  useEffect(() => {
    if (unseenThemeCount > 0) {
      paletteScale.value = withRepeat(
        withTiming(1.3, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        -1,
        true
      );
    } else {
      paletteScale.value = withTiming(1, { duration: 200 });
    }
  }, [unseenThemeCount]);
  const paletteAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: paletteScale.value }],
  }));

  useEffect(() => {
    const interval = setInterval(() => {
      StatusBar.setHidden(false, "none");
      StatusBar.setBarStyle("light-content", true); 
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (session) setUserName(session.name);
      const savedPhoto = await AsyncStorage.getItem(USER_PHOTO_KEY);
      if (savedPhoto) setUserPhotoUri(savedPhoto);
    })();
  }, []);

  async function handlePickUserPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Photo access is needed to set your picture.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      const uri = result.assets[0].uri;
      setUserPhotoUri(uri);
      AsyncStorage.setItem(USER_PHOTO_KEY, uri).catch(() => {});
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const [state, themeData] = await Promise.all([getRewardsState(), getThemes()]);
        setCurrentStreak(state.current_streak);
        setActiveThemeId(themeData.active_theme);
        setThemes(themeData.themes);

        const seenRaw = await AsyncStorage.getItem(THEME_UNLOCK_SEEN_KEY);
        const seenStreak = seenRaw ? parseInt(seenRaw, 10) : 0;
        setSeenThemeStreak(seenStreak);
        setUnseenThemeCount(computeUnseenCount(themeData.themes, seenStreak));
      } catch {
        // 리워드 상태 로딩 실패해도 채팅 자체는 막지 않음
      }
    })();
  }, []);

  function showBonusToast(bonus: BonusInfo) {
    setBonusToast(bonus);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setBonusToast(null), TOAST_HOLD_MS);
  }

  function showMilestoneToast(streakDay: number, unlockedThemes: ThemeInfo[]) {
    const matched = unlockedThemes.find((t) => t.unlock_streak === streakDay);
    setMilestoneToast({ streakDay, themeName: matched?.name ?? null });
    if (milestoneTimer.current) clearTimeout(milestoneTimer.current);
    milestoneTimer.current = setTimeout(() => setMilestoneToast(null), MILESTONE_TOAST_HOLD_MS);
  }

  function showLevelUpToast(newLevel: number, levelName: string) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setLevelUpToast({ newLevel, levelName });
    if (levelUpTimer.current) clearTimeout(levelUpTimer.current);
    levelUpTimer.current = setTimeout(() => setLevelUpToast(null), LEVEL_UP_TOAST_HOLD_MS);
  }

  async function handleOpenThemeModal() {
    setShowThemeModal(true);
    if (unseenThemeCount > 0) {
      const maxUnlocked = themes.reduce((max, t) => (t.unlocked ? Math.max(max, t.unlock_streak) : max), 0);
      setSeenThemeStreak(maxUnlocked);
      setUnseenThemeCount(0);
      AsyncStorage.setItem(THEME_UNLOCK_SEEN_KEY, String(maxUnlocked)).catch(() => {});
    }
  }

  async function handleSelectTheme(theme: ThemeInfo) {
    if (!theme.unlocked) return;
    try {
      await setChatTheme(theme.id);
      setActiveThemeId(theme.id);
      setShowThemeModal(false);
    } catch {
      setError("Couldn't change theme right now.");
    }
  }

  async function handleShareBubble(text: string) {
    try {
      await Share.share({
        message: `"${text}"\n\n— ${companion?.name ?? "my Aurae companion"} 💬\n\ntalking to my AI bestie on Aurae`,
      });
      await sendShare("chat_bubble");
    } catch {
      // 공유 시트 취소/실패는 조용히 무시
    }
  }

  const playerA = useVideoPlayer(null, (p) => {
    p.loop = false;
  });
  const playerB = useVideoPlayer(null, (p) => {
    p.loop = false;
  });
  const introPlayer = useVideoPlayer(null, (p) => {
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
        if (history.relationship_level) setRelationshipLevel(history.relationship_level);
        if (history.relationship_level_name) setRelationshipLevelName(history.relationship_level_name);

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
          if (history.asset_path) {
            getActive().replace(assetUrl(history.asset_path));
            getActive().play();
            setReactionPath(history.asset_path);
            setTimeout(() => setReactionPath(null), REACTION_HOLD_MS);
          }
          setInitializing(false);
        } else if (!greetingTried.current) {
          // 진짜 첫 만남 - 캐릭터가 먼저 인사하게.
          // 인사 API 응답을 기다리는 동안 평소 채팅화면이 잠깐 보였다가
          // 오버레이로 덮이면 어색하니, 첫 만남이라는 걸 아는 즉시(API 응답
          // 전부터) 오버레이를 먼저 띄워서 평소 화면이 한 프레임도 안
          // 보이게 한다.
          greetingTried.current = true;
          setShowIntroOverlay(true);
          try {
            const greeting = await getGreeting();
            if (greeting.relationship_level) setRelationshipLevel(greeting.relationship_level);
            if (greeting.relationship_level_name) setRelationshipLevelName(greeting.relationship_level_name);

            // 인사 영상(Chloe_intro.mp4 등)은 시선을 집중시키는 한 번뿐인
            // 연출이라, 작은 아바타가 아니라 채팅창 전체를 덮는 오버레이로
            // 보여준다. 끝날 때까지 메시지 말풍선과 입력창도 같이 묻어둔다.
            introPlayer.replace(assetUrl(greeting.asset_path));
            introPlayer.play();
            setShowIntroOverlay(true);
            triggerIntroFlash();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

            // expo-video의 "재생 끝남" 이벤트에 의존하지 않고, 인트로
            // 영상이 정확히 10초로 만들어졌다는 걸 알고 있으니 그 시간만큼
            // 타이머로 직접 기다린다 - 이벤트 유무/버전 차이에 좌우되지 않는
            // 가장 확실한 방법.
            setTimeout(() => {
              triggerSparkleBurst();
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              // 스파클이 영상 위에서 잠깐 보인 다음에 오버레이를 내리고
              // 채팅 화면(이미 작은 아바타는 평소 idle 상태)을 드러낸다.
              setTimeout(() => {
                setShowIntroOverlay(false);
                nextId.current += 1;
                setMessages([{ id: String(nextId.current), role: "assistant", text: greeting.reply }]);
                setInitializing(false);
              }, SPARKLE_LINGER_MS);
            }, INTRO_VIDEO_DURATION_MS);
          } catch {
            // 인사 실패해도 빈 화면으로 시작 (치명적이지 않음) - 오버레이를
            // 띄워둔 채로 멈춰있으면 안 되니 반드시 내려준다.
            setShowIntroOverlay(false);
            setInitializing(false);
          }
        } else {
          setInitializing(false);
        }
      } catch {
        // 기록 불러오기 실패해도 빈 화면으로 시작
        setInitializing(false);
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
    if (!text || sending || initializing) return;

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

      if (typeof result.relationship_level === "number") {
        setRelationshipLevel(result.relationship_level);
      }
      if (result.relationship_level_up) {
        setRelationshipLevelName(result.relationship_level_up.level_name);
        showLevelUpToast(result.relationship_level_up.new_level, result.relationship_level_up.level_name);
      }

      if (result.streak) {
        setCurrentStreak(result.streak.current_streak);

        if (result.streak.milestone_hit) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          try {
            const updated = await getThemes();
            setThemes(updated.themes);
            setActiveThemeId(updated.active_theme);
            setUnseenThemeCount(computeUnseenCount(updated.themes, seenThemeStreak));
            showMilestoneToast(result.streak.milestone_hit, updated.themes);
          } catch {
            showMilestoneToast(result.streak.milestone_hit, themes);
          }
        }
      }
      if (result.bonus) {
        showBonusToast(result.bonus);
      }
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
    <Screen style={{ ...styles.container, backgroundColor: bgColor }}>
      <View
        style={[styles.introOverlay, { opacity: showIntroOverlay ? 1 : 0 }]}
        pointerEvents={showIntroOverlay ? "auto" : "none"}
      >
        <VideoView
          player={introPlayer}
          style={styles.introOverlayVideo}
          contentFit="cover"
          nativeControls={false}
        />
        <Animated.View style={[styles.introOverlayFlash, introFlashStyle]} pointerEvents="none" />
        <View style={styles.introOverlaySparkleLayer} pointerEvents="none">
          {Array.from({ length: SPARKLE_COUNT }, (_, i) => (
            <Sparkle
              key={i}
              progress={sparkleProgress}
              angle={(i / SPARKLE_COUNT) * Math.PI * 2}
              color={SPARKLE_COLORS[i % SPARKLE_COLORS.length]}
              radius={140}
              size={14}
            />
          ))}
        </View>
      </View>
      <KeyboardAvoidingView
        style={styles.flexFill}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "android" ? 24 : 0}
      >
        {(milestoneToast || levelUpToast || bonusToast) && (
          <View style={styles.toastWrap} pointerEvents="none">
            <View style={styles.toast}>
              {milestoneToast ? (
                <>
                  <Text style={styles.toastText}>
                    🎉 Day {milestoneToast.streakDay} streak!
                    {milestoneToast.themeName ? ` "${milestoneToast.themeName}" theme unlocked` : ""}
                  </Text>
                  <Text style={styles.toastPoints}>tap 🎨 to try it</Text>
                </>
              ) : levelUpToast ? (
                <>
                  <Text style={styles.toastText}>
                    💗 Level up! Lv.{levelUpToast.newLevel} — {levelUpToast.levelName}
                  </Text>
                  <Text style={styles.toastPoints}>{companion?.name ?? "they"} feel closer to you now</Text>
                </>
              ) : bonusToast ? (
                <>
                  <Text style={styles.toastText}>{bonusToast.text}</Text>
                  <Text style={styles.toastPoints}>+{bonusToast.reward_points_earned} pts</Text>
                </>
              ) : null}
            </View>
          </View>
        )}

        <View style={styles.header}>
          <View style={styles.headerSide}>
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
            <Text
              style={[styles.sideName, { color: companion?.accent ?? colors.textPrimary }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {companion?.name ?? companionName ?? "Friend"}
            </Text>
          </View>

          <View style={styles.headerCenter}>
            <View style={styles.statsRow}>
              {relationshipLevel > 0 && <Text style={styles.levelText}>💗{relationshipLevel}</Text>}
              {currentStreak > 0 && <Text style={styles.streakText}>🔥{currentStreak}</Text>}
              <Pressable onPress={handleOpenThemeModal} style={styles.themeButtonInline}>
                <Animated.View style={unseenThemeCount > 0 ? paletteAnimatedStyle : undefined}>
                  <Text style={styles.themeButtonText}>🎨</Text>
                </Animated.View>
                {unseenThemeCount > 0 && (
                  <View style={styles.themeBadgeDot}>
                    <Text style={styles.themeBadgeText}>{unseenThemeCount}</Text>
                  </View>
                )}
              </Pressable>
            </View>
          </View>

          <View style={styles.headerSide}>
            <Pressable onPress={handlePickUserPhoto} style={styles.userAvatarStack}>
              <Animated.View style={[styles.glowSvgWrap, animatedGlowStyle]} pointerEvents="none">
                <Svg width={104} height={104} viewBox="0 0 104 104">
                  <Defs>
                    <RadialGradient id="userGlowGradient" cx="52" cy="52" r="52" gradientUnits="userSpaceOnUse">
                      <Stop offset="0%" stopColor={userGlowColor} stopOpacity={0.9} />
                      <Stop offset="65%" stopColor={userGlowColor} stopOpacity={0.45} />
                      <Stop offset="100%" stopColor={userGlowColor} stopOpacity={0} />
                    </RadialGradient>
                  </Defs>
                  <Circle cx="52" cy="52" r="52" fill="url(#userGlowGradient)" />
                </Svg>
              </Animated.View>
              <View style={styles.userAvatarCircle}>
                {userPhotoUri ? (
                  <Image source={{ uri: userPhotoUri }} style={styles.userAvatarImage} />
                ) : (
                  <Text style={styles.userAvatarInitial}>{(userName ?? "?").charAt(0)}</Text>
                )}
              </View>
              {!userPhotoUri && (
                <View style={styles.userPhotoHint}>
                  <Text style={styles.userPhotoHintText}>📷</Text>
                </View>
              )}
            </Pressable>
            {userName && (
              <Text style={styles.sideName} numberOfLines={1} ellipsizeMode="tail">
                {userName}
              </Text>
            )}
          </View>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <Pressable
              onLongPress={() => handleShareBubble(item.text)}
              style={[
                styles.bubble,
                item.role === "user"
                  ? [
                      styles.bubbleUser,
                      companion?.accent && { backgroundColor: hexToRgba(companion.accent, 0.22) },
                    ]
                  : [styles.bubbleAssistant, { backgroundColor: assistantBubbleColor }],
              ]}
            >
              <Text style={item.role === "user" ? styles.bubbleTextUser : styles.bubbleTextAssistant}>
                {item.text}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            initializing ? (
              <Animated.View style={[styles.typingBubble, animatedGlowStyle]}>
                <Text style={styles.typingText}>
                  {companion?.name ?? "Chloe"} is typing...
                </Text>
              </Animated.View>
            ) : (
              <Text style={styles.emptyState}>Say hey to start the conversation.</Text>
            )
          }
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <View style={styles.inputRow}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={initializing ? "Chloe is getting ready..." : "say something"}
            placeholderTextColor={colors.textTertiary}
            style={[
              styles.input,
              companion?.accent && { borderColor: hexToRgba(companion.accent, 0.5) },
            ]}
            editable={!sending && !initializing}
            onSubmitEditing={handleSend}
            returnKeyType="send"
          />
          {sending || initializing ? (
            <ActivityIndicator color={companion?.accent ?? colors.accent} style={styles.sendButton} />
          ) : (
            <Pressable onPress={handleSend} style={styles.sendButton}>
              <Text style={[styles.sendText, { color: companion?.accent ?? colors.accent }]}>Send</Text>
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      <Modal visible={showThemeModal} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowThemeModal(false)}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Chat Theme</Text>
            {themes.map((theme) => (
              <Pressable
                key={theme.id}
                onPress={() => handleSelectTheme(theme)}
                style={[
                  styles.themeRow,
                  theme.id === activeThemeId && styles.themeRowActive,
                  !theme.unlocked && styles.themeRowLocked,
                ]}
              >
                <View style={[styles.themeSwatch, { backgroundColor: theme.bg }]} />
                <Text style={[styles.themeRowText, !theme.unlocked && styles.themeRowTextLocked]}>
                  {theme.name}
                </Text>
                {!theme.unlocked && (
                  <Text style={styles.themeLockNote}>🔒 Day {theme.unlock_streak}</Text>
                )}
                {theme.id === activeThemeId && <Text style={styles.themeCheck}>✓</Text>}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flexFill: {
    flex: 1,
  },
  introOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 200,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  introOverlayVideo: {
    width: "100%",
    height: "100%",
  },
  introOverlayFlash: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#FFEFC9",
  },
  introOverlaySparkleLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerSide: {
    alignItems: "center",
    width: 104,
  },
  sideName: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
    textAlign: "center",
    color: colors.textPrimary,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
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
  introFlash: {
    position: "absolute",
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: "#FFEFC9",
  },
  sparkleLayer: {
    position: "absolute",
    width: 104,
    height: 104,
    alignItems: "center",
    justifyContent: "center",
  },
  sparkle: {
    position: "absolute",
  },
  userAvatarStack: {
    width: 104,
    height: 104,
    alignItems: "center",
    justifyContent: "center",
  },
  userAvatarCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  userAvatarInitial: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  userAvatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 36,
  },
  userPhotoHint: {
    position: "absolute",
    bottom: 14,
    right: 12,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  userPhotoHintText: {
    fontSize: 11,
  },
  statsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  levelText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FF8FAB",
  },
  streakText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFB84D",
  },
  themeButtonInline: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    position: "relative",
  },
  themeButtonText: {
    fontSize: 18,
  },
  themeBadgeDot: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: "#FF5C5C",
    alignItems: "center",
    justifyContent: "center",
  },
  themeBadgeText: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "700",
  },
  toastWrap: {
    position: "absolute",
    top: 162,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 50,
  },
  toast: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    maxWidth: "85%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 184, 77, 0.4)",
  },
  toastText: {
    color: colors.textPrimary,
    fontSize: 13,
    textAlign: "center",
  },
  toastPoints: {
    color: "#FFB84D",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
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
  typingBubble: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xl,
  },
  typingText: {
    color: colors.textTertiary,
    fontSize: 13,
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
    color: colors.textPrimary,
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalCard: {
    width: "85%",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.lg,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  themeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  themeRowActive: {
    opacity: 1,
  },
  themeRowLocked: {
    opacity: 0.45,
  },
  themeSwatch: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  themeRowText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
  },
  themeRowTextLocked: {
    color: colors.textTertiary,
  },
  themeLockNote: {
    fontSize: 11,
    color: colors.textTertiary,
  },
  themeCheck: {
    color: colors.accent,
    fontWeight: "700",
  },
});
