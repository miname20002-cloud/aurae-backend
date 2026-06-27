import { useState, useRef, useEffect, type RefObject } from "react";
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
  Dimensions,
  Keyboard,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import Svg, { Defs, Mask, Rect, Circle, RadialGradient, Stop, Path } from "react-native-svg";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  type SharedValue,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import {
  RewardedAd,
  RewardedAdEventType,
  AdEventType,
  TestIds,
} from "react-native-google-mobile-ads";
import { useFonts } from "expo-font";
import { Fredoka_600SemiBold, Fredoka_700Bold } from "@expo-google-fonts/fredoka";
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
  watchAdBonus,
  registerPushToken,
  type ThemeInfo,
  type BonusInfo,
} from "@/lib/api";
import { companionByName } from "@/lib/companions";
import { getSession } from "@/lib/session";
import * as NavigationBar from 'expo-navigation-bar';

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  isProactive?: boolean;
};

const IDLE_EMOTIONS = ["smile", "think", "wink", "neutral", "joy"];
const IDLE_SWITCH_MS = 7500;
const REACTION_HOLD_MS = 7500;
const TOAST_HOLD_MS = 4000;
const MILESTONE_TOAST_HOLD_MS = 5000;
const LEVEL_UP_TOAST_HOLD_MS = 5000;
const THEME_UNLOCK_SEEN_KEY = "aurae_seen_theme_unlock_streak";
const USER_PHOTO_KEY = "aurae_user_photo_uri";
const COACH_MARKS_SEEN_KEY = "aurae_seen_coach_marks";
// ⚠️ 항상 테스트 광고단위로 고정해둔다. __DEV__로 분기하면 EAS preview
// 빌드(지금 테스트 중인 그 빌드)에서는 false가 돼서 진짜 광고단위가
// 활성화되는데, 본인이 직접 눌러서 테스트하면 AdMob 자기클릭(self-click)
// 정책 위반으로 계정이 정지될 수 있다.
//
// Play Store에 정식 공개 직전에만 아래 줄을 실제 광고단위ID로 바꾸거나,
// 더 안전하게는 본인 테스트폰을 AdMob 테스트기기로 등록해서(설정 -> 광고
// SDK requestConfiguration의 testDeviceIdentifiers) 진짜 ID를 쓰면서도
// 항상 테스트광고만 받게 하는 방법을 추천한다.
const AD_BONUS_UNIT_ID = TestIds.REWARDED; // TODO: 정식 출시 직전에만 "ca-app-pub-9861327921813724/2624188129"로 교체
const { height: SCREEN_HEIGHT } = Dimensions.get("window");
const INTRO_VIDEO_DURATION_MS = 10300; // intro clips are authored at exactly 10s; small buffer added
const SPARKLE_LINGER_MS = 400; // how long the sparkle burst is visible over the full-screen video before it's swapped out for the chat UI
const INTRO_FADE_OUT_MS = 600; // smooth fade duration as the intro overlay dissolves into the revealed chat UI

function emotionClipPath(companionId: string, emotion: string): string {
  const cap = companionId.charAt(0).toUpperCase() + companionId.slice(1);
  return `assets/${cap}_Assets/${cap}_${emotion}.mp4`;
}

