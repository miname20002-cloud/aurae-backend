// SDK 54 known bug workaround (expo/expo#43741):
// app.json의 androidNavigationBar 필드가 스키마에서 거부되면서
// prebuild 시 enforceNavigationBarContrast가 항상 true로 생성됨.
// 이 플러그인이 styles.xml을 직접 패치해서 false로 강제 설정함.
// setStyle("dark")가 실제 효과를 내려면 이 값이 false여야 함.
const { withAndroidStyles } = require("@expo/config-plugins");

module.exports = function withNavBarFix(config) {
  return withAndroidStyles(config, (config) => {
    const appTheme = config.modResults.resources.style?.find(
      (s) => s.$?.name === "AppTheme"
    );
    if (appTheme) {
      appTheme.item = appTheme.item ?? [];
      const already = appTheme.item.find(
        (i) => i.$?.name === "android:enforceNavigationBarContrast"
      );
      if (!already) {
        appTheme.item.push({
          $: { name: "android:enforceNavigationBarContrast" },
          _: "false",
        });
      }
    }
    return config;
  });
};
