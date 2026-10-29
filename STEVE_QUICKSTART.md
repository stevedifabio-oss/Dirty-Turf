# Steve's Dirty Turf Academy quickstart

Use https://github.com/stevedifabio-oss/Dirty-Turf, branch **`main`**. The complete handoff was merged through [PR #41](https://github.com/stevedifabio-oss/Dirty-Turf/pull/41), and the verified web changes are published at https://app.dirtyturf.com.

Use your own GitHub and Codex accounts. You do not need to connect them to Ty's accounts or give Ty access. The original handoff branch, `codex/steve-maintenance-handoff-20261029`, remains a historical source snapshot; start new work from current canonical `main` in a new branch.

Read [the release tracker](RELEASE_TRACKER.md) for the tested source, publication state, and queued mobile batch.

## Open it in your own Codex

On your computer, clone the canonical repository once. Its public source can be read without linking anyone's accounts; publishing uses your own authorized GitHub access.

```sh
git clone https://github.com/stevedifabio-oss/Dirty-Turf.git
cd Dirty-Turf
git switch main
```

Open that folder as a project in Codex. If you already have a checkout, ask Codex to inspect its branch and local changes first; do not replace existing work to follow these commands.

You can paste this into your own Codex:

> Open https://github.com/stevedifabio-oss/Dirty-Turf on current main. Read AGENTS.md, STEVE_QUICKSTART.md, and RELEASE_TRACKER.md. Preserve existing changes, verify the Node 22 setup, install locked dependencies, and start the local preview. Tell me how to open it and identify any missing access. This setup task does not publish changes or start a mobile release.

Use Node **22.12 or later within Node 22**, matching GitHub CI. Then:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, normally **http://localhost:5173**. If the port is busy, use the printed URL. A supported cloud Codex environment may expose the running port through its preview UI; otherwise use a local Codex project. A GitHub connection alone does not install Node or start a preview.

With **no `.env.local`**, this is the existing device-preview mode. Accept the community Terms screen to explore the sample workspace. Sample changes persist in that browser only. It is suitable for layout work; it does not prove real member login, permissions, saved cloud data, payments, or email delivery.

## Connect the real backend only when needed

Steve needs access to the existing Dirty Turf Supabase project. Put only these **public client values** in an ignored `.env.local`, using the values from that project's API settings:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLIC_PUBLISHABLE_KEY
```

Restart the preview after changing environment values. A configured preview connects to the real backend: use an approved test account and avoid changing member data during setup. Existing member provisioning/access rules still apply; a GitHub login does not grant Academy access. If local sign-in redirects are not allowed, have the project owner review the existing Auth redirect configuration before changing it.

Do not copy server keys from `.env.example` into browser configuration. Stripe, Mailgun, GHL, service-role, APNs/FCM credentials and signing passwords belong in the established protected provider/key storage. No API key for Codex is required by this application's preview.

## Make and verify a change

Tell Codex what you want in plain English. For example: “Make the lesson buttons easier to tap on phones. Use shared code, preserve current work, show the preview, and run the relevant checks.”

```sh
npm run check
```

This covers secret patterns, schema contracts, store metadata, TypeScript, unit tests, production build, and PWA checks. Database behavior has separate isolated SQL harnesses; see [handoff verification](docs/handoff-verification-20261029.md). Native/device checks are additional. `npm run build` followed by `npm run preview` serves the built web output, normally at http://localhost:4173.

## Publish the website

Ask Codex to make **and publish** the web change. It should create a reviewable branch/PR, pass GitHub CI and the applicable preview checks, then merge to canonical `main` under your authorization. Netlify builds `npm run build` and publishes `dist` to **https://app.dirtyturf.com**. Confirm the successful Netlify deploy, its Git commit, and the live behavior.

You need your own GitHub **write/merge** access and access to the existing Netlify project (`bright-brigadeiros-df8b48`). Do not create a replacement site or use a manual upload to bypass repository access. Start each subsequent change from updated `main` in a new branch.

## iPhone and Android

The phone apps bundle the shared frontend. **Publishing the website does not update installed phone apps.** Existing server-fed lessons/posts can update independently; preserve compatibility with older app binaries.

Keep small mobile improvements in the tracker and release them together. When you request a mobile release, Codex should verify current store state and unused version/build numbers, finish the batch, build/sign and test the actual candidates, prepare notes/reviewer evidence, then carry out only authorized store actions. **Apple and Google review separately.** Uploading, internal testing, submitting for review, approval, and public availability are different steps.

For local native development:

```sh
npm run native:verify
npm run native:ios
# or
npm run native:android
```

`native:verify` rebuilds and syncs both native projects. iPhone work needs a Mac with full Xcode, the existing Dirty Turf Apple Developer team (`Z36XF6NX6G`), App Store Connect access, and valid signing/provisioning on your machine. Android needs Android Studio/SDK and **JDK 21**, Play Console access, and the **existing client-owned upload key** from protected storage. Never generate a replacement upload key casually or commit signing material. Push credentials/capabilities are a separate held setup; ordinary UI work does not need them.

See [native build evidence and remaining acceptance](docs/native-handoff-evidence-20261029.md) before treating a candidate as release-ready. Adding these handoff files does not submit anything to either store.