function introClipPath(companionId: string): string {
  const cap = companionId.charAt(0).toUpperCase() + companionId.slice(1);
  return `assets/${cap}_Assets/${cap}_intro.mp4`;
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

function Gauge({
  icon,
  color,
  segments,
  filled,
  label,
}: {
  icon: string;
  color: string;
  segments: number;
  filled: number;
  label: string;
}) {
  const safeSegments = Math.max(1, Math.round(segments));
  const safeFilled = Math.max(0, Math.min(safeSegments, Math.round(filled)));
  return (
    <View style={styles.gaugeRow}>
      <View style={[styles.gaugeBadge, { backgroundColor: color }]}>
        <Text style={styles.gaugeBadgeIcon}>{icon}</Text>
      </View>
      <View style={styles.gaugeTrack}>
        {Array.from({ length: safeSegments }, (_, i) => {
          const isFilled = i < safeFilled;
          const isLastFilled = isFilled && i === safeFilled - 1;
          return (
            <View
              key={i}
              style={[
                styles.gaugeSegment,
                isFilled && { backgroundColor: color },
                isLastFilled && [styles.gaugeSegmentGlow, { shadowColor: color }],
              ]}
            />
          );
        })}
      </View>
      <Text style={styles.gaugeLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function coachBubbleTailDownPath(w: number, h: number): string {
  return `M${w * 0.06},${h * 0.34} Q${w * 0.0},${h * 0.18} ${w * 0.16},${h * 0.08} Q${w * 0.3},${h * -0.02} ${w * 0.46},${h * 0.05} Q${w * 0.6},${h * -0.03} ${w * 0.74},${h * 0.06} Q${w * 0.9},${h * 0.0} ${w * 0.96},${h * 0.16} Q${w * 1.02},${h * 0.32} ${w * 0.94},${h * 0.46} Q${w * 1.0},${h * 0.6} ${w * 0.92},${h * 0.72} Q${w * 0.98},${h * 0.84} ${w * 0.8},${h * 0.88} L${w * 0.58},${h * 0.9} L${w * 0.5},${h * 1.06} L${w * 0.42},${h * 0.9} L${w * 0.2},${h * 0.9} Q${w * 0.04},${h * 0.86} ${w * 0.02},${h * 0.7} Q${w * -0.04},${h * 0.55} ${w * 0.02},${h * 0.42} Q${w * -0.02},${h * 0.36} ${w * 0.06},${h * 0.34} Z`;
}

function coachBubbleTailUpPath(w: number, h: number): string {
  return `M${w * 0.06},${h * 0.66} Q${w * 0.0},${h * 0.82} ${w * 0.16},${h * 0.92} Q${w * 0.3},${h * 1.02} ${w * 0.46},${h * 0.95} Q${w * 0.6},${h * 1.03} ${w * 0.74},${h * 0.94} Q${w * 0.9},${h * 1.0} ${w * 0.96},${h * 0.84} Q${w * 1.02},${h * 0.68} ${w * 0.94},${h * 0.54} Q${w * 1.0},${h * 0.4} ${w * 0.92},${h * 0.28} Q${w * 0.98},${h * 0.16} ${w * 0.8},${h * 0.12} L${w * 0.58},${h * 0.1} L${w * 0.5},${h * -0.06} L${w * 0.42},${h * 0.1} L${w * 0.2},${h * 0.1} Q${w * 0.04},${h * 0.14} ${w * 0.02},${h * 0.3} Q${w * -0.04},${h * 0.45} ${w * 0.02},${h * 0.58} Q${w * -0.02},${h * 0.64} ${w * 0.06},${h * 0.66} Z`;
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
  const [adBonusOffer, setAdBonusOffer] = useState(false);
  const [watchingAd, setWatchingAd] = useState(false);
  const [adReady, setAdReady] = useState(false);
  const rewardedAdRef = useRef(RewardedAd.createForAdRequest(AD_BONUS_UNIT_ID));
  const [idleIdx, setIdleIdx] = useState(0);
  const [activeIsA, setActiveIsA] = useState(true);
  const [reactionPath, setReactionPath] = useState<string | null>(null);
  const [resumeKey, setResumeKey] = useState(0);
  const [userName, setUserName] = useState<string | null>(null);
  const [userPhotoUri, setUserPhotoUri] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [showIntroOverlay, setShowIntroOverlay] = useState(false);
  const [showFullscreenClip, setShowFullscreenClip] = useState(false);
  const fullscreenPlayer = useVideoPlayer(null, (p) => {
    p.loop = false;
  });
  const nextId = useRef(0);
  const greetingTried = useRef(false);
  const listRef = useRef<FlatList>(null);

  const [currentStreak, setCurrentStreak] = useState(0);
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [activeThemeId, setActiveThemeId] = useState("default");
  const [showThemeModal, setShowThemeModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [bonusToast, setBonusToast] = useState<BonusInfo | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [seenThemeStreak, setSeenThemeStreak] = useState(0);
  const [unseenThemeCount, setUnseenThemeCount] = useState(0);
  const [milestoneToast, setMilestoneToast] = useState<{ streakDay: number; themeName: string | null } | null>(null);
  const milestoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paletteScale = useSharedValue(1);

  const [relationshipLevel, setRelationshipLevel] = useState(1);
  const [relationshipLevelName, setRelationshipLevelName] = useState("Just Met");
  const [relationshipProgressPct, setRelationshipProgressPct] = useState(0);
  const [levelUpToast, setLevelUpToast] = useState<{ newLevel: number; levelName: string } | null>(null);
  const levelUpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [streakPrevMilestone, setStreakPrevMilestone] = useState(0);
  const [streakNextMilestone, setStreakNextMilestone] = useState<number | null>(3);

  const [coachStep, setCoachStep] = useState(0);
  const [coachTarget, setCoachTarget] = useState<{ x: number; y: number; width: number; height: number } | null>(
    null
  );
  const [bubbleContentSize, setBubbleContentSize] = useState({ width: 0, height: 0 });
  const avatarWrapRef = useRef<View>(null);
  const gaugeStackRef = useRef<View>(null);
  const inputRowRef = useRef<View>(null);
  const userAvatarRef = useRef<View>(null);
  const firstBubbleRef = useRef<View>(null);

  const [fontsLoaded] = useFonts({ Fredoka_600SemiBold, Fredoka_700Bold });

  function measureCoachTarget(ref: RefObject<View | null>) {
    ref.current?.measureInWindow((x, y, width, height) => {
      if (width === 0 && height === 0) {
        requestAnimationFrame(() => {
          ref.current?.measureInWindow((x2, y2, w2, h2) => setCoachTarget({ x: x2, y: y2, width: w2, height: h2 }));
        });
      } else {
        setCoachTarget({ x, y, width, height });
      }
    });
  }

  useEffect(() => {
    if (coachStep === 1) measureCoachTarget(avatarWrapRef);
    else if (coachStep === 2) measureCoachTarget(gaugeStackRef);
    else if (coachStep === 3) measureCoachTarget(inputRowRef);
    else if (coachStep === 4) measureCoachTarget(userAvatarRef);
    else if (coachStep === 5) measureCoachTarget(firstBubbleRef);
  }, [coachStep]);

  useEffect(() => {
    if (coachStep === 0) return;
    const timer = setTimeout(() => {
      if (!coachTarget) advanceCoachMarks();
    }, 900);
    return () => clearTimeout(timer);
  }, [coachStep, coachTarget]);

  function startCoachMarksIfFirstTime() {
    AsyncStorage.getItem(COACH_MARKS_SEEN_KEY)
      .then((seen) => {
        if (!seen) {
          setTimeout(() => setCoachStep(1), 400);
        }
      })
      .catch(() => {});
  }

  function dismissCoachMarks() {
    setCoachStep(0);
    setCoachTarget(null);
    AsyncStorage.setItem(COACH_MARKS_SEEN_KEY, "true").catch(() => {});
  }

  function advanceCoachMarks() {
    if (coachStep < coachSteps.length) {
      setCoachStep((s) => s + 1);
    } else {
      dismissCoachMarks();
    }
  }

  function replayCoachMarks() {
    setShowSettingsModal(false);
    setCoachStep(1);
  }

  const activeTheme = themes.find((t) => t.id === activeThemeId);
  const bgColor = activeTheme?.bg ?? colors.background;
  const assistantBubbleColor = activeTheme?.bubble_assistant ?? colors.surface;
  const userGlowColor = complementaryColor(companion?.accent ?? "#7C8CFF");

  const coachSteps = [
    { text: "tap me anytime to replay my intro 🎬", color: companion?.accent ?? "#8B7CF6" },
    { text: "💗 relationship & 🔥 streak — keep these glowing every day", color: "#FF8FAB" },
    { text: "say anything, I'm listening 👂", color: colors.accent },
    { text: "add your photo so it feels more like you 📸", color: userGlowColor },
    { text: "long press any message to share it 📤", color: "#39E6FF" },
  ];

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

  const introFlashOpacity = useSharedValue(0);
  const introFlashScale = useSharedValue(0.4);
  const sparkleProgress = useSharedValue(0);
  const introOverlayOpacity = useSharedValue(0);
  const introOverlayAnimatedStyle = useAnimatedStyle(() => ({
    opacity: introOverlayOpacity.value,
  }));

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
    if (showIntroOverlay || showFullscreenClip) {
      StatusBar.setHidden(true, "fade");
      NavigationBar.setVisibilityAsync('hidden');
    } else {
      StatusBar.setHidden(false, "fade");
      StatusBar.setBarStyle("light-content", true);
      StatusBar.setBackgroundColor(bgColor, true);
      NavigationBar.setVisibilityAsync('visible');
      NavigationBar.setBackgroundColorAsync(bgColor);
    }
  }, [showIntroOverlay, showFullscreenClip, bgColor]);

  useEffect(() => {
  const hideSub = Keyboard.addListener("keyboardDidHide", () => {
    if (!showIntroOverlay && !showFullscreenClip) {
      NavigationBar.setBackgroundColorAsync(bgColor);
    }
  });
  const showSub = Keyboard.addListener("keyboardDidShow", () => {
    if (!showIntroOverlay && !showFullscreenClip) {
      NavigationBar.setBackgroundColorAsync(bgColor);
    }
  });
  return () => {
    hideSub.remove();
    showSub.remove();
  };
}, [bgColor, showIntroOverlay, showFullscreenClip]);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (session) setUserName(session.name);
      const savedPhoto = await AsyncStorage.getItem(USER_PHOTO_KEY);
      if (savedPhoto) setUserPhotoUri(savedPhoto);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== "granted") return;

        const tokenData = await Notifications.getExpoPushTokenAsync();
        await registerPushToken(tokenData.data);
      } catch {
        // 시뮬레이터/iOS Expo Go 등에서 실패해도 무시
      }
    })();
  }, []);

  useEffect(() => {
    const ad = rewardedAdRef.current;

    const unsubLoaded = ad.addAdEventListener(RewardedAdEventType.LOADED, () => {
      setAdReady(true);
    });
    const unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
      try {
        await watchAdBonus();
        setAdBonusOffer(false);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        setError(`Couldn't grant the bonus right now. (${detail})`);
      }
    });
    const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      setWatchingAd(false);
      setAdReady(false);
      ad.load();
    });
    const unsubError = ad.addAdEventListener(AdEventType.ERROR, () => {
      setWatchingAd(false);
      setAdReady(false);
    });

    ad.load();

    return () => {
      unsubLoaded();
      unsubEarned();
      unsubClosed();
      unsubError();
    };
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
        if (typeof state.prev_milestone === "number") setStreakPrevMilestone(state.prev_milestone);
        if (state.next_milestone !== undefined) setStreakNextMilestone(state.next_milestone);
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

  useEffect(() => {
    introPlayer.pause();
    fullscreenPlayer.pause();
  }, []);

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
    const subscription = fullscreenPlayer.addListener("playToEnd", () => {
      setShowFullscreenClip(false);
    });
    return () => subscription.remove();
  }, [fullscreenPlayer]);

  useEffect(() => {
    (async () => {
      try {
        const history = await getChatHistory();
        if (history.relationship_level) setRelationshipLevel(history.relationship_level);
        if (history.relationship_level_name) setRelationshipLevelName(history.relationship_level_name);
        if (typeof history.relationship_progress_pct === "number") {
          setRelationshipProgressPct(history.relationship_progress_pct);
        }

        if (history.messages.length > 0) {
          setMessages(
            history.messages.map((m) => {
              nextId.current += 1;
              return {
                id: String(nextId.current),
                role: m.role === "user" ? "user" : "assistant",
                text: m.content,
                isProactive: m.is_proactive,
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
          greetingTried.current = true;

          try {
            const { status: permStatus } = await Notifications.getPermissionsAsync();
            if (permStatus === "undetermined") {
              await Notifications.requestPermissionsAsync();
            }
          } catch {
            // 시뮬레이터 등 실패해도 인트로는 정상 진행
          }

          setShowIntroOverlay(true);
          introOverlayOpacity.value = 1;

          if (companion) {
            introPlayer.replace(assetUrl(introClipPath(companion.id)));
            introPlayer.play();
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
          }

          const greetingPromise = getGreeting();
          greetingPromise.catch(() => {});

          setTimeout(async () => {
            try {
              const greeting = await greetingPromise;
              if (greeting.relationship_level) setRelationshipLevel(greeting.relationship_level);
              if (greeting.relationship_level_name) setRelationshipLevelName(greeting.relationship_level_name);
              if (typeof greeting.relationship_progress_pct === "number") {
                setRelationshipProgressPct(greeting.relationship_progress_pct);
              }

              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              setTimeout(() => {
                introOverlayOpacity.value = withTiming(0, {
                  duration: INTRO_FADE_OUT_MS,
                  easing: Easing.out(Easing.ease),
                });
                nextId.current += 1;
                setMessages([{ id: String(nextId.current), role: "assistant", text: greeting.reply }]);
                setTimeout(() => {
                  introPlayer.pause();
                  setShowIntroOverlay(false);
                  setInitializing(false);
                  startCoachMarksIfFirstTime();
                }, INTRO_FADE_OUT_MS);
              }, SPARKLE_LINGER_MS);
            } catch {
              introPlayer.pause();
              introOverlayOpacity.value = 0;
              setShowIntroOverlay(false);
              setInitializing(false);
              startCoachMarksIfFirstTime();
            }
          }, INTRO_VIDEO_DURATION_MS);
        } else {
          setInitializing(false);
        }
      } catch {
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

  useEffect(() => {
    if (!messages.some((m) => m.isProactive)) return;
    const timeout = setTimeout(() => {
      setMessages((prev) => prev.map((m) => (m.isProactive ? { ...m, isProactive: false } : m)));
    }, 4000);
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
    setAdBonusOffer(false);
    addMessage("user", text);
    setSending(true);

    try {
      const result = await sendChat({ message: text });
      addMessage("assistant", result.reply);
      getActive().replace(assetUrl(result.asset_path));
      getActive().play();
      setReactionPath(result.asset_path);
      setTimeout(() => setReactionPath(null), REACTION_HOLD_MS);

      if (result.limit_reached && result.ad_bonus_eligible) {
        setAdBonusOffer(true);
      }

      if (typeof result.relationship_level === "number") {
        setRelationshipLevel(result.relationship_level);
      }
      if (typeof result.relationship_progress_pct === "number") {
        setRelationshipProgressPct(result.relationship_progress_pct);
      }
      if (result.relationship_level_up) {
        setRelationshipLevelName(result.relationship_level_up.level_name);
        showLevelUpToast(result.relationship_level_up.new_level, result.relationship_level_up.level_name);
      }

      if (result.streak) {
        setCurrentStreak(result.streak.current_streak);
        if (typeof result.streak.prev_milestone === "number") {
          setStreakPrevMilestone(result.streak.prev_milestone);
        }
        if (result.streak.next_milestone !== undefined) {
          setStreakNextMilestone(result.streak.next_milestone);
        }

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

  function handleWatchAdBonus() {
    if (!adReady) {
      setError("Ad isn't ready yet - give it a few seconds and try again.");
      return;
    }
    setError(null);
    setWatchingAd(true);
    rewardedAdRef.current.show();
  }

  const currentEmotion = reactionPath ? emotionFromPath(reactionPath) : IDLE_EMOTIONS[idleIdx];
  const glowRgb = EMOTION_GLOW_RGB[currentEmotion] || EMOTION_GLOW_RGB["neutral"];
  const hasGlow = Boolean(glowRgb);
  const glowColor = `rgb(${glowRgb})`;

  return (
    <Screen style={{ ...styles.container, backgroundColor: bgColor }}>
      {showIntroOverlay && (
        <Animated.View style={[styles.introOverlay, introOverlayAnimatedStyle]}>
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
        </Animated.View>
      )}

      {showFullscreenClip && (
        <View style={styles.fullscreenClipOverlay}>
          <VideoView
            player={fullscreenPlayer}
            style={styles.fullscreenClipVideo}
            contentFit="contain"
            nativeControls={false}
          />
          <Pressable
            onPress={() => {
              fullscreenPlayer.pause();
              setShowFullscreenClip(false);
            }}
            style={styles.fullscreenClipSkipButton}
            hitSlop={16}
          >
            <Text style={styles.fullscreenClipSkipText}>Skip ✕</Text>
          </Pressable>
        </View>
      )}

      {coachStep > 0 && coachTarget && (
        <View style={styles.coachOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={advanceCoachMarks} />
          <View
            style={[
              styles.coachHighlight,
              {
                left: coachTarget.x - 6,
                top: coachTarget.y - 6,
                width: coachTarget.width + 12,
                height: coachTarget.height + 12,
                borderRadius:
                  coachStep === 1 || coachStep === 4 ? (Math.max(coachTarget.width, coachTarget.height) + 12) / 2 : 14,
                borderColor: coachSteps[coachStep - 1].color,
                shadowColor: coachSteps[coachStep - 1].color,
              },
            ]}
            pointerEvents="none"
          />
          <View
            style={[
              styles.coachBubble,
              coachTarget.y + coachTarget.height / 2 > SCREEN_HEIGHT * 0.55
                ? { top: Math.max(70, coachTarget.y - 140) }
                : { top: coachTarget.y + coachTarget.height + 24 },
            ]}
            pointerEvents="none"
          >
            {bubbleContentSize.width > 0 && (
              <Svg
                width={bubbleContentSize.width + 24 + 56}
                height={bubbleContentSize.height + 24 + 56}
                viewBox={`-28 -28 ${bubbleContentSize.width + 24 + 56} ${bubbleContentSize.height + 24 + 56}`}
                style={styles.coachBubbleSvg}
              >
                <Path
                  d={
                    coachTarget.y + coachTarget.height / 2 > SCREEN_HEIGHT * 0.55
                      ? coachBubbleTailDownPath(bubbleContentSize.width + 24, bubbleContentSize.height + 24)
                      : coachBubbleTailUpPath(bubbleContentSize.width + 24, bubbleContentSize.height + 24)
                  }
                  fill="#FFFFFF"
                  stroke="#8B7CF6"
                  strokeWidth={5}
                  strokeLinejoin="round"
                />
              </Svg>
            )}
            <View
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                if (Math.abs(width - bubbleContentSize.width) > 1 || Math.abs(height - bubbleContentSize.height) > 1) {
                  setBubbleContentSize({ width, height });
                }
              }}
              style={styles.coachBubbleContent}
            >
              <Text
                style={[styles.coachBubbleText, fontsLoaded && { fontFamily: "Fredoka_700Bold" }]}
              >
                {coachSteps[coachStep - 1].text}
              </Text>
              <View style={styles.coachDots}>
                {coachSteps.map((step, i) => (
                  <View
                    key={i}
                    style={[
                      styles.coachDot,
                      i === coachStep - 1 && [styles.coachDotActive, { backgroundColor: step.color }],
                    ]}
                  />
                ))}
              </View>
            </View>
          </View>
          <Pressable onPress={dismissCoachMarks} style={styles.coachSkip} hitSlop={12}>
            <Text style={[styles.coachSkipText, fontsLoaded && { fontFamily: "Fredoka_600SemiBold" }]}>skip</Text>
          </Pressable>
          <Text
            style={[styles.coachTapHint, fontsLoaded && { fontFamily: "Fredoka_600SemiBold" }]}
            pointerEvents="none"
          >
            tap anywhere to continue
          </Text>
        </View>
      )}

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

        {!showIntroOverlay && !showFullscreenClip && (
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

              <Pressable
                ref={avatarWrapRef}
                onPress={() => {
                  if (!companion) return;
                  fullscreenPlayer.replace(assetUrl(introClipPath(companion.id)));
                  fullscreenPlayer.play();
                  setShowFullscreenClip(true);
                }}
                style={styles.avatarWrap}
              >
                {companion?.facePath && (
                  <Image
                    source={{ uri: assetUrl(companion.facePath) }}
                    style={styles.avatarMedia}
                    resizeMode="cover"
                  />
                )}
                <VideoView
                  key={`a-${resumeKey}`}
                  player={playerA}
                  style={[styles.avatarMedia, StyleSheet.absoluteFill, { opacity: activeIsA ? 1 : 0 }]}
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
              </Pressable>
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
            <View style={styles.centerRow}>
              <View style={styles.gaugeStack} ref={gaugeStackRef}>
                <Gauge
                  icon="♥"
                  color="#FF8FAB"
                  segments={3}
                  filled={Math.round((relationshipProgressPct / 100) * 3)}
                  label={`Lv.${relationshipLevel}`}
                />
                <Gauge
                  icon="🔥"
                  color="#FFB84D"
                  segments={
                    streakNextMilestone != null ? streakNextMilestone - streakPrevMilestone : 1
                  }
                  filled={
                    streakNextMilestone != null
                      ? currentStreak - streakPrevMilestone
                      : 1
                  }
                  label={`${currentStreak}`}
                />
              </View>
            </View>
          </View>

          <View style={styles.headerSide}>
            <Pressable onPress={handlePickUserPhoto} style={styles.userAvatarStack} ref={userAvatarRef}>
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
        )}

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item, index }) => (
            <Pressable
              ref={index === 0 ? firstBubbleRef : undefined}
              onLongPress={() => handleShareBubble(item.text)}
              style={[
                styles.bubble,
                item.role === "user"
                  ? [
                      styles.bubbleUser,
                      companion?.accent && { backgroundColor: hexToRgba(companion.accent, 0.22) },
                    ]
                  : [styles.bubbleAssistant, { backgroundColor: assistantBubbleColor }],
                item.isProactive && [
                  styles.bubbleProactive,
                  { borderColor: companion?.accent ?? colors.accent, shadowColor: companion?.accent ?? colors.accent },
                ],
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

        {adBonusOffer && (
          <Pressable
            onPress={handleWatchAdBonus}
            disabled={watchingAd || !adReady}
            style={({ pressed }) => [
              styles.adBonusButton,
              (!adReady || watchingAd) && styles.adBonusButtonDisabled,
              pressed && adReady && styles.adBonusButtonPressed,
            ]}
          >
            {watchingAd ? (
              <ActivityIndicator color={colors.background} />
            ) : (
              <Text style={styles.adBonusButtonText}>
                {adReady ? "📺 Watch an ad for +3 messages" : "Loading ad..."}
              </Text>
            )}
          </Pressable>
        )}

        <View style={styles.inputRow} ref={inputRowRef}>
          <Pressable onPress={() => setShowSettingsModal(true)} style={styles.settingsButtonInputRow}>
            <Animated.View style={unseenThemeCount > 0 ? paletteAnimatedStyle : undefined}>
              <Text style={styles.settingsButtonText}>⚙️</Text>
            </Animated.View>
            {unseenThemeCount > 0 && (
              <View style={styles.themeBadgeDot}>
                <Text style={styles.themeBadgeText}>{unseenThemeCount}</Text>
              </View>
            )}
          </Pressable>
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

      <Modal visible={showSettingsModal} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowSettingsModal(false)}>
          <View style={styles.modalCard} onStartShouldSetResponder={() => true}>
            <Text style={styles.modalTitle}>Settings</Text>
            <Pressable
              style={styles.settingsRow}
              onPress={() => {
                setShowSettingsModal(false);
                handleOpenThemeModal();
              }}
            >
              <Text style={styles.settingsRowIcon}>🎨</Text>
              <Text style={styles.settingsRowText}>Chat Theme</Text>
              <Text style={styles.settingsRowChevron}>›</Text>
            </Pressable>
            <Pressable style={[styles.settingsRow, styles.settingsRowLast]} onPress={replayCoachMarks}>
              <Text style={styles.settingsRowIcon}>❓</Text>
              <Text style={styles.settingsRowText}>Replay Tips</Text>
              <Text style={styles.settingsRowChevron}>›</Text>
            </Pressable>
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
    elevation: 200,
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
  fullscreenClipOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 199,
    elevation: 199,
    backgroundColor: "#000000",
    alignItems: "center",
    justifyContent: "center",
  },
  fullscreenClipVideo: {
    width: "100%",
    height: "100%",
  },
  fullscreenClipHint: {
    position: "absolute",
    bottom: 40,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  fullscreenClipHintText: {
    color: "#999999",
    fontSize: 12,
    fontStyle: "italic",
  },
  fullscreenClipSkipButton: {
    position: "absolute",
    top: 80,
    right: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    zIndex: 250,
  },
  fullscreenClipSkipText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },
  coachOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.72)",
    zIndex: 300,
  },
  coachHighlight: {
    position: "absolute",
    borderWidth: 3,
    borderColor: "#FFD76B",
    shadowColor: "#FFD76B",
    shadowOpacity: 0.9,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  coachBubble: {
    position: "absolute",
    left: 24,
    right: 24,
    alignItems: "center",
  },
  coachBubbleSvg: {
    position: "absolute",
    top: -40,
    left: -40,
  },
  coachBubbleContent: {
    paddingVertical: 20,
    paddingHorizontal: 22,
  },
  coachBubbleText: {
    color: "#241B33",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 24,
    letterSpacing: 0.2,
  },
  coachDots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: 12,
  },
  coachDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: "rgba(26,16,20,0.25)",
  },
  coachDotActive: {
    backgroundColor: "#1A1014",
  },
  coachSkip: {
    position: "absolute",
    top: 54,
    right: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  coachSkipText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  coachTapHint: {
    position: "absolute",
    bottom: 36,
    left: 0,
    right: 0,
    textAlign: "center",
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
    fontStyle: "italic",
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
    paddingTop: 40,
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
    bottom: 10,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  userPhotoHintText: {
    fontSize: 15,
  },
  centerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  gaugeStack: {
    gap: 10,
  },
  gaugeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  gaugeBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginRight: -9,
    zIndex: 2,
    borderWidth: 2,
    borderColor: colors.background,
  },
  gaugeBadgeIcon: {
    fontSize: 14,
    color: "#1A1014",
  },
  gaugeTrack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: 17,
    paddingRight: 7,
  },
  gaugeSegment: {
    width: 10,
    height: 16,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  gaugeSegmentGlow: {
    shadowOpacity: 0.95,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  gaugeLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  settingsButtonInline: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    position: "relative",
  },
  settingsButtonInputRow: {
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginRight: 4,
    position: "relative",
  },
  settingsButtonText: {
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
  bubbleProactive: {
    borderWidth: 2,
    shadowOpacity: 0.65,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
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
  adBonusButton: {
    backgroundColor: colors.accent,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    alignItems: "center",
  },
  adBonusButtonPressed: {
    backgroundColor: colors.accentDark,
  },
  adBonusButtonDisabled: {
    opacity: 0.5,
  },
  adBonusButtonText: {
    color: colors.background,
    fontSize: 14,
    fontWeight: "700",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
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
  settingsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingsRowLast: {
    borderBottomWidth: 0,
  },
  settingsRowIcon: {
    fontSize: 18,
  },
  settingsRowText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  settingsRowChevron: {
    color: colors.textTertiary,
    fontSize: 18,
  },
});