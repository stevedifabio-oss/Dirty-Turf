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
TOTAL_PAGES = 7


class ChecklistPDF:
    def __init__(self, output: Path):
        output.parent.mkdir(parents=True, exist_ok=True)
        self.c = canvas.Canvas(str(output), pagesize=letter)
        self.c.setTitle("Dirty Turf Functional App - Tomorrow Implementation Checklist")
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
            lines = wrap(item, width=max_chars)
            item_h = max(22, len(lines) * leading + 8)
            if self.y - item_h < 50:
                raise RuntimeError("Checklist content overflowed a page")
            self.c.setStrokeColor(GREEN)
            self.c.setLineWidth(1)
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

    pdf.new_page("Tomorrow launch plan", "Functional app checklist", "Academy, community, field tools, quoting, history, and integrations")
    pdf.section("Tomorrow's finish line", "Definition of done")
    pdf.paragraph(
        "By end of day, an authenticated company operator can measure and quote a property, retrieve visit history, launch the live HighLevel course library and community from the app, and send a verified result into HighLevel. Native community migration remains staged until a complete client-owned archive is validated."
    )
    col_w = (PAGE_W - 2 * MARGIN - 12) / 2
    y1 = pdf.card("FIELD WORKSPACE", "Supabase Auth + RLS, company records, property visits, measurements, estimates, and private photo storage.", GREEN, col_w, 82, MARGIN)
    pdf.card("OPERATOR EXPERIENCE", "Mobile-first React app with measurement, quoting, and verified deep links to the live branded Academy and community.", LIME, col_w, 82, MARGIN + col_w + 12)
    pdf.y = y1 - 14
    y2 = pdf.card("CONTENT + CRM", "GoHighLevel stays live for courses, community, members, and access; Supabase receives field records and migration staging.", ORANGE, col_w, 82, MARGIN)
    pdf.card("DELIVERY", "Netlify hosts the web app; Supabase runs database, storage, auth, realtime, and signed Edge Functions.", GREEN_DARK, col_w, 82, MARGIN + col_w + 12)
    pdf.y = y2 - 18
    pdf.section("Launch gates")
    pdf.checklist([
        "Production operator can sign in by magic link and reaches only the correct company workspace.",
        "A measured property saves area, cleaning plan, infill count, quote, visit date, and private photos.",
        "Live GHL courses, community, and events open from the app after login through the verified Academy deep links.",
        "A second-company test account cannot read the first company's properties, estimates, photos, or storage; both may join the shared Academy community.",
        "Leaflet property tracing matches a known reference area within the agreed field tolerance across current and historical imagery.",
        "A real HighLevel test contact enters the intended workflow and the expected notification is received.",
    ], compact=True)
    pdf.gate("Do not call the app functional based only on local device mode, seeded examples, or a 200 response from a mocked webhook.")

    pdf.new_page("08:00-09:00", "Client accounts and ownership", "Create a clean client-controlled boundary before wiring the product")
    pdf.timeline("8:00 AM", "Confirm client-owned account access", "Client + product owner")
    pdf.checklist([
        "Create or confirm a client-owned administrative identity with client-controlled recovery and multi-factor authentication. Do not use personal browser or CLI sessions.",
        "Confirm the connected Supabase project is inside a client-owned organization; record project ref, region, client admin, and recovery owner.",
        "Confirm the connected GitHub repository and Netlify site are client-owned; record deploy owner and rollback owner. Archive duplicate Netlify projects only after the active site is identified.",
        "Create client-owned Apple Developer and Google Play organization accounts only if native AR builds are in tomorrow's release scope.",
        "Rotate the exposed HighLevel credential and create client-owned least-privilege integration access for the exact location, workflow, pipeline, tags, and custom fields.",
        "If paid membership launches now, create a client-owned Stripe account and products. Otherwise keep billing disabled and name the later owner.",
        "Use a password manager for all credentials. Do not place service-role or HighLevel private tokens in VITE_ variables.",
    ], compact=True)
    pdf.section("Environment matrix")
    pdf.command(
        "# Browser-safe (Netlify)\nVITE_SUPABASE_URL=...\nVITE_SUPABASE_PUBLISHABLE_KEY=...\n\n# Server-only (Supabase secrets)\nSUPABASE_SERVICE_ROLE_KEY=...\nGHL_PRIVATE_INTEGRATION_TOKEN=...\nGHL_LOCATION_ID=...\nAPP_URL=...  STRIPE_SECRET_KEY=...  STRIPE_WEBHOOK_SECRET=..."
    )
    pdf.checklist([
        "Confirm production attribution, traffic limits, and usage terms for Esri, USGS NAIP, OpenStreetMap tiles, and the selected address geocoder.",
        "Create a least-privilege HighLevel private integration with only the scopes required for contacts, opportunities, custom fields, and workflows.",
        "Add production and localhost auth redirect URLs in Supabase Auth settings.",
        "Use a clean client browser profile and client-owned CLI login. Never authenticate these services with the consultant's personal credentials.",
    ], compact=True)
    pdf.gate("Every account is client-owned, every secret has a named client owner and rotation path, and no personal credential or billing profile is attached.")

    pdf.new_page("09:00-11:00", "Supabase data foundation", "Apply the schema, secure tenancy, and prove private storage")
    pdf.timeline("9:00 AM", "Link, migrate, and deploy", "Backend owner")
    pdf.command(
        "npm install\nnpx supabase login\nnpx supabase link --project-ref <PROJECT_REF>\nnpx supabase db push\nnpx supabase secrets set --env-file .env.supabase\nnpx supabase functions deploy health\nnpx supabase functions deploy ghl-webhook\nnpx supabase functions deploy create-checkout\nnpx supabase functions deploy stripe-webhook"
    )
    pdf.checklist([
        "Confirm all migrations applied: private field records plus shared Academy membership, source import batches, provenance records, and future native content structures.",
        "Create the first production user. Verify the signup trigger creates a profile, organization, and owner membership.",
        "Create two test companies and two test operators. Verify each can create and read only its own properties, visits, estimates, and photos while both can access the shared Academy membership surface.",
        "Attempt a direct REST read using company B's session for company A's record. Expect zero rows or permission denied.",
        "Upload a photo beneath org_id/user_id/job_id. Verify it is not public and is retrievable only through an authorized signed URL.",
        "Call the health Edge Function from the deployed URL and record the timestamp and 200 response.",
        "Enable database backups and confirm the restore procedure and retention window appropriate for production.",
    ], compact=True)
    pdf.section("Data acceptance record")
    pdf.signoff_row("Migration applied")
    pdf.signoff_row("Cross-tenant RLS denied")
    pdf.signoff_row("Private photo access proven")
    pdf.gate("Do not continue to launch if service-role keys appear in the browser bundle or if any cross-company record is readable.")

    pdf.new_page("11:00-13:00", "Measurement, photos, and quoting", "Turn the prototype controls into a reliable field workflow")
    pdf.timeline("11:00 AM", "Wire the mobile job flow", "Frontend owner")
    pdf.checklist([
        "Add the sign-in screen and session recovery. Route unauthenticated users to magic-link sign in and authenticated users to their workspace.",
        "Ship client-owned iOS and Android app shells. Implement the live point workflow with ARKit raycasts on iPhone and ARCore hit tests on supported Android devices.",
        "Return a closed 3D boundary, square feet, perimeter, point list, and timestamp through the DirtyTurfMeasure bridge. Never infer world distance from ordinary camera pixels.",
        "Verify the integrated Leaflet trace on current Esri, USGS NAIP, Esri Wayback, and street imagery; test multiple separate turf areas and combined square feet.",
        "Keep camera, map, and manual entry as equal measurement paths. Capture visit photos separately and show which method produced the saved area.",
        "Persist property, visit, measurement, selected cleaning plan, infill settings, estimate lines, and estimate total through the provided Supabase RPC.",
        "Load the property timeline by year so operators can compare prior visit photos and measurements.",
        "Add loading, empty, permission-denied, offline, and retry states. Keep device mode clearly labeled whenever cloud configuration is absent.",
    ], compact=True)
    pdf.section("Quote reference tests")
    pdf.command(
        "684 sq ft + Premium + 10 bags  =>  $687\n800 sq ft + Premium + 12 bags  =>  $831\n100 sq ft + Quick + 2 bags      =>  $219 minimum-driven\nZero/invalid dimensions          =>  safe zero values, never NaN"
    )
    pdf.checklist([
        "Test 390 x 844, 430 x 932, tablet portrait, and desktop widths with real keyboard and safe-area behavior.",
        "Compare ARKit, ARCore, and one map polygon against tape-measured reference areas; document tolerance by method and device.",
        "Test unsupported AR hardware, denied camera permission, tracking loss, failed photo upload, rotation, back navigation, and duplicate saves.",
    ], compact=True)
    pdf.gate("A saved quote must survive refresh and sign-in on a second device, with the same area, plan, bag count, amount, photos, and history.")

    pdf.new_page("13:00-15:00", "Live GHL and migration archive", "Launch on the existing portal and preserve every record for the future rebuild")
    pdf.timeline("1:00 PM", "Connect and inventory the live systems", "Product + integration")
    pdf.section("Live member experience")
    pdf.checklist([
        "Verify the Dirty Turf Academy launcher opens courses/library-v2 and the 7 Figure Turf Cleaning launcher opens the live community after login.",
        "Verify logout/login, password reset, expired session, second-device access, mobile scrolling, downloads, video playback, and event links from the app launch surfaces.",
        "Keep GHL authoritative for course progress, posts, comments, reactions, events, leaderboards, members, moderation, and paid access during this launch.",
        "Confirm the two supplied offer/share links by name, price, trial, included course/group access, billing owner, and cancellation behavior before exposing either in the app.",
        "Use a client-owned admin account to filter Contacts by Client Portal > Groups = 7 Figure Turf Cleaning and export exactly those members with the required columns.",
        "Record course, module, lesson, post, comment, channel, member, event, progress, role, and asset counts in the migration manifest. Do not put exports or member PII in Git.",
    ], compact=True)
    pdf.section("Future native rebuild archive")
    pdf.checklist([
        "Capture original IDs, parent IDs, source URLs, authors, timestamps, edits, order, permissions, access rules, and SHA-256 hashes for every exported record.",
        "Inventory course bodies, videos, transcripts, downloads, drip schedules, enrollment, completion, certificates, and member-specific access exceptions.",
        "Inventory community channels, posts, comments, reactions, attachments, pins, mentions, roles, join dates, levels, points, events, RSVPs, recordings, and moderation state.",
        "Load captures into source_import_batches and source_import_records first. Reconcile counts and sample content before promoting any record into the native tables.",
    ], compact=True)
    pdf.section("Archive acceptance")
    pdf.signoff_row("Group member count reconciled")
    pdf.signoff_row("Course and community counts reconciled")
    pdf.signoff_row("Encrypted client-owned archive recorded")
    pdf.gate("Do not begin native cutover from a partial capture or an undocumented endpoint. Keep the live HighLevel portal authoritative until the archive is approved.")
    pdf.new_page("14:30-15:30", "HighLevel delivery proof", "Rotate the exposed credential, connect server-side, and verify the real workflow")
    pdf.timeline("2:30 PM", "Prove the CRM path", "Integration owner")
    pdf.section("Credential and account boundary")
    pdf.checklist([
        "Rotate the exposed private integration token in the client HighLevel location. Store the replacement only as a Supabase server secret.",
        "Run npm run ghl:verify without printing the token. Record the verified location plus expected pipeline and workflow access.",
        "Keep the HighLevel token and Supabase service-role key out of VITE variables, browser storage, client logs, screenshots, and Git.",
    ], compact=True)
    pdf.section("HighLevel event path")
    pdf.command(
        "Webhook URL:\nhttps://<PROJECT_REF>.supabase.co/functions/v1/ghl-webhook\n\nRequired proof:\nSigned event -> integration_events -> contact/opportunity -> workflow -> notification"
    )
    pdf.checklist([
        "Configure HighLevel to use the current signed webhook flow. Confirm the Edge Function rejects missing or invalid X-GHL-Signature values.",
        "Map operator, property, square footage, cleaning plan, infill bags, quote amount, estimate ID, and source URL to named HighLevel fields.",
        "Create one clearly labeled fictional end-to-end test lead. Submit it from production and record contact ID, opportunity stage, workflow entry, tags, assigned user, and notification receipt.",
        "Replay the same webhook ID. Confirm integration_events deduplication prevents duplicate downstream work.",
        "Document retry ownership for 4xx, 5xx, signature failures, expired tokens, and HighLevel rate limits.",
    ], compact=True)
    pdf.gate("A webhook log alone is not success. The real HighLevel contact, workflow entry, assignment, and expected human notification must all be verified.")

    pdf.new_page("15:30-17:30", "Production QA and launch", "Prove the complete path, deploy once, and keep a rollback path")
    pdf.timeline("3:30 PM", "Run the release gate", "Release owner")
    pdf.command("npm run check\nnpm audit --omit=dev\nnpx supabase functions logs ghl-webhook --project-ref <PROJECT_REF>")
    pdf.checklist([
        "Run typecheck, all quote and map tests, production build, and dependency audit with zero failures. Inspect the browser bundle for server-only secret values.",
        "Deploy a Netlify preview. Verify auth redirects, security headers, SPA routing, logo/font assets, and environment variables.",
        "Complete the golden path on real iPhone and Android devices: sign in, measure, attach photo, quote, save, reopen history, then open a live GHL lesson, post, member directory, and event.",
        "Verify screen-reader labels, visible focus, 44px touch targets, color contrast, keyboard completion, and reduced-motion behavior.",
        "Use a production test account to verify tenant isolation, signed photo access, imagery attribution and geocoder limits, HighLevel delivery, and live notification receipt.",
        "Capture the deploy ID, database migration version, Edge Function versions, smoke-test evidence, and named rollback owner.",
        "Deploy production. Repeat the golden path against the production URL, then monitor browser errors and Edge Function failures for 30 minutes.",
    ], compact=True)
    pdf.section("Final sign-off")
    pdf.signoff_row("Product and brand")
    pdf.signoff_row("Data security and privacy")
    pdf.signoff_row("Field workflow")
    pdf.signoff_row("HighLevel delivery")
    pdf.signoff_row("Production and rollback")
    pdf.gate("Launch only when every sign-off has an owner, timestamp, evidence link, and explicit pass. Otherwise keep the app in labeled preview mode.")

    pdf.finish()
    print(OUTPUT)


if __name__ == "__main__":
    build_pdf()
