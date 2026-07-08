import React, { createContext, useContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { syncApi } from "./api";
import i18n from "../i18n";

const STORAGE_KEY = "nuvos_language";

export type Language = "es" | "en";

interface LanguageCtx {
  language: Language;
  setLanguage: (l: Language) => void;
}

const LanguageContext = createContext<LanguageCtx>({
  language: "es",
  setLanguage: () => {},
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("es");

  useEffect(() => {
    (async () => {
      // 1. Apply AsyncStorage immediately — no flash on relaunch
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved === "es" || saved === "en") {
          setLanguageState(saved);
          i18n.changeLanguage(saved);
        }
      } catch {}

      // 2. Fetch from server — authoritative for cross-device sync
      try {
        const res = await syncApi.getLanguage();
        const serverLanguage: string | undefined = res.data?.language;
        if (serverLanguage === "es" || serverLanguage === "en") {
          setLanguageState(serverLanguage);
          i18n.changeLanguage(serverLanguage);
          await AsyncStorage.setItem(STORAGE_KEY, serverLanguage);
        }
      } catch {}
    })();
  }, []);

  const setLanguage = (l: Language) => {
    setLanguageState(l);
    i18n.changeLanguage(l);
    AsyncStorage.setItem(STORAGE_KEY, l).catch(() => {});
    syncApi.pushLanguage(l).catch(() => {});
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
