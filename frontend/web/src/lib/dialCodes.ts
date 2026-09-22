// E.164 dial codes shared by onboarding's phone step and
// PhoneNumberPromptCard (the one-time prompt for existing users) — was
// duplicated only in onboarding/page.tsx; extracted here 2026-09-24 so both
// use the exact same list instead of two copies drifting apart.
export const DIAL_CODES = [
  { value: "MX", code: "+52", flag: "🇲🇽", labelKey: "onboarding.countries.mx" },
  { value: "US", code: "+1",  flag: "🇺🇸", labelKey: "onboarding.countries.us" },
  { value: "CO", code: "+57", flag: "🇨🇴", labelKey: "onboarding.countries.co" },
  { value: "AR", code: "+54", flag: "🇦🇷", labelKey: "onboarding.countries.ar" },
  { value: "VE", code: "+58", flag: "🇻🇪", labelKey: "onboarding.countries.ve" },
  { value: "PE", code: "+51", flag: "🇵🇪", labelKey: "onboarding.countries.pe" },
  { value: "CL", code: "+56", flag: "🇨🇱", labelKey: "onboarding.countries.cl" },
  { value: "ES", code: "+34", flag: "🇪🇸", labelKey: "onboarding.countries.es" },
];
