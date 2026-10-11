import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Nuvos AI",
  description: "How Nuvos AI collects, uses, and protects your personal information.",
};

export default function PrivacyPageEn() {
  return (
    <main className="h-screen overflow-y-auto bg-[#07080f] text-white">
      <div className="max-w-3xl mx-auto px-6 py-16">

        {/* Header */}
        <div className="mb-12">
          <p className="text-[#22c55e] text-sm font-semibold tracking-widest uppercase mb-3">Legal</p>
          <h1 className="text-4xl font-black tracking-tight mb-2">Privacy Policy</h1>
          <p className="text-white/40 text-sm">Nuvos AI · Full Notice</p>
          <p className="text-white/30 text-xs mt-1">Last updated: September 22, 2026</p>
        </div>

        <div className="mb-10 p-4 rounded-xl border border-[#22c55e]/20 bg-[#22c55e]/05 text-sm text-white/80">
          This Privacy Policy explains how Nuvos AI collects, uses, stores, protects, and, when
          applicable, shares information related to its users. Looking for the Spanish version?
          Visit{" "}
          <a href="/privacy" className="text-[#22c55e] underline hover:opacity-80">Aviso de
          Privacidad</a>.
        </div>

        <div className="space-y-10 text-white/70 leading-relaxed">

          <section>
            <h2 className="text-white text-xl font-bold mb-3">1. Data Controller</h2>
            <p className="text-sm">
              <strong className="text-white">Data controller:</strong> D.A. Holdings S.A. de C.V.<br />
              <strong className="text-white">Address:</strong> C. Washington 1400, Centro, 64000 Monterrey, N.L., Mexico<br />
              <strong className="text-white">Privacy email:</strong> legal@nuvosai.com
            </p>
            <p className="text-sm mt-3">
              Nuvos AI may use technology providers to deliver certain services, but those
              providers will process information according to their role and the corresponding
              agreements in place.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">2. What data we collect</h2>
            <p className="text-sm mb-3">Depending on the features you use, we may process:</p>
            <div className="space-y-4">
              <div>
                <h3 className="text-white/90 font-semibold mb-1">Account data</h3>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>Email address and name</li>
                  <li>Password or credentials managed through authentication providers</li>
                  <li>User identifiers, preferences, and account settings</li>
                </ul>
              </div>
              <div>
                <h3 className="text-white/90 font-semibold mb-1">Data you provide voluntarily</h3>
                <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
                  <li>Date of birth, country, and city</li>
                  <li>Occupation and approximate income</li>
                  <li>Financial experience and investing knowledge</li>
                  <li>Financial goals, time horizon, and preferences</li>
                  <li>Questionnaire answers (risk tolerance, onboarding)</li>
                  <li>Profile photo (optional)</li>
                  <li>Information contained in conversations with Arthur</li>
                  <li>Documents you choose to upload</li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">3. Financial and net worth information</h2>
            <p className="text-sm mb-2">
              Depending on the features you use, Nuvos may process information related to:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>portfolios</li>
              <li>instruments</li>
              <li>positions</li>
              <li>amounts and prices</li>
              <li>transactions</li>
              <li>balances</li>
              <li>operations</li>
              <li>net worth goals</li>
              <li>financial information you provide directly</li>
              <li>information obtained through authorized integrations</li>
            </ul>
            <p className="text-sm">
              When applicable law requires express consent for processing financial or net worth
              data, Nuvos will implement the corresponding consent mechanism.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">4. Connecting brokers and financial accounts</h2>
            <p className="text-sm mb-3">
              Connecting external accounts is optional. Nuvos uses specialized providers for this
              connection — <strong className="text-white">Plaid</strong> for brokers and investment
              accounts, and <strong className="text-white">Belvo</strong> for banks and financial
              institutions in Latin America.
            </p>
            <div className="p-4 bg-yellow-500/10 rounded-xl border border-yellow-500/20 text-sm mb-3">
              <strong className="text-yellow-400">Nuvos does not request or store your broker or
              bank login credentials</strong>, which are managed directly by those providers.
            </div>
            <p className="text-sm mb-2">
              However, Nuvos may receive certain data authorized by the user, depending on the
              integration:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>positions</li>
              <li>balances</li>
              <li>transactions</li>
              <li>instruments</li>
              <li>account information</li>
              <li>identifiers</li>
            </ul>
            <p className="text-sm">
              Through this connection, Nuvos <strong className="text-white">does not obtain access
              to withdraw, transfer, deposit, buy, sell, or otherwise dispose of</strong> the
              user&apos;s funds or securities.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">5. Automatically collected data</h2>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>IP address</li>
              <li>Device type and operating system</li>
              <li>App version</li>
              <li>Technical identifiers and session information</li>
              <li>Error logs and technical events</li>
              <li>Push notification token</li>
              <li>Usage and security information</li>
              <li>Data needed to prevent fraud and abuse</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">6. Usage information</h2>
            <p className="text-sm mb-2">We may log:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>features used</li>
              <li>lessons completed and educational progress</li>
              <li>Arthur usage</li>
              <li>portfolios and watchlists</li>
              <li>configured alerts</li>
              <li>preferences</li>
              <li>participation in promotions</li>
              <li>technical information needed to operate and improve the Platform</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">7. Conversations with Arthur</h2>
            <p className="text-sm mb-3">
              When you use Arthur, the content you enter may be processed by the AI model
              providers used by Nuvos — including <strong className="text-white">Anthropic</strong>{" "}
              and <strong className="text-white">OpenAI</strong>. When you use voice or
              real-time search features, your content may also be processed by{" "}
              <strong className="text-white">ElevenLabs</strong> and{" "}
              <strong className="text-white">Perplexity</strong>, respectively.
            </p>
            <p className="text-sm mb-2">Conversations may be used to:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>generate responses</li>
              <li>maintain conversation context</li>
              <li>provide personalized features</li>
              <li>improve the Service when applicable</li>
              <li>detect errors</li>
              <li>prevent abuse</li>
              <li>comply with legal obligations</li>
            </ul>
            <p className="text-sm">
              Users should avoid entering information that is not necessary for the relevant
              feature.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">8. Primary purposes</h2>
            <p className="text-sm mb-2">Nuvos may process personal data to:</p>
            <ol className="list-decimal list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4">
              <li>Create and authenticate accounts</li>
              <li>Provide the Service</li>
              <li>Operate Arthur</li>
              <li>Personalize educational features</li>
              <li>Analyze information provided by the user</li>
              <li>Display and analyze portfolios</li>
              <li>Sync information across devices</li>
              <li>Generate reports</li>
              <li>Provide requested alerts</li>
              <li>Process payments and manage subscriptions</li>
              <li>Provide support</li>
              <li>Prevent fraud and maintain security</li>
              <li>Detect errors</li>
              <li>Comply with legal obligations</li>
            </ol>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">9. Secondary purposes</h2>
            <p className="text-sm mb-2">When applicable, Nuvos may use information for:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>statistical and aggregate analysis</li>
              <li>research and development</li>
              <li>product improvement</li>
              <li>developing new features</li>
              <li>generating metrics and tests</li>
              <li>improving models and systems</li>
              <li>communications related to Nuvos</li>
            </ul>
            <p className="text-sm">
              When a purpose requires consent, Nuvos will provide the corresponding mechanisms.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">10. We don&apos;t sell your data</h2>
            <p className="text-sm p-4 bg-white/5 rounded-xl border border-white/10">
              <strong className="text-white">Nuvos AI does not sell its users&apos; personal
              data.</strong> Nuvos does not trade user databases or use individual portfolio or
              net worth information to sell it to third parties.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">11. Technology providers</h2>
            <p className="text-sm mb-4">
              Nuvos may use external providers to operate the Service. This list may change as
              Nuvos evolves.
            </p>
            <div className="space-y-3 text-sm">
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Supabase</p>
                <p>Authentication, database, and related services.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Railway</p>
                <p>Infrastructure and hosting for our backend servers.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Stripe</p>
                <p>Payment processing when applicable. Nuvos AI never stores full card data.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Plaid</p>
                <p>Authorized connection with brokers and investment accounts.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Belvo</p>
                <p>Authorized connection with banks and financial institutions in Latin America.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Anthropic</p>
                <p>AI services that power Arthur.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">OpenAI</p>
                <p>AI services when used.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Perplexity</p>
                <p>Real-time information search and retrieval when used.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">ElevenLabs</p>
                <p>Voice services when used.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Fiscal.ai</p>
                <p>Financial and market data when used.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Resend</p>
                <p>Electronic communications and transactional emails.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Twilio</p>
                <p>Messaging (including WhatsApp) when that feature is available.</p>
              </div>
              <div className="p-4 bg-white/5 rounded-xl border border-white/10">
                <p className="font-semibold text-white/90">Vapi</p>
                <p>Voice calls with Arthur when that feature is available.</p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">12. International data transfers</h2>
            <p className="text-sm">
              Some providers may process information from countries other than the user&apos;s
              country of residence. Nuvos will implement the measures required by applicable law
              for such processing.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">13. Security</h2>
            <p className="text-sm mb-2">
              Nuvos implements reasonable measures to protect information under its control,
              including, as applicable:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>encryption in transit</li>
              <li>authentication mechanisms</li>
              <li>access controls</li>
              <li>infrastructure protection</li>
              <li>monitoring and technical logs</li>
              <li>controls against unauthorized access</li>
              <li>measures against fraud and abuse</li>
            </ul>
            <p className="text-sm">No system connected to the Internet can guarantee absolute security.</p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">14. Data retention</h2>
            <p className="text-sm mb-2">We will retain information for as long as necessary to:</p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>provide the Service</li>
              <li>comply with legal, tax, or accounting obligations</li>
              <li>resolve disputes</li>
              <li>prevent fraud</li>
              <li>protect security</li>
              <li>comply with other legitimate obligations</li>
            </ul>
            <p className="text-sm">
              Once information is no longer necessary, it will be deleted, anonymized, or
              otherwise processed in accordance with applicable law.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">15. Account deletion</h2>
            <p className="text-sm">
              Users can request account deletion from Profile → Delete my account. Deletion does
              not necessarily mean the immediate removal of all information when there is a legal
              obligation to retain it. Where legally applicable, data will be deleted or
              anonymized once the applicable retention period has ended.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">16. Data subject rights</h2>
            <p className="text-sm mb-3">
              Depending on applicable law, you may exercise rights related to your personal data,
              including:
            </p>
            <ul className="list-disc list-inside space-y-2 text-sm">
              <li><strong className="text-white/90">Access:</strong> know what personal data we process</li>
              <li><strong className="text-white/90">Rectification:</strong> correct inaccurate information</li>
              <li><strong className="text-white/90">Erasure:</strong> request deletion where legally applicable</li>
              <li><strong className="text-white/90">Objection:</strong> object to certain processing</li>
            </ul>
            <p className="text-sm mt-3">
              You may also exercise other rights recognized by applicable law.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">17. Rights requests</h2>
            <p className="text-sm">
              You can send a request to <span className="text-[#22c55e]">legal@nuvosai.com</span>.
              The request must contain the information necessary to identify you and properly
              process your request. When applicable, we may request documentation to verify
              identity or representation. Requests will be handled within the timeframes
              established by applicable law.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">18. Withdrawing consent</h2>
            <p className="text-sm">
              When processing is based on consent, you may request its withdrawal at{" "}
              <span className="text-[#22c55e]">legal@nuvosai.com</span>. Withdrawal will not have
              retroactive effects and will not prevent processing that must continue due to legal
              or contractual obligations.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">19. Limiting use and disclosure</h2>
            <p className="text-sm">
              You may request mechanisms to limit certain uses or disclosures when legally
              applicable. Certain preferences can be managed directly from the app.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">20. Cookies and similar technologies</h2>
            <p className="text-sm mb-2">
              Nuvos may use cookies, local storage, device identifiers, and similar technologies
              for:
            </p>
            <ul className="list-disc list-inside space-y-1 text-sm grid sm:grid-cols-2 gap-x-4 mb-3">
              <li>authentication</li>
              <li>session management</li>
              <li>security</li>
              <li>preferences</li>
              <li>functionality</li>
              <li>analytics</li>
              <li>fraud prevention</li>
              <li>improving the experience</li>
            </ul>
            <p className="text-sm">
              Where legally applicable, the corresponding consent will be requested.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">21. Minors</h2>
            <p className="text-sm">
              Nuvos AI is intended for people aged 18 and older. We do not intentionally seek to
              collect data from minors. If we identify that we have collected information from a
              minor in circumstances where we legally should not have, we will take reasonable
              steps to delete it.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">22. Changes to this Notice</h2>
            <p className="text-sm">
              Nuvos may modify this Notice to reflect changes in law, features, providers,
              technologies, processing practices, or Nuvos&apos;s structure. The current version
              will be available within Nuvos and at nuvosai.com. Material changes may be
              communicated through reasonable means.
            </p>
          </section>

          <section>
            <h2 className="text-white text-xl font-bold mb-3">23. Contact</h2>
            <p className="text-sm">
              Privacy email: <span className="text-[#22c55e]">legal@nuvosai.com</span><br />
              Website: <span className="text-white">nuvosai.com</span>
            </p>
          </section>

        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3 text-white/30 text-sm">
          <span>© 2026 Nuvos AI. All rights reserved.</span>
          <div className="flex items-center gap-4 text-xs sm:text-sm">
            <a href="/terms" className="hover:text-white/60 transition-colors">Terms of use →</a>
            <a href="/privacy" className="hover:text-white/60 transition-colors">Versión en español →</a>
            <a href="/ai-policy" className="hover:text-white/60 transition-colors">AI Policy →</a>
          </div>
        </div>

      </div>
    </main>
  );
}
