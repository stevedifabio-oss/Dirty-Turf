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
TOTAL_PAGES = 8


class ChecklistPDF:
    def __init__(self, output: Path):
        output.parent.mkdir(parents=True, exist_ok=True)
        self.c = canvas.Canvas(str(output), pagesize=letter)
        self.c.setTitle("Dirty Turf Academy - Tomorrow Launch Checklist")
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
        leading = 11 if compact else 12
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
            item_h = max(22, len(lines) * leading + 8)
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

    pdf.new_page("September 18 activation", "Functional app checklist", "Native Academy, community, field tools, member access, web release, and mobile delivery")
    pdf.section("Tomorrow's finish line", "Definition of done")
    pdf.paragraph(
        "An active Dirty Turf member can sign into the native app, open imported Academy lessons, use the community and events, measure a turf job, calculate exact infill bags and customer price, save the result, and reopen it on a second device. Production web and test-store builds are verified with client-owned accounts."
    )
    col_w = (PAGE_W - 2 * MARGIN - 12) / 2
    y1 = pdf.card("APP EXPERIENCE", "Native Academy, lessons, quizzes, community, events, member directory, field tools, and mobile navigation are built.", GREEN, col_w, 82, MARGIN)
    pdf.card("CONTENT ARCHIVE", "One course, 21 module groups, 128 lessons, 137 assets, and 3 quizzes are captured outside Git.", LIME, col_w, 82, MARGIN + col_w + 12)
    pdf.y = y1 - 14
    y2 = pdf.card("BACKEND READY", "Supabase schema, RLS, private storage, importer, magic-link accounts, Stripe billing, and source-aware entitlements are coded.", ORANGE, col_w, 82, MARGIN)
    pdf.card("NATIVE DELIVERY", "Capacitor iOS simulator and Android debug builds pass. Real-device AR and signed store builds remain release gates.", GREEN_DARK, col_w, 82, MARGIN + col_w + 12)
    pdf.y = y2 - 18
    pdf.section("Verified build state")
    pdf.checklist([
        "[x] Schema contracts cover all 50 public tables and 10 migrations; TypeScript, 53 tests, the PWA asset manifest, and the production build pass.",
        "[x] The infill calculator passes a live 20 x 18 ft test: 360 sq ft, 180 lb at 0.50 lb/sq ft, 5 forty-pound bags, 4 fifty-pound bags, and $259.20 at $0.72/sq ft.",
        "[x] Mobile QA passes from 320 x 568 through tablet with no horizontal overflow; the signed-out Magic Link gate remains mounted after the startup watchdog.",
        "[x] Unsigned iOS simulator compilation, Android debug assembly, Android unit tests, and Android lint succeed.",
        "[x] The private HighLevel course archive validates and remains ignored by Git.",
        "[!] Production Supabase migration, Stripe test-mode proof, member import/provisioning, SMTP delivery, deep-link proof, real-device AR, signed store builds, and production smoke tests still require client accounts or devices.",
    ], compact=True)
    pdf.gate("Do not retire HighLevel or invite members until archive counts reconcile, the import dry run passes, client SMTP delivers, and active/cancelled access rules are proven.")

    pdf.new_page("08:00-09:00", "Client-owned accounts first", "The only steps that require the client to sign in, verify identity, or supply billing")
    pdf.timeline("8:00 AM", "Finish account-owner actions", "Dirty Turf owner")
    pdf.checklist([
        "[ ] Confirm GitHub repository stevedifabio-oss/Dirty-Turf, the active Netlify site, and Supabase project ipbtldajgsoxixqmajec are owned by Dirty Turf LLC admins.",
        "[ ] Supabase: configure a client-owned SMTP sender, verify its DNS records, set the Site URL to the exact production HTTPS origin, and allow that origin plus com.dirtyturf.academy://auth/callback.",
        "[ ] Apple: add the renewal card, accept pending agreements, confirm App Store Connect access, and keep Dirty Turf LLC as the legal seller.",
        "[ ] Google Play: finish organization identity, website, and phone verification. App publication stays blocked until Google approves the developer account.",
        "[ ] Confirm access to dirtyturf.com DNS plus the privacy, support, and account-deletion URLs needed by both stores.",
        "[ ] After the final HighLevel archive capture, rotate the private integration token shared in chat and store the replacement only as a server secret.",
        "[ ] Use only client-owned email, recovery, MFA, billing, and password-manager records. Do not connect a consultant's personal account or terminal credentials.",
    ], compact=True)
    pdf.section("Accounts required")
    pdf.paragraph("HighLevel, Supabase, GitHub, Netlify, domain/DNS, transactional SMTP, Apple Developer/App Store Connect, Google Play Console/Google Cloud, and a client-owned Stripe account before payments are enabled.", width_chars=96, size=8.5, leading=11)
    pdf.section("Secret boundary")
    pdf.command(
        "# Browser-safe (Netlify)\nVITE_SUPABASE_URL=...\nVITE_SUPABASE_PUBLISHABLE_KEY=...\nVITE_STRIPE_ACADEMY_PAYMENT_LINK=https://buy.stripe.com/...\n\n# Server-only (Supabase secrets)\nSUPABASE_SERVICE_ROLE_KEY=...\nGHL_PRIVATE_INTEGRATION_TOKEN=...\nGHL_LOCATION_ID=...\nAPP_URL=...  APP_ALLOWED_ORIGINS=...  AUTH_REDIRECT_URLS=...\nSTRIPE_SECRET_KEY=...  STRIPE_WEBHOOK_SECRET=..."
    )
    pdf.checklist([
        "[ ] Never put the HighLevel token or Supabase service-role key in a VITE_ variable, browser storage, app bundle, screenshot, PDF, or Git commit.",
        "[ ] Record one client owner and one recovery owner for every account before launch.",
    ], compact=True)
    pdf.gate("Every account is client-owned, every secret has a rotation path, and no personal credential or billing profile is attached to the product.")

    pdf.new_page("09:00-11:00", "Activate the Supabase backend", "Apply the reviewed schema, deploy the importer, and prove authorization before content import")
    pdf.timeline("9:00 AM", "Migrate and deploy", "Backend owner")
    pdf.command(
        "npm run check\nnpx supabase link --project-ref ipbtldajgsoxixqmajec\nnpx supabase db push\nnpx supabase functions deploy academy-import\nnpx supabase functions deploy academy-invite-members\nnpx supabase functions deploy create-checkout\nnpx supabase functions deploy create-billing-portal\nnpx supabase functions deploy stripe-webhook --no-verify-jwt\nnpx supabase functions deploy health"
    )
    pdf.checklist([
        "[ ] Apply all ten ordered migrations through 20260918080238_academy_billing_entitlements.sql and confirm Academy, community, billing, entitlement, invite, asset, progress, and import-ledger tables exist.",
        "[ ] In Supabase API settings, expose only the intended schema. Re-check RLS, grants, revoked anon/public access, and security-invoker views after any exposure change.",
        "[ ] Create one Academy owner/admin and one normal active member. Verify the importer rejects the member and accepts only the owner/admin session.",
        "[ ] Create two company organizations. Prove company B cannot read company A properties, calculations, visits, photos, or storage objects.",
        "[ ] Confirm academy-assets is private. Test an authorized signed asset URL and an unauthorized read of the same object.",
        "[ ] Confirm claim_academy_memberships is authenticated-only and ensure_academy_user_workspace is service-role-only. A normal member must not call the provisioning Edge Function.",
        "[ ] Configure client SMTP and exact auth redirects before notifications. Test web and native PKCE links from cold start and while the app is open, plus logout, expiry, and second-device login.",
        "[ ] Enable backups, document the restore owner, and record the migration version plus Edge Function versions.",
    ], compact=True)
    pdf.section("Backend acceptance record")
    pdf.signoff_row("Migration applied")
    pdf.signoff_row("Cross-tenant RLS denied")
    pdf.signoff_row("Private Academy and photo storage proven")
    pdf.signoff_row("SMTP and auth redirects proven")
    pdf.gate("Stop if a service-role key appears in the browser bundle, if any cross-company record is readable, or if a normal member can run an admin import.")

    pdf.new_page("11:00-13:00", "Import the HighLevel archive", "The private source package is composed and validated; reconcile it in production before any invite is sent")
    pdf.timeline("11:00 AM", "Dry run, reconcile, then import", "Migration owner")
    pdf.section("Private archive ready")
    pdf.checklist([
        "[x] 1 course, 21 normalized module groups, 128 unique lessons, 137 assets, and 3 quizzes are stored in output/private/ghl-course-import.json outside Git.",
        "[x] 60 login-eligible members plus one historical non-login author, 49 enrollments, 15 categories, 62 posts, 59 comments, and 5 events are reconciled.",
        "[x] Lesson status is preserved: 109 published and 19 drafts. Quiz questions, answer options, explanations, and only verifiable answer keys are supported.",
        "[x] The composed import manifest validates with SHA-256 0e1f53311b4635a7ed2969ff5bf6e2b038781eeb3126a958e3aaea82633f1aee.",
        "[x] Source course percentages are preserved as an aggregate floor; the import does not fabricate lesson completions, reaction identities, or RSVP identities.",
    ], compact=True)
    pdf.section("Production import steps")
    pdf.checklist([
        "[ ] Create the client owner in Supabase, copy the owner organization UUID into the ignored manifest, and validate it again.",
        "[ ] Run academy:access-audit. Require 60 unique login emails, 49 enrolled members, zero duplicates, and allEnrolledCanLogin:true.",
        "[ ] Invoke academy-import with commit:false. Match every returned count to the private report before allowing a write.",
        "[ ] Invoke academy-import with commit:true once. Re-run it to prove provider IDs make the operation idempotent.",
        "[ ] Open at least three lessons, posts, comments, events, member profiles, assets, and enrollment states in both HighLevel and the native app.",
        "[ ] Confirm ownership and long-term availability for every Filesafe, image, video, PDF, certificate, and download URL. Copy owned assets to private storage when permitted.",
    ], compact=True)
    pdf.section("Import sequence")
    pdf.command(
        "npm run academy:access-audit\nacademy-import { commit:false }     -> reconcile counts\nacademy-import { commit:true }      -> idempotent import\nmember access preview/provision     -> readiness, no email"
    )
    pdf.checklist([
        "[ ] Provision until all 60 current members report allEligibleReady:true and all 49 enrollments are linked. Accounts use Magic Links; passwords do not migrate.",
        "[ ] Prove a source member can sign in and an unknown email cannot create an account. Test owner, admin, moderator, active, cancelled, suspended, and unassigned access.",
    ], compact=True)
    pdf.gate("Do not commit private manifests, member email addresses, course bodies, or community exports to Git. Keep the archive encrypted and client-owned.")

    pdf.new_page("13:00-14:00", "Activate web payments", "Stripe-hosted checkout grants Supabase access; native apps remain consumption-only")
    pdf.timeline("1:00 PM", "Configure Stripe and prove access", "Billing owner")
    pdf.checklist([
        "[ ] Create a client-owned Stripe account, complete business verification, add Dirty Turf administrators, require MFA, and configure client billing plus recovery ownership.",
        "[ ] In Stripe test mode, create the Academy product and recurring or one-time Price. Do not accept a price or amount from the app browser.",
        "[ ] Insert the Price ID into an inactive academy_billing_plans row, map included courses in academy_billing_plan_courses, verify the community-access choice, then activate the plan.",
        "[ ] Register the stripe-webhook Edge Function for checkout.session.completed, checkout.session.async_payment_succeeded, and subscription created, updated, and deleted events.",
        "[ ] Configure the Stripe Customer Portal and a web Payment Link. Redirect successful payment to https://YOUR_APP_DOMAIN/?checkout=success and set VITE_STRIPE_ACADEMY_PAYMENT_LINK in Netlify.",
        "[ ] Complete an authenticated web Checkout. Verify customer, subscription/payment, access grant, course enrollment, and processed integration event rows.",
        "[ ] Complete a Payment Link purchase with a new email. Verify Supabase silently creates the confirmed account, member, provisioned invite, and grants; then sign in through Magic Link.",
        "[ ] Replay the same webhook and prove it is idempotent. Force one processing failure and prove the unprocessed event retries instead of being discarded.",
        "[ ] Cancel a Stripe-only test member and confirm access is removed at the intended time. Cancel a Stripe record for an imported member and confirm the separate HighLevel import grant preserves access.",
        "[ ] Open Billing Portal on the web. Confirm the iOS and Android bundles show no purchase button or external checkout link and only consume access bought elsewhere.",
    ], compact=True)
    pdf.section("Billing acceptance")
    pdf.signoff_row("Test Checkout and Payment Link")
    pdf.signoff_row("Webhook replay and recovery")
    pdf.signoff_row("Grant and cancellation rules")
    pdf.signoff_row("Native consumption-only review")
    pdf.gate("Do not switch Stripe to live mode until test checkout, Magic Link access, cancellation, webhook retry, and imported-member preservation all pass.")

    pdf.new_page("14:00-15:30", "Field tools and real devices", "The calculator is verified; ARKit, ARCore, map accuracy, persistence, and failure states need field proof")
    pdf.timeline("1:00 PM", "Run the measured-yard test", "Field QA owner")
    pdf.checklist([
        "[x] Manual mode accepts length and width, calculates area correctly, and preserves decimal precision before display rounding.",
        "[x] Application rate is a dropdown from 0.25 through 3.00 lb/sq ft. Bag price, bag coverage, cleaning plan, and property name are removed from the calculator.",
        "[x] Total pounds equals exact area times selected rate; 40-lb and 50-lb bag counts round upward independently; customer price uses charge per sq ft.",
        "[x] Native iOS ARKit and Android ARCore point-placement bridges are implemented, and map tracing remains a separate measurement path.",
        "[ ] On a supported iPhone, place at least four live AR points around a tape-measured yard, undo one point, finish, and compare area plus perimeter.",
        "[ ] Repeat on a supported Samsung/Android phone using ARCore. Record model, OS, tracking quality, measured area, and error percentage.",
        "[ ] Trace the same yard on the map, test multiple turf polygons, and verify the combined area against the known reference.",
        "[ ] Deny camera and location permissions; test unsupported AR hardware, tracking loss, rotation, background/resume, offline mode, and duplicate save protection.",
        "[ ] Save a calculation with photos, refresh, sign in on a second device, and confirm exact area, rate, pounds, both bag counts, price, method, date, and history.",
    ], compact=True)
    pdf.section("Reference calculation")
    pdf.command(
        "20 ft x 18 ft                         = 360 sq ft\n360 sq ft x 0.50 lb/sq ft             = 180 lb\nceil(180 / 40) / ceil(180 / 50)        = 5 / 4 bags\n360 sq ft x $0.72/sq ft                = $259.20"
    )
    pdf.gate("Live camera measurement is not approved by a simulator build. It must place real points and match a tape-measured job on both mobile platforms.")

    pdf.new_page("15:30-17:00", "Web release and production QA", "Commit the reviewed code, deploy through GitHub and Netlify, then verify production independently")
    pdf.timeline("3:30 PM", "Ship the web release", "Release owner")
    pdf.command("npm run check\nnpm run academy:access-audit\nnpm run academy:validate -- output/private/dirty-turf-academy-import.json\nnpm run native:sync\ngit diff --check\ngit status --short")
    pdf.checklist([
        "[ ] Run a secret scan and confirm .env.local plus output/private remain ignored. Review the complete diff before commit.",
        "[ ] Push the release branch, open or update the pull request, require checks, merge to main, and record the commit SHA.",
        "[ ] Set VITE_SUPABASE_URL, the Supabase publishable key, and the public buy.stripe.com Payment Link in Netlify. Keep service-role, HighLevel, and Stripe secret keys in server-side Supabase settings.",
        "[ ] Deploy a Netlify preview first. Verify SPA routes, auth callbacks, manifest/service worker, icons, security headers, and no stale duplicate site is receiving production traffic.",
        "[ ] Verify 320, 360, 390, and 430 px widths plus landscape, tablet, and desktop. Check calculator keyboard behavior, safe areas, bottom navigation, long lesson content, quizzes, community, and events.",
        "[ ] Deploy production and re-run sign-in, Academy, lesson progress, quiz, post, comment, reaction, bookmark, event RSVP, calculator save, photo, history, Checkout, webhook, and Billing Portal flows.",
        "[ ] Inspect production console and network errors. Confirm no private token, member archive, service-role key, or source export is downloadable.",
        "[ ] Record Netlify deploy ID, Supabase migration and function versions, production URL, smoke-test account, rollback owner, and rollback steps.",
    ], compact=True)
    pdf.section("Production acceptance")
    pdf.signoff_row("GitHub checks and merge")
    pdf.signoff_row("Netlify preview and production smoke")
    pdf.signoff_row("Supabase logs clean")
    pdf.gate("A successful build or deploy status is not production proof. Repeat the golden path on the deployed URL with an authenticated client test account.")

    pdf.new_page("17:00-18:30", "Mobile stores and cutover", "Create signed test builds, invite a small cohort, and keep a reversible HighLevel handoff")
    pdf.timeline("5:00 PM", "Build, invite, and cut over", "Product owner")
    pdf.checklist([
        "[ ] In Xcode, confirm bundle ID, Dirty Turf team, automatic signing, iOS 15 minimum, icons, splash, camera/location descriptions, and archive a Release build to TestFlight.",
        "[ ] In Android Studio, confirm application ID, version code/name, signing key ownership, icons, permissions, privacy declarations, and create a signed AAB for Internal testing.",
        "[ ] Add store name, description, category, screenshots, privacy policy, support URL, account-deletion URL, reviewer login, data-safety/privacy answers, and content-rating responses.",
        "[ ] Test install, update, deep link, magic link, logout, expired/reused links, camera, location, photo upload, map, lesson, community, and notification behavior on physical devices.",
        "[ ] Verify store-review builds are consumption-only: no native purchase CTA or web checkout link. Supply a reviewer account with pre-existing Academy access.",
        "[ ] Require the access preview to show all 60 current members ready and all 49 enrollments linked. Notify a 3-5 person pilot, verify delivery and entitlements, then notify remaining members in batches of at most 25.",
        "[ ] Freeze HighLevel content changes, take one final delta capture, re-run the import dry run, reconcile counts, and commit the approved delta import.",
        "[ ] Keep HighLevel read-only as the rollback source until Dirty Turf approves the native archive, member access, and production behavior. Retain the encrypted export independently.",
        "[ ] Monitor authentication, invite failures, Edge Function errors, database errors, app crashes, and member support during the first 24 hours.",
    ], compact=True)
    pdf.section("Final cutover order")
    pdf.paragraph("1. Freeze GHL.  2. Capture delta.  3. Validate.  4. Dry run.  5. Commit import.  6. Provision all accounts.  7. Pilot links.  8. Notify remaining members.  9. Production smoke.  10. Client approval.", width_chars=94, size=8.4, leading=11)
    pdf.section("Final sign-off")
    pdf.signoff_row("Content and member reconciliation")
    pdf.signoff_row("Security, privacy, and ownership")
    pdf.signoff_row("iPhone and Android field workflow")
    pdf.signoff_row("Web production and store test builds")
    pdf.signoff_row("Cutover and rollback approval")
    pdf.gate("Launch only when every sign-off has an owner, timestamp, evidence link, and explicit pass. Otherwise keep HighLevel live and the native app in labeled pilot mode.")

    pdf.finish()
    print(OUTPUT)


if __name__ == "__main__":
    build_pdf()
