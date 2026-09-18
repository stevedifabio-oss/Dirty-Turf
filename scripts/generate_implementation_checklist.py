#!/usr/bin/env python3
"""Generate the Dirty Turf functional-app implementation checklist."""

from pathlib import Path
from textwrap import wrap

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "dirty-turf-functional-app-checklist.pdf"

PAGE_W, PAGE_H = letter
MARGIN = 44

GREEN_DARK = HexColor("#003113")
GREEN = HexColor("#047631")
LIME = HexColor("#78C12E")
ORANGE = HexColor("#FF9002")
PALE = HexColor("#F4FAEE")
MIST = HexColor("#E8F5D0")
GRAY = HexColor("#D6DCD0")
INK = HexColor("#111F14")
MUTED = HexColor("#3D5C44")
SOFT_LINE = HexColor("#D3DFD5")
TOTAL_PAGES = 6


class ChecklistPDF:
    def __init__(self, output: Path):
        output.parent.mkdir(parents=True, exist_ok=True)
        self.c = canvas.Canvas(str(output), pagesize=letter)
        self.c.setTitle("Dirty Turf Academy - Remaining Launch Checklist")
        self.c.setAuthor("Dirty Turf")
        self.page = 0
        self.y = PAGE_H - MARGIN

    def new_page(self, label: str, title: str, subtitle: str = ""):
        if self.page:
            self._footer()
            self.c.showPage()
        self.page += 1
        self.y = PAGE_H - MARGIN
        self.c.setFillColor(PALE)
        self.c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        self.c.setFillColor(GREEN_DARK)
        self.c.rect(0, PAGE_H - 112, PAGE_W, 112, fill=1, stroke=0)
        self.c.setFillColor(LIME)
        self.c.rect(0, PAGE_H - 116, PAGE_W, 4, fill=1, stroke=0)
        self.c.setFont("Helvetica-Bold", 15)
        self.c.setFillColor(white)
        self.c.drawString(MARGIN, PAGE_H - 69, "DIRTY")
        dirty_width = stringWidth("DIRTY", "Helvetica-Bold", 15)
        self.c.setFillColor(LIME)
        self.c.drawString(MARGIN + dirty_width + 3, PAGE_H - 69, "TURF")
        self.c.setFillColor(LIME)
        self.c.setFont("Helvetica-Bold", 8.5)
        self.c.drawRightString(PAGE_W - MARGIN, PAGE_H - 39, label.upper())
        self.c.setFillColor(white)
        title_size = 20 if stringWidth(title, "Helvetica-Bold", 22) > 360 else 22
        self.c.setFont("Helvetica-Bold", title_size)
        self.c.drawString(MARGIN + 116, PAGE_H - 69, title)
        if subtitle:
            self.c.setFont("Helvetica", 8.5)
            self.c.setFillColor(GRAY)
            self.c.drawString(MARGIN + 116, PAGE_H - 86, subtitle)
        self.y = PAGE_H - 143

    def _footer(self):
        self.c.setStrokeColor(SOFT_LINE)
        self.c.line(MARGIN, 34, PAGE_W - MARGIN, 34)
        self.c.setFont("Helvetica", 7.5)
        self.c.setFillColor(MUTED)
        self.c.drawString(MARGIN, 21, "DIRTY TURF  |  FUNCTIONAL APP IMPLEMENTATION")
        self.c.drawRightString(PAGE_W - MARGIN, 21, f"PAGE {self.page} OF {TOTAL_PAGES}")

    def finish(self):
        self._footer()
        self.c.save()

    def section(self, title: str, eyebrow: str | None = None, color=GREEN):
        if eyebrow:
            self.c.setFont("Helvetica-Bold", 7.5)
            self.c.setFillColor(ORANGE)
            self.c.drawString(MARGIN, self.y, eyebrow.upper())
            self.y -= 14
        self.c.setFillColor(color)
        self.c.setFont("Helvetica-Bold", 14)
        self.c.drawString(MARGIN, self.y, title)
        self.y -= 20

    def paragraph(self, text: str, width_chars=91, size=9.2, leading=13, color=MUTED):
        self.c.setFillColor(color)
        self.c.setFont("Helvetica", size)
        for line in wrap(text, width=width_chars):
            self.c.drawString(MARGIN, self.y, line)
            self.y -= leading
        self.y -= 4

    def checklist(self, items: list[str], compact=False):
        size = 8.2 if compact else 9
        leading = 10 if compact else 12
        max_chars = 91 if compact else 84
        for item in items:
            state = "todo"
            if item.startswith("[x] "):
                state = "done"
                item = item[4:]
            elif item.startswith("[!] "):
                state = "attention"
                item = item[4:]
            elif item.startswith("[ ] "):
                item = item[4:]
            lines = wrap(item, width=max_chars)
            item_h = max(20, len(lines) * leading + (6 if compact else 8))
            if self.y - item_h < 50:
                raise RuntimeError("Checklist content overflowed a page")
            box_color = GREEN if state != "attention" else ORANGE
            self.c.setStrokeColor(box_color)
            self.c.setLineWidth(1)
            if state in {"done", "attention"}:
                self.c.setFillColor(box_color)
                self.c.roundRect(MARGIN, self.y - 11, 10, 10, 1.5, fill=1, stroke=1)
                self.c.setFillColor(white)
                self.c.setFont("Helvetica-Bold", 7)
                self.c.drawCentredString(MARGIN + 5, self.y - 8.5, "x" if state == "done" else "!")
            else:
                self.c.roundRect(MARGIN, self.y - 11, 10, 10, 1.5, fill=0, stroke=1)
            self.c.setFillColor(INK)
            self.c.setFont("Helvetica", size)
            line_y = self.y
            for line in lines:
                self.c.drawString(MARGIN + 19, line_y, line)
                line_y -= leading
            self.y -= item_h

    def card(self, title: str, body: str, accent=GREEN, width=None, height=66, x=None):
        width = width or PAGE_W - 2 * MARGIN
        x = MARGIN if x is None else x
        y = self.y - height
        self.c.setFillColor(white)
        self.c.setStrokeColor(SOFT_LINE)
        self.c.roundRect(x, y, width, height, 6, fill=1, stroke=1)
        self.c.setFillColor(accent)
        self.c.roundRect(x, y, 5, height, 2, fill=1, stroke=0)
        self.c.setFillColor(INK)
        self.c.setFont("Helvetica-Bold", 9.5)
        self.c.drawString(x + 16, y + height - 19, title)
        self.c.setFillColor(MUTED)
        self.c.setFont("Helvetica", 8.2)
        body_lines = wrap(body, width=max(28, int(width / 5.6)))
        for i, line in enumerate(body_lines[:3]):
            self.c.drawString(x + 16, y + height - 34 - i * 11, line)
        return y

    def command(self, text: str):
        lines = text.splitlines()
        height = 16 + len(lines) * 11
        y = self.y - height
        self.c.setFillColor(GREEN_DARK)
        self.c.roundRect(MARGIN, y, PAGE_W - 2 * MARGIN, height, 5, fill=1, stroke=0)
        self.c.setFillColor(LIME)
        self.c.setFont("Courier-Bold", 7.2)
        for i, line in enumerate(lines):
            self.c.drawString(MARGIN + 12, y + height - 15 - i * 11, line)
        self.y = y - 14

    def gate(self, text: str):
        lines = wrap(text, width=78)
        height = 26 + len(lines) * 11
        y = self.y - height
        self.c.setFillColor(HexColor("#FFF3E1"))
        self.c.setStrokeColor(ORANGE)
        self.c.roundRect(MARGIN, y, PAGE_W - 2 * MARGIN, height, 6, fill=1, stroke=1)
        self.c.setFillColor(ORANGE)
        self.c.setFont("Helvetica-Bold", 8)
        self.c.drawString(MARGIN + 12, y + height - 16, "NOT DONE UNTIL")
        self.c.setFillColor(INK)
        self.c.setFont("Helvetica", 8.4)
        for i, line in enumerate(lines):
            self.c.drawString(MARGIN + 12, y + height - 30 - i * 11, line)
        self.y = y - 14

    def timeline(self, time: str, title: str, owner: str):
        self.c.setFillColor(ORANGE)
        self.c.roundRect(MARGIN, self.y - 17, 64, 20, 4, fill=1, stroke=0)
        self.c.setFillColor(white)
        self.c.setFont("Helvetica-Bold", 8)
        self.c.drawCentredString(MARGIN + 32, self.y - 10, time)
        self.c.setFillColor(INK)
        self.c.setFont("Helvetica-Bold", 11)
        self.c.drawString(MARGIN + 76, self.y - 8, title)
        self.c.setFillColor(MUTED)
        self.c.setFont("Helvetica", 7.5)
        self.c.drawRightString(PAGE_W - MARGIN, self.y - 8, f"OWNER: {owner}")
        self.y -= 32

    def signoff_row(self, label: str):
        self.c.setStrokeColor(SOFT_LINE)
        self.c.line(MARGIN, self.y - 12, PAGE_W - MARGIN, self.y - 12)
        self.c.setFillColor(INK)
        self.c.setFont("Helvetica-Bold", 8.5)
        self.c.drawString(MARGIN, self.y, label)
        self.c.setFillColor(MUTED)
        self.c.setFont("Helvetica", 8)
        self.c.drawRightString(PAGE_W - MARGIN, self.y, "OWNER / TIME / RESULT")
        self.y -= 30


