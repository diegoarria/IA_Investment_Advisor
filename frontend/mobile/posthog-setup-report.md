# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into the Nuvos AI Expo mobile app. The project already had the PostHog client configured (`src/config/posthog.ts`), the `PostHogProvider` wired into the root layout (`app/_layout.tsx`) with autocapture and screen tracking, and user identification (`posthog.identify`) called on login. The wizard supplemented this foundation by adding 9 new targeted events across 4 files, closing the gaps in the premium conversion funnel, notification opt-in tracking, and social/portfolio engagement.

## All instrumented events

| Event name | Description | File |
|---|---|---|
| `user_signed_up` | New account created via email/password | `app/index.tsx` |
| `user_logged_in` | Existing user logs in (email or biometric) | `app/index.tsx` |
| `onboarding_step_advanced` | User advances to the next onboarding step | `app/onboarding/index.tsx` |
| `onboarding_completed` | User finishes onboarding and investor profile is saved | `app/onboarding/index.tsx` |
| `ai_message_sent` | User sends a message to the AI mentor | `app/(tabs)/chat.tsx` |
| `ai_chat_limit_reached` | User hits the free-tier message limit | `app/(tabs)/chat.tsx` |
| `paywall_viewed` | Premium upgrade modal shown to a user | `src/components/PaywallModal.tsx` |
| `premium_upgrade_initiated` | User taps the subscribe button to start a purchase | `src/components/PaywallModal.tsx` |
| `premium_upgrade_completed` | User's tier confirmed as premium after checkout *(new)* | `src/lib/subscriptionStore.ts` |
| `portfolio_position_added` | User manually adds a stock position | `app/(tabs)/portfolio.tsx` |
| `portfolio_import_completed` | User imports portfolio via screenshot or broker connect | `app/(tabs)/portfolio.tsx` |
| `portfolio_ai_analysis_requested` | User triggers AI deep-analysis of their portfolio *(new)* | `app/(tabs)/portfolio.tsx` |
| `stress_test_run` | User runs a historical stress test scenario *(new)* | `app/(tabs)/portfolio.tsx` |
| `portfolio_position_removed` | User deletes a position from their portfolio *(new)* | `app/(tabs)/portfolio.tsx` |
| `watchlist_stock_added` | User adds a ticker to their watchlist | `app/(tabs)/watchlist.tsx` |
| `watchlist_stock_removed` | User removes a ticker from their watchlist *(new)* | `app/(tabs)/watchlist.tsx` |
| `price_alert_created` | User creates a price alert for a watchlist stock *(new)* | `app/(tabs)/watchlist.tsx` |
| `paper_trade_executed` | User buys or sells in paper trading | `app/(tabs)/paper.tsx` |
| `paper_ai_analysis_requested` | User requests AI analysis of their paper portfolio | `app/(tabs)/paper.tsx` |
| `stock_detail_viewed` | User opens a stock detail page | `src/components/stock/StockDetailScreen.tsx` |
| `notification_permission_granted` | User grants push notification permission *(new)* | `app/_layout.tsx` |
| `notification_permission_denied` | User denies push notification permission *(new)* | `app/_layout.tsx` |
| `referral_link_shared` | User shares their referral link or code *(new)* | `app/(tabs)/profile.tsx` |

## Next steps

We've built 5 insights and a dashboard for you to monitor user behavior:

- [Analytics basics (wizard) — Dashboard](https://us.posthog.com/project/487358/dashboard/1776466)
- [Premium Conversion Funnel](https://us.posthog.com/project/487358/insights/t2TiSbmJ) — paywall_viewed → premium_upgrade_initiated → premium_upgrade_completed
- [New User Signups Over Time](https://us.posthog.com/project/487358/insights/sqw3S2YG) — daily signups vs onboarding completions
- [AI Chat Daily Active Users](https://us.posthog.com/project/487358/insights/Ar5onTig) — unique users sending AI messages each day
- [Portfolio & Watchlist Activity](https://us.posthog.com/project/487358/insights/HU1G9dTG) — positions added, watchlist additions, and portfolio imports
- [Paywall Views & Upgrade Churn](https://us.posthog.com/project/487358/insights/1V4qz8XA) — users who hit the paywall vs those who initiated an upgrade

## Verify before merging

- [ ] Run a full production build (the wizard only verified the files it touched) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` to `.env.example` and any monorepo/bootstrap scripts so collaborators know what to set.
- [ ] Confirm the returning-visitor path also calls `identify` — the current implementation identifies on fresh login; verify that the session-restore path on app launch (the `checking` flow in `app/index.tsx`) also calls `posthog.identify` when a valid token is found.

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-expo/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
