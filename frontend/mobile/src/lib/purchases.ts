import { Platform } from "react-native";
import Purchases, {
  PurchasesPackage,
  CustomerInfo,
  LOG_LEVEL,
} from "react-native-purchases";

// RevenueCat API keys — swap for real keys from app.revenuecat.com
const RC_API_KEY_IOS     = "appl_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";
const RC_API_KEY_ANDROID = "goog_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

export const ENTITLEMENT_PREMIUM = "premium";

// Product IDs must match what you create in App Store Connect
export const PRODUCT_MONTHLY = "com.nuvosai.app.premium.monthly";
export const PRODUCT_YEARLY  = "com.nuvosai.app.premium.yearly";

export function initRevenueCat(userId?: string) {
  const apiKey = Platform.OS === "ios" ? RC_API_KEY_IOS : RC_API_KEY_ANDROID;
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
  Purchases.configure({ apiKey });
  if (userId) Purchases.logIn(userId);
}

export async function identifyUser(userId: string) {
  try {
    await Purchases.logIn(userId);
  } catch {}
}

export async function getOfferings() {
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current;
  } catch {
    return null;
  }
}

export async function purchasePackage(pkg: PurchasesPackage): Promise<boolean> {
  try {
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return isPremium(customerInfo);
  } catch (e: any) {
    // userCancelled is not a real error
    if (e?.userCancelled) return false;
    throw e;
  }
}

export async function restorePurchases(): Promise<boolean> {
  try {
    const customerInfo = await Purchases.restorePurchases();
    return isPremium(customerInfo);
  } catch {
    return false;
  }
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  try {
    return await Purchases.getCustomerInfo();
  } catch {
    return null;
  }
}

export function isPremium(customerInfo: CustomerInfo): boolean {
  return customerInfo.entitlements.active[ENTITLEMENT_PREMIUM] !== undefined;
}
