import { useEffect } from "react";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Sentry from "@sentry/react-native";
import { OnboardingProvider } from "@/context/OnboardingContext";
import { API_BASE_URL } from "@/lib/api";

// 크래시/예외 리포팅 - 지금까지는 앱이 죽으면 테스터가 직접 캡처해서
// 보내주는 수밖에 없었음. dsn이 비어있으면 Sentry는 조용히 아무 동작도
// 안 하니, EXPO_PUBLIC_SENTRY_DSN을 안 채워둔 로컬/개발 환경에서도
// 안전하다. 반드시 컴포넌트 바깥, 모듈 최상단에서 한 번만 호출한다.
Sentry.init({
  dsn: "https://5cee4513d1b7486a966b336f49e5294e@o4511626426843136.ingest.us.sentry.io/4511626514268160",
  tracesSampleRate: 0.1,
  debug: false,
});

function RootLayout() {
  useEffect(() => {
    // Render 무료 플랜은 비활성 상태면 슬립 모드로 들어가요. 앱이 켜지는 순간
    // 미리 가벼운 요청을 보내서, 유저가 캐릭터 선택/채팅 화면에 도달할 즈음엔
    // 서버가 이미 깨어있도록 만들어요. 실패해도 무시 - 그냥 워밍업용.
    fetch(`${API_BASE_URL}/debug/personas`).catch(() => {});
  }, []);

  return (
    <SafeAreaProvider>
      <OnboardingProvider>
        <StatusBar style="light" />
        <Slot />
      </OnboardingProvider>
    </SafeAreaProvider>
  );
}

// Sentry.wrap()이 루트 컴포넌트를 감싸서, 처리되지 않은 렌더링 에러까지
// 자동으로 잡아 보고한다 (React 자체 에러 바운더리 + Sentry 통합).
export default Sentry.wrap(RootLayout);
