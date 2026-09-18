// Dynamic config so the web build can be exported under a sub-path
// (e.g. GitHub Pages project sites) without touching local dev/native builds.
// Set EXPO_WEB_BASE_URL only for the "export --platform web" CI step.
const baseUrl = process.env.EXPO_WEB_BASE_URL ?? '';

module.exports = {
  expo: {
    name: 'QubitOS',
    slug: 'qubit-os',
    owner: 'he-ro1112',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.hero.qubitos',
    },
    android: {
      package: 'com.hero.qubitos',
      adaptiveIcon: {
        backgroundColor: '#0b0f17',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    backgroundColor: '#0b0f17',
    experiments: baseUrl ? { baseUrl } : undefined,
    extra: {
      eas: {
        projectId: 'b9696af5-c0ac-4560-a612-524dd576447f',
      },
    },
  },
};
