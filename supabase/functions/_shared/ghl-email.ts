const API_ORIGIN = "https://services.leadconnectorhq.com";
const ID = /^[A-Za-z0-9_-]{1,128}$/;

export class GhlEmailRejected extends Error {}
export class GhlRecipientUnavailable extends Error {}

type GhlEmailConfig = { token: string; locationId: string; from: string };

function headers(config: GhlEmailConfig) {
  return { Authorization: `Bearer ${config.token}`, Version: "v3", Accept: "application/json", "Content-Type": "application/json" };
}

// Uses only an existing imported contact; never creates or changes CRM recipients.
export async function verifyGhlEmailRecipient(config: GhlEmailConfig, contactId: string | null, recipient: string, fetchImpl: typeof fetch = fetch) {
  if (!contactId || !ID.test(contactId)) throw new GhlRecipientUnavailable("No verified HighLevel contact mapping; operator review required");
  const response = await fetchImpl(`${API_ORIGIN}/contacts/${encodeURIComponent(contactId)}`, {
    method: "GET", headers: headers(config), redirect: "error", signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) throw new GhlRecipientUnavailable("Mapped HighLevel contact no longer exists; operator review required");
  if (!response.ok) throw new Error(`HighLevel contact verification failed (${response.status})`);
  const data = await response.json();
  const contact = data?.contact;
  if (contact?.id !== contactId || contact?.locationId !== config.locationId || typeof contact?.email !== "string" || contact.email.trim().toLowerCase() !== recipient.trim().toLowerCase()) {
    throw new GhlRecipientUnavailable("HighLevel recipient identity mismatch; operator review required");
  }
  if (contact.dnd === true || contact.dndSettings?.Email?.status === "active") {
    throw new GhlRecipientUnavailable("HighLevel recipient has email disabled; operator review required");
  }
  return contactId;
}

export async function sendGhlEmail(config: GhlEmailConfig, contactId: string, recipient: string, email: { subject: string; html: string; text: string }, fetchImpl: typeof fetch = fetch) {
  const response = await fetchImpl(`${API_ORIGIN}/conversations/messages`, {
    method: "POST", headers: headers(config), redirect: "error", signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ type: "Email", contactId, emailTo: recipient, emailFrom: `Dirty Turf Academy <${config.from}>`, subject: email.subject, html: email.html, message: email.text }),
  });
  if (response.status >= 400 && response.status < 500) throw new GhlEmailRejected(`HighLevel rejected delivery (${response.status})`);
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.messageId !== "string" || !result.messageId) throw new Error("HighLevel delivery result is uncertain");
  return `ghl:${result.messageId}`;
}
