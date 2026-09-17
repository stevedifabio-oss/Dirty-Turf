# HighLevel Live Integration and Native Migration Plan

## Decision

HighLevel remains the production source of truth for the Dirty Turf Academy and the `7 Figure Turf Cleaning` community. The web app owns field operations: live measurement, map tracing, property history, photos, estimates, and quoting.

The Academy, Community, and Events tabs launch the branded portal at `https://academy.dirtyturf.com`. HighLevel renders normally as a top-level destination but not reliably inside a cross-origin iframe, so the app uses explicit deep links. A member without a valid portal session receives the normal HighLevel login. A trusted `sessionKey` is held in memory only, removed from the app address bar, and forwarded only to the Academy origin.

The native Academy/community code and database model remain migration targets. They are not a second live feed while HighLevel is authoritative.

## Verified Inventory

| Item | Current evidence | Extraction path |
| --- | --- | --- |
| HighLevel location | Dirty Turf; API access validated | Private integration, server-side only |
| CRM contacts | 10,568 location contacts reported by API | Contacts API or admin CSV export |
| Community | `7 Figure Turf Cleaning`; private and paid | Branded portal plus admin inventory |
| Community activity | 58 members and 61 posts in the supplied portal screenshot | Group-filtered contact export plus content capture |
| Community areas | Discussion, Learning, Events, Leaderboards, Members, About | Admin inventory and capture |
| Courses | Existing content in the GHL course library | Authenticated admin content inventory |
| Pipelines | 4 accessible | HighLevel API |
| Workflows | 34 accessible | HighLevel API |
| Offers | Two supplied share IDs, labels not yet verified | Confirm names, prices, access, and audience in GHL |

Do not treat all 10,568 CRM contacts as Academy members. Export the exact community group membership.

## API Boundary

The supported HighLevel API can read contacts, pipelines, workflows, products, and related CRM data. Current public scopes expose a course import endpoint but no supported course catalog read/export endpoint. No supported public endpoints were found for community posts, comments, reactions, channels, member progress, leaderboards, or community events.

That creates three extraction lanes:

1. **API:** contacts and CRM metadata.
2. **Admin export:** community members through Contacts > Smart Lists > Client Portal > Groups = `7 Figure Turf Cleaning`, then CSV export.
3. **Authenticated content capture:** courses, modules, lessons, resources, videos, posts, comments, reactions, channels, events, progress, roles, and leaderboard state. Capture only with client authorization and a client-owned admin session.

## Tomorrow's Capture Package

Store exports in client-owned encrypted storage, never in Git.

### Members

- Filter the contact list to the exact community group.
- Include contact ID, name, email, phone, tags, custom fields, group access, offer access, status, and creation date.
- Export the CSV and record its SHA-256 hash in the import manifest.
- Reconcile the export count with the portal member count before importing.

### Courses

- Course ID, title, description, image, instructor, status, price/access rule, and order.
- Module ID, title, order, and drip schedule.
- Lesson ID, title, type, body, video source, transcript, duration, resources, downloadable files, and order.
- Enrollment, completion, progress, certificates, and access exceptions by member where available.

### Community

- Group ID, name, description, privacy/payment state, branding, rules, and membership questions.
- Channels/categories with IDs, permissions, and order.
- Posts and comments with original IDs, parent relationships, authors, timestamps, edits, pins, reactions, mentions, attachments, and source URLs.
- Members with roles, join dates, points, levels, leaderboard state, bans/suspensions, and last-seen data where available.
- Events with hosts, time zones, recurrence, descriptions, meeting links, visibility, RSVP state, recordings, and attachments.

## Import Contract

Every captured record enters `source_import_records` before it reaches a native table. Preserve:

- Provider and external ID
- Parent external ID
- Original source URL
- Source creation and update timestamps
- Canonical payload
- SHA-256 content hash
- Import batch and final native record mapping

An import is idempotent: rerunning the same batch must not create duplicate members, courses, lessons, posts, comments, events, or progress.

## Native Cutover Gates

1. All Academy members map to one shared Academy community while each company's field records remain isolated in its own organization.
2. Course, module, lesson, post, comment, member, event, and progress counts reconcile with the final GHL archive.
3. A sample of rich text, videos, files, comments, reactions, timestamps, pins, roles, progress, and access rules matches the source.
4. Native auth and entitlements are proven for active, cancelled, suspended, admin, moderator, and trial members.
5. Dual-run changes are frozen, a final delta capture is imported, and rollback links back to the read-only GHL portal remain available.
6. HighLevel is retired only after written content-owner approval and a retained client-owned archive.

## Security Rules

- Never place a HighLevel private token or Supabase service-role key in a `VITE_` variable.
- Never persist `sessionKey`, include it in analytics, or put it in logs.
- Never commit contact exports, course assets, community archives, or member PII.
- Rotate any password or session token exposed in screenshots before production.
- Use client-owned accounts, billing, recovery, storage, and administrator access for every production service.
