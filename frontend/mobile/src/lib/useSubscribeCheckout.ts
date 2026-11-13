import { useState } from "react";
import { Alert, Platform } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useTranslation } from "react-i18next";
import { billingApi, upsellsApi } from "./api";
import { useBillingPricing } from "./billingPricing";
import { useSubscriptionStore } from "./subscriptionStore";
import { isRevenueCatSupported, purchasePlan, type RCPlan, type RCUnavailableReason } from "./revenuecat";

type Key = "premium:monthly" | "premium:yearly" | "duo:monthly" | "duo:yearly";
type Kind = "premium" | "duo";

// Diego, 2026-10-28: on iOS this is real Apple IAP via RevenueCat
// (src/lib/revenuecat.ts) — entitlement is granted server-side by
// RevenueCat's webhook (backend/app/api/routes/billing.py's
// revenuecat_webhook), never by the client, so after a successful native
// purchase this polls GET /billing/status same as web's /premium-success
// page instead of trusting the local purchase result directly.
//
// Everywhere RevenueCat isn't usable yet — Android (no products/
// entitlements configured there), Expo Go (native module unavailable), or
// a missing/misconfigured API key — this falls back to the Stripe
// Checkout-in-browser stopgap from before. Apple 3.1.1 no longer applies
// on iOS once the RevenueCat path is live there; the fallback remains
// strictly a dev/Android convenience, not something to ship to App Review
// on iOS.
export function useSubscribeCheckout() {
  const { t } = useTranslation();
  const fetchStatus = useSubscriptionStore((s) => s.fetchStatus);
  const pricing = useBillingPricing();
  const [subscribing, setSubscribing] = useState<Key | null>(null);
  let lastUnavailableReason: RCUnavailableReason | null = null;

  // Mirrors web's /premium-success polling: a paid user must never sit on
  // stale "Free" just because RevenueCat's webhook hasn't landed yet.
  const pollUntilPremium = async (attempts = 8, delayMs = 1500) => {
    for (let i = 0; i < attempts; i++) {
      await fetchStatus();
      if (useSubscriptionStore.getState().tier === "premium") return true;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return false;
  };

  const stripeCheckoutUrl = async (kind: Kind, plan: "monthly" | "yearly"): Promise<string | undefined> => {
    if (kind === "premium") {
      const res = await billingApi.createCheckout(plan);
      return res.data?.url;
    }
    const res = await upsellsApi.checkout("family_plan", plan, "pricing_modal", {
      currency: pricing.currency === "mxn" ? "mxn" : "usd",
    });
    return res.data?.url;
  };

  const runViaStripeBrowser = async (kind: Kind, plan: "monthly" | "yearly") => {
    const url = await stripeCheckoutUrl(kind, plan);
    if (!url) throw new Error("no checkout url");
    await WebBrowser.openBrowserAsync(url);
    // Browser closed (paid, cancelled, or just dismissed) — ask Stripe
    // directly instead of waiting for the webhook, same safety net the
    // web app's /premium-success and /upsell-success pages use.
    await billingApi.syncSubscription().catch(() => {});
    await fetchStatus();
    if (kind === "duo") {
      // home.tsx shows the "add your partner's email" card itself once
      // its own status fetch sees duo_setup_pending — this just tells
      // the person where to go look for it.
      const status = await billingApi.getStatus().catch(() => null);
      if (status?.data?.duo_setup_pending) {
        Alert.alert(t("home.duo.purchasedTitle"), t("home.duo.purchasedBody"));
      }
    }
  };

  const runViaRevenueCat = async (kind: Kind, plan: "monthly" | "yearly"): Promise<"handled" | "fallback"> => {
    const rcPlan = `${kind}_${plan === "yearly" ? "annual" : "monthly"}` as RCPlan;
    const result = await purchasePlan(rcPlan);
    if (result.status === "unavailable") {
      lastUnavailableReason = result.reason;
      return "fallback"; // not configured yet (e.g. Expo Go) — let Stripe path handle it
    }
    if (result.status === "cancelled") return "handled"; // user backed out of Apple's sheet, nothing to show
    if (result.status === "error") {
      // Temporary diagnostic detail (2026-10-29, remove once Sandbox
      // purchases are confirmed working) — this is RevenueCat/StoreKit's
      // actual error message (e.g. "no active account", product not
      // found, network), not the generic "unavailable" case above.
      // purchase_timeout/restore_timeout (2026-11-09): the native call
      // never settled within our hard ceiling (see revenuecat.ts's
      // withTimeout) — surfaced like any other failure instead of leaving
      // the button spinning forever.
      Alert.alert(t("pricingModal.errorTitle"), t("pricingModal.paymentError") + ` [debug: ${result.message}]`);
      return "handled";
    }
    const got = await pollUntilPremium();
    if (!got) {
      // The Apple purchase itself succeeded (we're past purchasePlan's own
      // "ok" result) — this just means RevenueCat's webhook hasn't landed
      // yet. Never leave the screen silent here: that reads as the app
      // having frozen, which is exactly what got this build rejected.
      Alert.alert(t("pricingModal.purchaseProcessingTitle"), t("pricingModal.purchaseProcessingBody"));
      return "handled";
    }
    if (kind === "duo") {
      const status = await billingApi.getStatus().catch(() => null);
      if (status?.data?.duo_setup_pending) {
        Alert.alert(t("home.duo.purchasedTitle"), t("home.duo.purchasedBody"));
      }
    }
    return "handled";
  };

  const run = async (kind: Kind, plan: "monthly" | "yearly") => {
    const key = `${kind}:${plan}` as Key;
    if (subscribing) return;
    setSubscribing(key);
    try {
      if (isRevenueCatSupported()) {
        const outcome = await runViaRevenueCat(kind, plan);
        if (outcome === "handled") return;
        // "fallback" means RevenueCat itself isn't usable (no API key, no
        // offering/package) — never silently drop to Stripe-in-browser on
        // a real iOS build, that's the Apple 3.1.1 anti-steering violation
        // this whole integration exists to avoid. __DEV__ is false in any
        // release build (TestFlight and App Store alike), so this only
        // allows the Stripe fallback inside the Metro dev client.
        if (!__DEV__) {
          // Temporary diagnostic detail (2026-10-29, remove once Sandbox
          // purchases are confirmed working): the generic paymentError copy
          // doesn't distinguish "Apple product not ready/misconfigured"
          // from an actual payment failure, which cost a full TestFlight
          // round-trip to diagnose last time.
          const debugDetail =
            lastUnavailableReason === "no_offering" ? " [debug: no RevenueCat offering]"
            : lastUnavailableReason === "no_package" ? " [debug: package not found in offering]"
            : lastUnavailableReason === "not_configured" ? " [debug: RevenueCat SDK not configured]"
            : "";
          Alert.alert(t("pricingModal.errorTitle"), t("pricingModal.paymentError") + debugDetail);
          return;
        }
      }
      if (Platform.OS === "ios" && !__DEV__) return;
      await runViaStripeBrowser(kind, plan);
    } catch {
      Alert.alert(t("pricingModal.errorTitle"), t("pricingModal.paymentError"));
    } finally {
      setSubscribing(null);
    }
  };

  return {
    subscribe: (plan: "monthly" | "yearly") => run("premium", plan),
    subscribeDuo: (plan: "monthly" | "yearly") => run("duo", plan),
    subscribing: subscribing?.startsWith("premium:") ? (subscribing.split(":")[1] as "monthly" | "yearly") : null,
    subscribingDuo: subscribing?.startsWith("duo:") ? (subscribing.split(":")[1] as "monthly" | "yearly") : null,
  };
}
