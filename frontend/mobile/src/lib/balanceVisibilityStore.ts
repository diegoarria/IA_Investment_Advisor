import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

// One shared "eye" toggle for Home/Patrimonio/Portfolio — hiding the balance
// on any one of those screens hides it everywhere else too. A device
// preference, not per-account data, so it isn't user-scoped like profile/
// portfolio/subscription state.

interface BalanceVisibilityState {
  hidden: boolean;
  toggle: () => void;
}

export const useBalanceVisibilityStore = create<BalanceVisibilityState>()(
  persist(
    (set, get) => ({
      hidden: false,
      toggle: () => set({ hidden: !get().hidden }),
    }),
    { name: "balance-visibility-store", storage: createJSONStorage(() => AsyncStorage) }
  )
);
