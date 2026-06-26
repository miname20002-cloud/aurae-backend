// SDK 54 edge-to-edge 흰색 네비게이션 바 방어 플러그인.
//
// 1차 방어 (app.json): "androidNavigationBar": { "enforceContrast": false }
//   → SDK의 withEnforceNavigationBarContrast(config, false) 경로를 타서 설정.
//
// 2차 방어 (이 플러그인): 위 설정이 어떤 이유로 무시될 경우를 대비한 안전망.
//   withAndroidStyles를 사용하므로 styles 페이즈에서 실행되어
//   withEnforceNavigationBarContrast(true)보다 나중에 적용됨.
//
// 추가로 원하는 windowLightNavigationBar / navigationBarColor는
// SDK 언버전드 플러그인(withVersionedExpoSDKPlugins → expo-navigation-bar)이
// 우리 플러그인 이후에 실행되어 항상 제거됨 → 런타임에서 처리:
//   _layout.tsx: NavigationBar.setStyle("dark")
const { withAndroidStyles, AndroidConfig } = require("@expo/config-plugins");

module.exports = function withNavBarFix(config) {
  return withAndroidStyles(config, (config) => {
    config.modResults = AndroidConfig.Styles.assignStylesValue(config.modResults, {
      add: true,
      parent: AndroidConfig.Styles.getAppThemeGroup(),
      name: "android:enforceNavigationBarContrast",
      value: "false",
    });
    return config;
  });
};
