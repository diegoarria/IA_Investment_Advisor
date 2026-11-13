import Constants, { ExecutionEnvironment } from "expo-constants";
import { Platform } from "react-native";
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesOffering,
  type PurchasesPackage,
} from "react-native-purchases";

// Diego, 2026-10-28: Apple IAP via RevenueCat — iOS only for now (no
// Android product/entitlement setup yet, see billing.py's revenuecat_webhook
// and useSubscribeCheckout.ts for the Stripe-in-browser path this replaces
// on iOS). RevenueCat's native module requires a dev client / TestFlight
// build — it is NOT available in Expo Go, so every function here no-ops
// (or throws a clear, catchable error) outside a real iOS native build.
const REVENUECAT_IOS_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || "";

// Entitlement ids exactly as configured in the RevenueCat dashboard.
export const ENTITLEMENT_PREMIUM = "premium";
export const ENTITLEMENT_DUO = "duo";

// Package identifiers from the "default" Offering. $rc_monthly/$rc_annual
// are RevenueCat's own predefined ids (exposed as offering.monthly/.annual);
// duo_monthly/duo_annual are the custom ones Diego created.
export type RCPlan = "premium_monthly" | "premium_annual" | "duo_monthly" | "duo_annual";

let configured = false;
let configuredForUserId: string | null = null;

// Diego, 2026-11-09: App Review (submission 0c7542ae, 2026-11-06) reported
// the app "became unresponsive" right after a subscription purchase — the
// native StoreKit bridge call below has no JS-level timeout, so if it never
// settles (e.g. the IAP product wasn't fully live for review yet, see the
// 2.1(b) rejection in the same submission) the purchase button spins
// forever with zero recourse. This must never happen again: every native
// call in this file is now bounded, so the UI is guaranteed to get an
// answer no matter what StoreKit/RevenueCat does on the other end.
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export function isRevenueCatSupported(): boolean {
  // Android isn't configured in RevenueCat yet (no Google Play products/
  // entitlements) — every call below is a deliberate no-op there so the
  // existing Stripe-in-browser flow (useSubscribeCheckout.ts) keeps being
  // the real purchase path on Android until that catches up. The native
  // module also doesn't exist inside Expo Go — Purchases.configure() with a
  // real (non-test-store) key throws there, so treat Expo Go as unsupported
  // too (see dev client / TestFlight requirement in the file header).
  return Platform.OS === "ios" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
}

/** Must be called once, as early as possible (app/_layout.tsx), before any
 * login/purchase call — logIn()/purchasePackage() throw if called first. */
export function configureRevenueCat(): void {
  if (!isRevenueCatSupported() || configured) return;
  if (!REVENUECAT_IOS_API_KEY) {
    // Missing key is a config error, not a crash — every call below checks
    // `configured` and fails soft (see withConfigured below).
    console.warn("revenuecat: EXPO_PUBLIC_REVENUECAT_IOS_API_KEY not set, Apple IAP purchases are disabled");
    return;
  }
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
  Purchases.configure({ apiKey: REVENUECAT_IOS_API_KEY });
  configured = true;
}

async function withConfigured<T>(fn: () => Promise<T>): Promise<T | null> {
  if (!isRevenueCatSupported()) return null;
  if (!configured) {
    console.warn("revenuecat: not configured (missing API key or configureRevenueCat() never ran)");
    return null;
  }
  return fn();
}

/** Identifies the RevenueCat user as this app's stable Supabase Auth user
 * id — call right after login/signup succeeds AND on cold start for an
 * already-authenticated user (see app/index.tsx's afterAuth and boot
 * paths). Safe to call repeatedly with the same id (RevenueCat no-ops). */
export async function rcLogIn(supabaseUserId: string): Promise<void> {
  await withConfigured(async () => {
    if (configuredForUserId === supabaseUserId) return;
    await Purchases.logIn(supabaseUserId);
    configuredForUserId = supabaseUserId;
  });
}

/** Call on logout (see Sidebar.tsx's useLogout and profile.tsx's
 * handleLogout) — resets RevenueCat back to an anonymous id so the NEXT
 * person to log in on this device never inherits a stale identity/cache. */
export async function rcLogOut(): Promise<void> {
  await withConfigured(async () => {
    if (configuredForUserId === null) return;
    await Purchases.logOut();
    configuredForUserId = null;
  });
}

export async function getDefaultOffering(): Promise<PurchasesOffering | null> {
  return withConfigured(async () => {
    const offerings = await withTimeout(Purchases.getOfferings(), 15000, "offerings");
    return offerings.current ?? offerings.all["default"] ?? null;
  });
}

function packageForPlan(offering: PurchasesOffering, plan: RCPlan): PurchasesPackage | null {
  switch (plan) {
    case "premium_monthly": return offering.monthly;
    case "premium_annual": return offering.annual;
    case "duo_monthly": return offering.availablePackages.find((p) => p.identifier === "duo_monthly") ?? null;
    case "duo_annual": return offering.availablePackages.find((p) => p.identifier === "duo_annual") ?? null;
  }
}

export type RCUnavailableReason = "not_ios" | "not_configured" | "no_offering" | "no_package";

export type RCPurchaseResult =
  | { status: "ok"; customerInfo: CustomerInfo }
  | { status: "cancelled" }
  | { status: "unavailable"; reason: RCUnavailableReason }
  | { status: "error"; message: string };

export async function purchasePlan(plan: RCPlan): Promise<RCPurchaseResult> {
  if (!isRevenueCatSupported()) return { status: "unavailable", reason: "not_ios" };
  if (!configured) return { status: "unavailable", reason: "not_configured" };
  try {
    const offering = await getDefaultOffering();
    if (!offering) return { status: "unavailable", reason: "no_offering" };
    const pkg = packageForPlan(offering, plan);
    if (!pkg) return { status: "unavailable", reason: "no_package" };
    // 30s: generous for a native payment sheet round-trip, but still a hard
    // ceiling — this promise is otherwise fully controlled by StoreKit/the
    // RevenueCat native bridge and can hang with no JS-side signal at all.
    const result = await withTimeout(Purchases.purchasePackage(pkg), 30000, "purchase");
    return { status: "ok", customerInfo: result.customerInfo };
  } catch (e: any) {
    if (e?.userCancelled) return { status: "cancelled" };
    if (e?.message === "purchase_timeout") return { status: "error", message: "purchase_timeout" };
    return { status: "error", message: e?.message || "purchase failed" };
  }
}

export async function restorePurchases(): Promise<RCPurchaseResult> {
  if (!isRevenueCatSupported()) return { status: "unavailable", reason: "not_ios" };
  if (!configured) return { status: "unavailable", reason: "not_configured" };
  try {
    const customerInfo = await withTimeout(Purchases.restorePurchases(), 20000, "restore");
    return { status: "ok", customerInfo };
  } catch (e: any) {
    return { status: "error", message: e?.message === "restore_timeout" ? "restore_timeout" : (e?.message || "restore failed") };
  }
}

export function hasEntitlement(customerInfo: CustomerInfo, entitlement: string): boolean {
  return !!customerInfo.entitlements.active[entitlement];
}
