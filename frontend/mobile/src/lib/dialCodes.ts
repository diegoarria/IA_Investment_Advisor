import type { TFunction } from "i18next";

// E.164 dial codes shared by onboarding's phone step and
// PhoneNumberPromptCard (the one-time prompt for existing users) — was
// duplicated only in app/onboarding/index.tsx; extracted here 2026-09-24
// so both use the exact same list instead of two copies drifting apart.
export function getDialCodes(t: TFunction) {
  return [
    { value: "MX", code: "+52", label: t("onboarding.countries.MX"), emoji: "🇲🇽" },
    { value: "US", code: "+1",  label: t("onboarding.countries.US"), emoji: "🇺🇸" },
    { value: "CO", code: "+57", label: t("onboarding.countries.CO"), emoji: "🇨🇴" },
    { value: "AR", code: "+54", label: t("onboarding.countries.AR"), emoji: "🇦🇷" },
    { value: "VE", code: "+58", label: t("onboarding.countries.VE"), emoji: "🇻🇪" },
    { value: "PE", code: "+51", label: t("onboarding.countries.PE"), emoji: "🇵🇪" },
    { value: "CL", code: "+56", label: t("onboarding.countries.CL"), emoji: "🇨🇱" },
    { value: "ES", code: "+34", label: t("onboarding.countries.ES"), emoji: "🇪🇸" },
  ];
}
