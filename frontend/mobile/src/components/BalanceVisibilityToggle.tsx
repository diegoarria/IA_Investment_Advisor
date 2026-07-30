import React from "react";
import { TouchableOpacity, StyleProp, ViewStyle } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useBalanceVisibilityStore } from "../lib/balanceVisibilityStore";

// Shared "eye" toggle for Home/Patrimonio/Portfolio — one preference, so
// hiding the balance on any one of those screens hides it everywhere else too.
export default function BalanceVisibilityToggle({
  color,
  size = 18,
  style,
}: {
  color: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { hidden, toggle } = useBalanceVisibilityStore();

  return (
    <TouchableOpacity onPress={toggle} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={style}>
      <Ionicons name={hidden ? "eye-off-outline" : "eye-outline"} size={size} color={color} />
    </TouchableOpacity>
  );
}
