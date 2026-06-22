import { useEffect } from "react";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OnboardingProvider } from "@/context/OnboardingContext";
import { API_BASE_URL } from "@/lib/api";

export default function RootLayout() {
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
