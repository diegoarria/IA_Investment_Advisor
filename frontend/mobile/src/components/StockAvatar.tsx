import React, { useState } from "react";
import { Image, View, Text, StyleSheet } from "react-native";

interface Props {
  ticker: string;
  logoUrl?: string | null;
  size?: number;
}

export default function StockAvatar({ ticker, logoUrl, size = 40 }: Props) {
  const initials = ticker.slice(0, 2).toUpperCase();
  const clean = ticker.replace(".", "-");

  const sources = [
    ...(logoUrl ? [logoUrl] : []),
    `https://assets.parqet.com/logos/symbol/${clean}?format=svg`,
    `https://financialmodelingprep.com/image-stock/${clean}.png`,
  ];

  const [failedCount, setFailedCount] = useState(0);
  const activeSrc = failedCount < sources.length ? sources[failedCount] : null;

  const radius = size / 2;

  if (activeSrc) {
    return (
      <View style={[s.imgWrap, { width: size, height: size, borderRadius: radius }]}>
        <Image
          source={{ uri: activeSrc }}
          style={[s.img, { width: size - 8, height: size - 8 }]}
          resizeMode="contain"
          onError={() => setFailedCount((c) => c + 1)}
        />
      </View>
    );
  }

  return (
    <View style={[s.fallback, { width: size, height: size, borderRadius: radius }]}>
      <Text style={[s.initials, { fontSize: size * 0.32 }]}>{initials}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  imgWrap: {
    backgroundColor: "#0e1628",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#152034",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  img: {
    borderRadius: 4,
  },
  fallback: {
    backgroundColor: "rgba(0,168,94,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: "#00d47e",
    fontWeight: "800",
  },
});
