export default {
  expo: {
    name: "Nuvos AI",
    slug: "nuvo",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/icon.png",
    userInterfaceStyle: "dark",
    scheme: "nuvo",
    splash: {
      image: "./assets/images/logo_splash.png",
      resizeMode: "contain",
      backgroundColor: "#0f1117",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.nuvosai.app",
      buildNumber: "7",
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSPhotoLibraryUsageDescription:
          "Nuvos AI necesita acceso a tu galería para que puedas subir una foto de perfil y analizar capturas de tu portafolio.",
        NSPhotoLibraryAddUsageDescription:
          "Nuvos AI puede guardar imágenes en tu galería.",
        NSUserNotificationsUsageDescription:
          "Activa las notificaciones para recibir alertas de tus posiciones, oportunidades de mercado y mensajes de tu mentor.",
        NSFaceIDUsageDescription:
          "Nuvos AI usa Face ID para que puedas iniciar sesión de forma rápida y segura sin escribir tu contraseña.",
      },
    },
    android: {
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        // Matches the new logo's own green (2026-10-18 rebrand) — sampled
        // from the icon artwork itself so the Android adaptive-icon mask's
        // fallback background never shows a visible seam against it.
        backgroundColor: "#02da82",
      },
      package: "com.nuvosai.app",
    },
    plugins: [
      "expo-router",
      [
        "expo-notifications",
        {
          icon: "./assets/notification-icon.png",
          color: "#22c55e",
          sounds: [
            "./assets/sounds/market_open.wav",
            "./assets/sounds/market_close.wav",
          ],
        },
      ],
      "expo-asset",
      "expo-font",
      "expo-secure-store",
      "expo-web-browser",
      "expo-sharing",
      "expo-splash-screen",
      "expo-status-bar",
      // Apple App Store review rejection (2026-10-20): expo-audio's default
      // NSMicrophoneUsageDescription ("Allow Nuvos AI to access your
      // microphone") was flagged as too generic — must say specifically
      // how the app uses it, with a real example. Nuvos only ever records
      // audio for two real features: a voice note to Arthur in chat
      // (app/(tabs)/chat.tsx) and a live voice call with Arthur
      // (VoiceCallModal.tsx) — never anything else, never in the
      // background without the user actively starting one of those.
      [
        "expo-audio",
        {
          microphonePermission:
            "Nuvos AI usa el micrófono para que puedas hablar con Arthur, tu mentor de inversión — por ejemplo, para enviarle un mensaje de voz en el chat o hacerle una pregunta en una llamada, sin tener que escribir.",
        },
      ],
      "expo-video",
      // Compartir captura/PDF desde la app del broker directo a Nuvos
      // (Diego, 2026-09-29). Native — only active in EAS builds, not Expo Go.
      [
        "expo-share-intent",
        {
          iosActivationRules: {
            NSExtensionActivationSupportsImageWithMaxCount: 5,
            NSExtensionActivationSupportsFileWithMaxCount: 1,
          },
          androidIntentFilters: ["image/*", "application/pdf"],
          androidMultiIntentFilters: ["image/*"],
        },
      ],
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      router: {
        origin: false,
      },
      eas: {
        projectId: "11c4956f-5fff-4fb2-9128-210b504a43b5",
      },
      posthogProjectToken: process.env.POSTHOG_PROJECT_TOKEN,
      posthogHost: process.env.POSTHOG_HOST || "https://us.i.posthog.com",
    },
  },
};
