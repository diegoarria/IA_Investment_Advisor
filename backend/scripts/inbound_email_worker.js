// Cloudflare Email Worker — forwards every email received at
// *@import.nuvosai.com to Nuvos's inbound-email webhook as JSON.
//
// Setup (free, ~10 min):
//   1. Cloudflare dashboard → nuvosai.com → Email → Email Routing → enable
//      for the subdomain import.nuvosai.com (Cloudflare adds the MX records).
//   2. Workers → Create → paste this file; add `postal-mime` (npm) via
//      wrangler, or use the dashboard's "Email Worker" template.
//   3. Worker → Settings → Variables: NUVOS_WEBHOOK =
//      https://iainvestmentadvisor-production.up.railway.app/api/imports/inbound-email?secret=<INBOUND_EMAIL_SECRET>
//   4. Email Routing → Routing rules → Catch-all for import.nuvosai.com →
//      Action "Send to a Worker" → this worker.
import PostalMime from "postal-mime";

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export default {
  async email(message, env) {
    const raw = await new Response(message.raw).arrayBuffer();
    const email = await PostalMime.parse(raw);
    const body = {
      from: email.from?.address || message.from,
      to: [message.to, ...(email.to || []).map((t) => t.address)],
      subject: email.subject || "",
      text: email.text || "",
      html: email.html || "",
      message_id: email.messageId || null,
      attachments: (email.attachments || [])
        .filter((a) => a.content && a.content.byteLength < 15 * 1024 * 1024)
        .slice(0, 3)
        .map((a) => ({ filename: a.filename, content_type: a.mimeType, content: toBase64(a.content) })),
    };
    await fetch(env.NUVOS_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  },
};
