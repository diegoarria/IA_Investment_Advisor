# Nuvos — Data Retention and Disposal Policy

**Owner:** Diego Arria, Founder & CEO (security@nuvosai.com)
**Effective date:** September 29, 2026
**Review cadence:** every 6 months, and whenever a new data source or integration is added
**Related:** Nuvos Information Security Policy · Access Control Policy · Privacy Policy (https://www.nuvosai.com/privacy)

## 1. Purpose and scope

This policy defines how long Nuvos keeps each type of data and how that data is securely disposed of. It covers all user and consumer data processed by Nuvos, including data received from third-party aggregators (Plaid, Belvo), in production systems and in backups. It is designed to comply with applicable data privacy laws, including Mexico's federal personal data protection law (LFPDPPP) and its ARCO rights (Access, Rectification, Cancellation, Opposition).

## 2. Principles

- **Minimization.** We collect and keep only the data needed to provide the service.
- **Purpose limitation.** Data is used only for the purposes described in the Privacy Policy. We never sell user data.
- **Storage limitation.** Data is kept only as long as the purpose requires, or as long as the law requires. It is then deleted or anonymized.
- **User control.** Users can export their data, disconnect linked accounts and delete their account at any time, from inside the app.

## 3. Retention schedule

| Data category | Examples | Retention | Disposal |
|---|---|---|---|
| Account and profile | Name, email, preferences, onboarding answers | While the account is active | Deleted on account deletion |
| Portfolio and financial data | Holdings, transactions, watchlists, cash, dividends | While the account is active | Deleted on account deletion |
| Data received from Plaid / Belvo | Investment holdings, institution names | While the account is active and the connection is kept | Deleted on disconnect or account deletion |
| Third-party access tokens | Plaid / broker / bank access tokens | Until the user disconnects the account or deletes their Nuvos account | Token revoked at the provider (e.g. Plaid `/item/remove`), then deleted |
| Imported documents | Forwarded broker emails and shared screenshots/PDFs | Original files are not stored. Only the extracted data and its processing status are kept, while the account is active. | Deleted on account deletion |
| Chat history with the AI mentor | Conversations with Arthur | While the account is active, or until the user deletes the conversation | Deleted on request or on account deletion |
| Notification logs | Delivery logs of push notifications | 90 days | Automatically purged by a scheduled job |
| Usage and billing records | AI usage metering, usage-overage records | While the account is active; invoices are kept by the payment processor (Stripe) as required by tax law | Deleted on account deletion (except records we are legally required to keep) |
| Security logs | Authentication and security events | While the account is active, unless needed for an ongoing investigation | Deleted on account deletion |
| Database backups | Encrypted nightly database dumps | Up to 30 days | Automatically expired by storage lifecycle rules |

## 4. Account deletion (enforced in the product)

When a user deletes their account from **Profile → Delete my account**:

1. Every Plaid Item linked to the account is revoked at Plaid.
2. All of the user's data is deleted from every table in a single atomic database transaction: either everything is deleted or nothing is, never a partial state.
3. The user's authentication identity is deleted.
4. Remaining copies in backups expire automatically within the backup retention window (Section 3).

Data that must be kept by law (for example, tax records held by the payment processor) is kept only for the legally required period, and then deleted.

## 5. Disconnecting a linked account

When a user disconnects a broker or bank, the access token is revoked at the provider and deleted from Nuvos. Data previously imported into the user's portfolio stays until the user edits it or deletes their account, because the user explicitly confirmed it.

## 6. User rights and requests

- **Access / portability:** self-service data export from Settings.
- **Rectification:** users can edit their profile and portfolio in the app.
- **Cancellation / deletion:** self-service account deletion, or by request to legal@nuvosai.com.
- **Opposition:** notification preferences and optional features can be turned off in the app.

Requests sent by email are answered within the timeframes required by applicable law.

## 7. Secure disposal

- Production data is deleted with database deletes executed by the backend. The storage media are managed and encrypted by our cloud providers, who dispose of it according to their certified processes.
- Backups are encrypted and expire automatically.
- Nuvos keeps no physical copies of consumer data.

## 8. Review

The Owner reviews this policy at least every 6 months, checks that the retention schedule matches what the systems actually do, and records the review below.

| Date | Reviewer | Notes |
|---|---|---|
| 2026-09-29 | Diego Arria | Policy adopted |
