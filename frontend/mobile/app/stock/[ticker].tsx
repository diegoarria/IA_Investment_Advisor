import { useLocalSearchParams } from "expo-router";
import StockDetailScreen from "../../src/components/stock/StockDetailScreen";

export default function StockPage() {
  const { ticker } = useLocalSearchParams<{ ticker: string }>();
  return <StockDetailScreen ticker={ticker ?? ""} />;
}
