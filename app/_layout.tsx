import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { OnboardingProvider } from "@/context/OnboardingContext";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <OnboardingProvider>
        <StatusBar style="light" />
        <Slot />
      </OnboardingProvider>
    </SafeAreaProvider>
  );
}
