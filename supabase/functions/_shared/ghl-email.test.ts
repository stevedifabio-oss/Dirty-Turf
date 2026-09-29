import { describe, expect, it, vi } from "vitest";
import { GhlEmailRejected, GhlRecipientUnavailable, sendGhlEmail, verifyGhlEmailRecipient } from "./ghl-email";

const config = { token: "test-token", locationId: "location-1", from: "hello@mail.dirtyturf.com" };
const contact = { id: "contact-1", locationId: "location-1", email: "member@example.com" };
const json = (body: unknown, status = 200) => Response.json(body, { status });

describe("HighLevel existing email connection", () => {
  it("accepts only an existing contact whose location and email match", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ contact }));
    await expect(verifyGhlEmailRecipient(config, contact.id, contact.email, fetcher)).resolves.toBe(contact.id);
    expect(fetcher.mock.calls[0][1].method).toBe("GET");
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
  });
  it("never invents missing contact mappings", async () => {
    const fetcher = vi.fn();
    await expect(verifyGhlEmailRecipient(config, null, contact.email, fetcher)).rejects.toBeInstanceOf(GhlRecipientUnavailable);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { ...contact, email: "other@example.com" },
    { ...contact, locationId: "other-location" },
    { ...contact, id: "other-contact" },
    { ...contact, dnd: true },
    { ...contact, dndSettings: { Email: { status: "active" } } },
  ])("fails closed for changed identity, tenant or recipient opt-out", async changed => {
    const fetcher = vi.fn().mockResolvedValue(json({ contact: changed }));
    await expect(verifyGhlEmailRecipient(config, contact.id, contact.email, fetcher)).rejects.toBeInstanceOf(GhlRecipientUnavailable);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("preserves branded HTML and signed unsubscribe content without creating contacts", async () => {
    const fetcher = vi.fn().mockResolvedValue(json({ messageId: "message-1" }));
    const email = { subject: "Academy update", html: '<p style="color:#047631">Update</p><a href="https://example.com/unsubscribe?token=signed">Unsubscribe</a>', text: "Update. Unsubscribe: https://example.com/unsubscribe?token=signed" };
    await expect(sendGhlEmail(config, contact.id, contact.email, email, fetcher)).resolves.toBe("ghl:message-1");
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toEqual({ type: "Email", contactId: contact.id, emailTo: contact.email, emailFrom: config.from, subject: email.subject, html: email.html, message: email.text });
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("distinguishes provider rejection from uncertain delivery without automatic resend", async () => {
    const email = { subject: "Update", html: "Update", text: "Update" };
    await expect(sendGhlEmail(config, contact.id, contact.email, email, vi.fn().mockResolvedValue(json({}, 403)))).rejects.toBeInstanceOf(GhlEmailRejected);
    const fetcher = vi.fn().mockResolvedValue(json({}, 500));
    await expect(sendGhlEmail(config, contact.id, contact.email, email, fetcher)).rejects.toThrow("uncertain");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