def build_pdf():
    pdf = ChecklistPDF(OUTPUT)

    pdf.new_page("September 18 release plan", "Remaining launch checklist", "Only the work still required to make the Academy app production-ready")
    pdf.section("The finish line", "Definition of done")
    pdf.paragraph(
        "Every current Academy member can request a Magic Link, reach the content they already own, use the community and field tools, and reopen saved work on another device. The desktop web app, mobile web/PWA, and signed iOS and Android builds all pass their production paths."
    )
    col_w = (PAGE_W - 2 * MARGIN - 12) / 2
    y1 = pdf.card("BACKEND LIVE", "Nineteen migrations, 55 RLS tables, and ten Edge Functions are active. Mailgun Auth SMTP is configured; delivery awaits pilot proof.", GREEN, col_w, 82, MARGIN)
    pdf.card("ACADEMY IMPORTED", "60 login accounts, 49 linked enrollments, 128 lessons, community history, events, and private media are in Supabase.", LIME, col_w, 82, MARGIN + col_w + 12)
    pdf.y = y1 - 14
    y2 = pdf.card("APP VERIFIED", "Eighty-one tests, responsive web QA, private media, PWA checks, Android APK/AAB, and an iOS simulator build all pass.", ORANGE, col_w, 82, MARGIN)
    pdf.card("RELEASE CANDIDATE", "Web, iOS, and Android contain the same verified bundle. GHL stays live until the remaining client gates pass.", GREEN_DARK, col_w, 82, MARGIN + col_w + 12)
    pdf.y = y2 - 18
    pdf.section("Completed and removed from this checklist")
    pdf.checklist([
        "[x] Nineteen Supabase migrations, 55-table RLS audit, access/notification/geocoding controls, security hardening, and ten Edge Function deployments are complete.",
        "[x] The GHL archive was composed into 28 bounded batches; dry run, commit, and idempotent repeat all passed in production.",
        "[x] Sixty unique member accounts were silently provisioned and all 49 enrollments are linked. No customer email was sent.",
        "[x] One course, 21 modules, 128 lessons, 137 course asset rows, 62 posts, 59 comments, 5 events, 7 real post images, and 4 external resources are live.",
        "[x] Google Play identity/phone/website verification, Apple and Play app records, Apple renewal billing, package reservation, and Play App Signing enrollment are complete.",
        "[x] Desktop, PWA, calculator, map math, protected address search, native wrappers, importer, billing, legal/deletion flows, private signed media, store metadata, permissions, icons, Android builds, and iOS simulator build pass.",
        "[x] In-app notifications, unread state, replies, mentions, post/comment likes, granular email preferences, branded Mailgun templates, retries, deep links, and signed unsubscribe are built.",
    ], compact=True)
    pdf.section("Five remaining acceptance gates")
    pdf.paragraph("1. Mailgun delivery proof.  2. Real-member Magic Link pilot.  3. Stripe test proof.  4. Physical-device and store release proof.  5. Controlled GHL delta and cutover.", width_chars=94, size=8.6, leading=11)
    pdf.gate("Keep HighLevel live until member login, content access, production smoke tests, real-device measurement, and rollback evidence all pass.")

    pdf.new_page("Gate 1", "Mailgun acceptance", "The domain, production deployment, and Auth SMTP are live; now prove delivery and redirects")
    pdf.timeline("STEP 1", "Verify the existing Mailgun sender", "Dirty Turf owner")
    pdf.checklist([
        "[x] Supabase Auth custom SMTP is saved with hello@mail.dirtyturf.com through smtp.mailgun.org:465.",
        "[!] Public DNS confirms Mailgun MX/SPF and DMARC for mail.dirtyturf.com. Confirm Mailgun shows DKIM healthy before the pilot.",
        "[ ] Add MAILGUN_API_KEY, MAILGUN_DOMAIN, MAILGUN_FROM_EMAIL, MAILGUN_FROM_NAME, MAILGUN_REGION, and two different generated notification secrets to Supabase Edge Function secrets. APP_URL is already live.",
        "[ ] Disable Mailgun click tracking for authentication mail so Magic Link URLs are not rewritten.",
        "[ ] Send a Supabase Magic Link to the owner and one existing pilot member. Confirm both cold-start web redirect and com.dirtyturf.academy://auth/callback on a physical phone.",
        "[ ] Send every community template to one internal recipient. Verify sender, layout, direct link, no duplicate on retry, category opt-out, and signed unsubscribe before enabling Cron.",
        "[ ] Store the project URL and dispatch secret in Supabase Vault, then enable the documented five-minute academy-notification-dispatch Cron job.",
        "[ ] Revoke the unused Resend API key shared in chat after Mailgun delivery passes. Keep Mailgun SMTP credentials only in Supabase's encrypted settings.",
    ], compact=True)
    pdf.timeline("STEP 2", "Lock production identity", "Release owner")
    pdf.checklist([
        "[x] Lock the permanent web origin as https://app.dirtyturf.com and add it to the Supabase Auth redirect allowlist.",
        "[x] Netlify ownership, Cloudflare routing, HTTPS/TLS, and HTTP-to-HTTPS redirect pass for app.dirtyturf.com.",
        "[x] PR #2 merged as ab26370a; Netlify production deploy 6aad91918ffb9d0007f1c178 is ready on app.dirtyturf.com.",
        "[x] app.dirtyturf.com is the Supabase Site URL, APP_URL, allowed origin, and web Magic Link target; the native callback remains allowed.",
        "[x] The permanent Dirty Turf owner, owner profile, organization, membership, and Academy administrator access exist in Supabase.",
        "[x] The owner organization UUID is recorded in the ignored private import package and the production import is complete.",
        "[x] Privacy, support, deletion instructions, and the signed-in deletion workflow are built and return 200 over production HTTPS.",
        "[ ] Record a client owner and recovery owner with MFA for Supabase, Mailgun, GitHub, Netlify, Stripe, Apple, Google Play, GHL, and DNS.",
    ], compact=True)
    pdf.section("Secret boundary")
    pdf.command("BROWSER-SAFE: VITE_SUPABASE_URL, publishable key, public Payment Link\nSERVER-ONLY: service-role key, GHL token, Mailgun SMTP/API values, notification signing/dispatch secrets, Stripe secrets")
    pdf.gate("Do not invite members until a real Supabase Magic Link delivers from the verified Dirty Turf sender and both web and native redirects work.")

    pdf.new_page("Gate 2", "Guarantee member access", "The archive and accounts are live; finish delivery and real-member acceptance before notification")
    pdf.timeline("STEP 3", "Production import proof", "Migration owner")
    pdf.checklist([
        "[x] Production contains 60 Auth users, 61 Academy member rows, 49 enrollments, 1 course, 21 modules, 128 lessons, 62 posts, 59 comments, and 5 events.",
        "[x] Run npm run academy:access-audit: 60 unique login emails, 49 enrolled members, zero duplicates, and allEnrolledCanLogin:true.",
        "[x] All 28 academy-import batches passed commit:false, commit:true, and an idempotent repeat with provider IDs and source ledgers intact.",
        "[x] Representative lessons, progress, posts, comments, events, private course media, and private post images render in the authenticated app.",
        "[x] Import and private-media policies require authenticated Academy administration or active Academy membership.",
        "[!] The extra 61st source row is a historical author with no email and no enrollment. It is preserved for authorship and intentionally cannot be invited.",
    ], compact=True)
    pdf.timeline("STEP 4", "Provision all member accounts", "Access owner")
    pdf.checklist([
        "[x] Invite/provision preview and post-import audit report all 60 login-eligible members ready and all 49 enrollments linked.",
        "[x] All 60 accounts were provisioned without sending mail. Imported access grants are durable; passwords were not migrated.",
        "[ ] With Auth SMTP configured, prove an imported member can request a Magic Link and an unknown email cannot create Academy access.",
        "[ ] Pilot Magic Links with 3-5 members across iPhone, Android, and web. Check delivery, cold start, expiration, reuse, logout, and second-device login.",
        "[ ] After the pilot passes, notify the remaining members in batches of no more than 25 and monitor delivery failures.",
        "[x] Imported historical posts and lessons did not generate old-content email; delivery remains paused until the pilot.",
        "[ ] Confirm owner, admin, moderator, active, cancelled, suspended, and unassigned access behavior before broad notification.",
    ], compact=True)
    pdf.section("Exact sequence")
    pdf.command(
        "COMPLETE: owner -> import -> provision silently -> Auth SMTP\nREMAINING: delivery proof -> 3-5 pilot links -> notify in batches <= 25"
    )
    pdf.gate("Do not send all 60 links at once. A silent account import plus a small delivery pilot protects members from lockouts and duplicate invitations.")

    pdf.new_page("Gates 3 and 4", "Payments and production web", "Prove billing in Stripe test mode, then merge and verify the deployed release")
    pdf.timeline("STEP 5", "Activate Stripe test mode", "Billing owner")
    pdf.checklist([
        "[ ] Create or confirm the client-owned Stripe account, business verification, Dirty Turf administrators, MFA, billing, and recovery ownership.",
        "[ ] Create the Academy product and Price in test mode. Map the Price to an inactive Academy plan and its included courses, then activate it.",
        "[ ] Register the Supabase stripe-webhook endpoint for Checkout and subscription lifecycle events. Store secret and webhook signing keys only in Supabase secrets.",
        "[ ] Configure Customer Portal and a web Payment Link. Add only the public Payment Link to Netlify.",
        "[ ] Complete one existing-member Checkout and one new-email Payment Link purchase. Verify account, grant, enrollment, billing rows, and Magic Link access.",
        "[ ] Replay a webhook, force a retriable failure, and prove idempotent recovery. Then cancel both a Stripe-only member and an imported GHL member to prove grant precedence.",
        "[ ] Confirm Billing Portal works on web and native iOS/Android show no purchase button or external checkout link.",
    ], compact=True)
    pdf.timeline("STEP 6", "Merge and prove production", "Release owner")
    pdf.checklist([
        "[x] GitHub PRs #2 and #3, their Netlify previews, the repository credential-pattern scan, and the complete local gate pass.",
        "[x] GitHub CI runs 35386112811 and 35386821902 passed on their exact heads immediately before merge.",
        "[x] Team-authenticated preview smoke confirms the login shell, production canonical metadata, Mailgun disclosure, and public legal routes with no console errors.",
        "[x] app.dirtyturf.com ownership, Cloudflare/Netlify routing, TLS, and HTTP redirect pass the automated domain gate.",
        "[x] Verify the local release candidate at desktop, 390px iPhone, and 412px Android widths with no horizontal overflow; private one- and five-image community posts load correctly.",
        "[ ] Verify preview auth, deep links, Academy, community, events, private assets, progress, headers, and network logs with an existing pilot member.",
        "[x] Notification-center QA passes at 390 and 1440 pixels with zero overflow, no console errors, working mark-all, mentions, nested replies, and settings toggles.",
        "[x] Merge commit 3b51728a is live in Netlify production deploy 6aad92da88497700081bd70a.",
        "[x] Production smoke passes app shell, legal pages, PWA assets, SPA fallback, redirect, manifest MIME, and secure headers.",
        "[ ] Run the authenticated golden path with a pilot member and record the test and rollback owners.",
    ], compact=True)
    pdf.gate("Keep the new production app in controlled-pilot mode until billing proof and the authenticated member path both pass.")

    pdf.new_page("Gate 5", "Real phones and store builds", "A simulator proves compilation; launch approval requires physical-device accuracy and signed releases")
    pdf.timeline("STEP 7", "Run the measured-yard test", "Field QA owner")
    pdf.checklist([
        "[ ] On a supported iPhone, place at least four live AR points around a tape-measured yard, undo one point, finish, and record area, perimeter, device, OS, and error percentage.",
        "[ ] Repeat on a supported Samsung/Android phone with ARCore. Compare both results to the same tape-measured reference.",
        "[ ] Trace the same yard on the map, test multiple turf polygons and member-only address search, and compare combined area to the known reference.",
        "[ ] Test camera/location denial, unsupported hardware, tracking loss, rotation, background/resume, poor network, offline behavior, and duplicate-save protection.",
        "[ ] Save a calculation with photos and reopen it on a second device. Verify area, rate, pounds, 40-lb and 50-lb bags, price, method, date, and history.",
    ], compact=True)
    pdf.timeline("STEP 8", "Create signed test releases", "Store owner")
    pdf.checklist([
        "[x] Build Android debug APK, unsigned release AAB, and an iOS Release simulator app from the same verified web bundle; all six entry documents match SHA-256 e96422e18f6e810c....",
        "[x] Declare that the iOS app uses only exempt standard encryption; the app does not add custom cryptography.",
        "[!] Apple App ID and App Store Connect record 6813588770 exist. The Mac has no usable distribution certificate/profile. Issue the client-owned signing assets, complete EU trader compliance, then archive and upload to TestFlight. A physical iPhone is separately required for AR acceptance.",
        "[!] Google Play app record 4973615558687213779 exists, the package is reserved, and Play App Signing is accepted. Create or recover the client upload key, configure the four local signing variables, sign the AAB, and publish to Internal testing.",
        "[x] Google Cloud is not required for measurement: live camera measurement uses ARKit/ARCore and map tracing uses Esri/NAIP/OSM. Address search now runs through a protected, cached, rate-limited service.",
        "[x] Prepare and machine-check store name, platform-specific short copy, description, category, privacy/data-safety answers, URLs, reviewer notes, screenshot plan, and consumption-only billing guidance.",
        "[ ] Enter the prepared metadata, screenshots, reviewer login, content rating, privacy answers, and deletion URL in both store records.",
        "[ ] Test install, update, deep link, Magic Link, logout, expired/reused links, camera, location, photos, map, lessons, community, and notifications on store builds.",
        "[ ] Confirm both store builds are consumption-only and give reviewers a pre-existing Academy test account.",
    ], compact=True)
    pdf.gate("Do not submit for review until AR accuracy is recorded on both platforms and TestFlight plus Play Internal builds complete the full signed-in golden path.")

    pdf.new_page("Gate 6", "Cutover, monitor, and sign off", "Keep the launch reversible until Dirty Turf approves member access and production behavior")
    pdf.timeline("STEP 9", "Run the final GHL delta", "Migration owner")
    pdf.checklist([
        "[ ] Freeze GHL course/community changes, take a final delta capture, validate it, and reconcile member, enrollment, lesson, post, comment, and event counts.",
        "[ ] Run a final import dry run, commit the approved delta once, and repeat it to prove idempotency.",
        "[ ] Back up the private archive and production database. Record the restore owner and test the documented rollback path.",
        "[ ] Rotate the GHL private token shared in chat and keep the replacement server-side only.",
        "[ ] Keep GHL read-only as the rollback source until member access, content, billing, web production, and store pilot acceptance are signed off.",
    ], compact=True)
    pdf.timeline("STEP 10", "Pilot, launch, and monitor", "Product owner")
    pdf.checklist([
        "[ ] Complete the 3-5 member pilot before the broad member notification. Resolve every login, entitlement, or content mismatch first.",
        "[ ] Monitor Auth mail, Mailgun events, notification outbox retries, invite failures, Edge Function errors, webhook failures, database errors, app crashes, and support during the first 24 hours.",
        "[ ] Record an owner, timestamp, and evidence link for each final sign-off below.",
    ], compact=True)
    pdf.section("Final sign-off")
    pdf.signoff_row("60 accounts ready / 49 enrollments linked")
    pdf.signoff_row("Stripe test purchase, replay, cancellation")
    pdf.signoff_row("Netlify production golden path")
    pdf.signoff_row("iPhone AR / Samsung AR / map accuracy")
    pdf.signoff_row("TestFlight / Play Internal acceptance")
    pdf.signoff_row("GHL delta, backup, and rollback")
    pdf.section("Simple next actions")
    pdf.paragraph("1. Confirm Mailgun DKIM/API secrets and test one recipient.  2. Pilot 3-5 existing members.  3. Prove Stripe.  4. Run the authenticated production path.  5. Test real phones.  6. Upload signed builds.  7. Run the final GHL delta, notify, and cut over.", width_chars=94, size=8.4, leading=11)
    pdf.gate("Launch only after every sign-off passes. Until then, keep HighLevel available and label the new app as a controlled pilot.")

    pdf.finish()
    print(OUTPUT)


if __name__ == "__main__":
    build_pdf()
