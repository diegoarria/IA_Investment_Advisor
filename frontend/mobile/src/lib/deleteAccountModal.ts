import { create } from "zustand";

// Single global instance (mounted once in app/_layout.tsx) so Sidebar's and
// Profile's "Eliminar mi cuenta" buttons both open the exact same modal
// instead of each maintaining their own copy — see paywallModalGuard.ts for
// why RN can't safely have two native <Modal>s racing to present at once.
type DeleteAccountModalState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

export const useDeleteAccountModal = create<DeleteAccountModalState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
