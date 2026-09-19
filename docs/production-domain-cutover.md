# Production domain cutover

## Domain decision

- Permanent web app: `https://app.dirtyturf.com`
- Current pilot: `https://bright-brigadeiros-df8b48.netlify.app`
- Legacy GHL Academy: `https://academy.dirtyturf.com`
- Native email bridge: `https://app.dirtyturf.com/mobile-auth-callback.html`
- Installed-app callback: `com.dirtyturf.academy://auth/callback`

Keep the GHL Academy live until the native import, representative member
logins, billing, production smoke tests, and rollback checks pass. The web app
and native apps share Supabase. Native Magic Links return to the HTTPS bridge,
then an explicit Open App action launches the registered custom callback. This
avoids email and embedded-browser blocks on automatic custom-scheme redirects.

## Current verified state

- Supabase allows `https://app.dirtyturf.com/**` as an Auth redirect.
- The Supabase Auth Site URL and Edge Function `APP_URL` are set to
  `https://app.dirtyturf.com`.
- Netlify ownership, Cloudflare routing, TLS, and HTTP-to-HTTPS redirect pass.
- `app.dirtyturf.com` is the Netlify production origin. Production deploy
  `6aad92da88497700081bd70a` contains merge commit `3b51728afb910e6e08e2cfbc99e541a2eefdb805`.
- The production smoke gate passes the app shell, privacy, support, deletion,
  manifest, service worker, SPA fallback, HTTP redirect, and security headers.
- Supabase Auth custom SMTP is saved with the existing Mailgun sender
  `hello@mail.dirtyturf.com` through `smtp.mailgun.org:465`.
- Public DNS confirms Mailgun MX and SPF records for `mail.dirtyturf.com` and a
  DMARC record for `_dmarc.mail.dirtyturf.com`. Mailgun still needs to show DKIM
  healthy before the member pilot.
- Supabase Edge Functions allow both the production and pilot web origins.
- The Edge Function secret audit currently shows only `APP_URL`,
  `APP_ALLOWED_ORIGINS`, and `AUTH_REDIRECT_URLS`. Mailgun API and notification
  signing/dispatch secrets still need to be added before community email can
  be sent.
- The legacy GHL Academy remains available until representative member login,
  billing, real-phone measurement, and rollback acceptance pass.

## Activation sequence

1. The unauthenticated production smoke is complete. Retain
   `output/private/production-smoke.json` with the private release evidence and
   repeat it after any app-shell, header, legal-page, or domain change.
2. The Supabase Auth Site URL and Edge Function `APP_URL` are set to
   `https://app.dirtyturf.com`. Reconfirm both after any project clone or
   environment reset.
3. Keep these Supabase redirect URLs during the pilot:
   - `https://app.dirtyturf.com/**`
   - `https://bright-brigadeiros-df8b48.netlify.app/**`
   - `http://localhost:5173/**`
   - `http://127.0.0.1:5173/**`
   - `https://app.dirtyturf.com/mobile-auth-callback.html`
   - `com.dirtyturf.academy://auth/callback`
4. Confirm Edge Function configuration:
   - `APP_URL=https://app.dirtyturf.com`
   - `APP_ALLOWED_ORIGINS=https://app.dirtyturf.com,https://bright-brigadeiros-df8b48.netlify.app`
   - `AUTH_REDIRECT_URLS=https://bright-brigadeiros-df8b48.netlify.app,com.dirtyturf.academy://auth/callback`
5. Confirm Mailgun DKIM is healthy, disable click tracking for Auth messages,
   and complete one internal delivery test.
6. Test one provisioned member on production web, iPhone, and Android before
   any broad member notification.
7. Remove the Netlify pilot origin from the Edge Function allowlists only
    after production authentication and rollback evidence pass.

## Rollback

If the custom domain fails, leave Supabase data and accounts untouched, restore
the Netlify pilot origin as the Auth Site URL, stop member notifications, and
keep GHL available. Do not delete imported users or rewrite provider IDs.
