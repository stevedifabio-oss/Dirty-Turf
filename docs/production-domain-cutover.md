# Production domain cutover

## Domain decision

- Permanent web app: `https://app.dirtyturf.com`
- Current pilot: `https://bright-brigadeiros-df8b48.netlify.app`
- Legacy GHL Academy: `https://academy.dirtyturf.com`
- Native callback: `com.dirtyturf.academy://auth/callback`

Keep the GHL Academy live until the native import, representative member
logins, billing, production smoke tests, and rollback checks pass. The web app
and native apps share Supabase, but native Magic Links continue to use the
custom callback rather than the web origin.

## Current verified state

- Supabase allows `https://app.dirtyturf.com/**` as an Auth redirect.
- Supabase Site URL remains the working Netlify pilot origin until DNS and TLS
  are healthy.
- Netlify has the custom subdomain staged but requires external DNS ownership
  verification.
- Public DNS has no `app.dirtyturf.com` record yet.
- `dirtyturf.com` is authoritative on `peaches.ns.cloudflare.com` and
  `yisroel.ns.cloudflare.com`. The currently signed-in Cloudflare account does
  not expose that zone.

## DNS handoff

In the Cloudflare account that owns `dirtyturf.com`, create these records:

1. TXT host `subdomain-owner-verification` with the current Netlify value
   `a274de0c635882497aea3cc2e0df6f49`.
2. After Netlify accepts ownership, CNAME host `app` pointing to
   `bright-brigadeiros-df8b48.netlify.app`.

Use DNS-only mode for the CNAME while Netlify provisions the certificate. If
Netlify regenerates the ownership challenge, use the value currently displayed
under Domain management rather than the value recorded here.

## Activation sequence

1. Publish the ownership TXT record and confirm it resolves publicly.
2. Finish adding `app.dirtyturf.com` in Netlify Domain management.
3. Publish the `app` CNAME and wait for Netlify to issue TLS.
4. Require `https://app.dirtyturf.com/`, `/privacy.html`, `/support.html`, and
   `/delete-account.html` to return the expected app or legal page over HTTPS.
5. Change the Supabase Auth Site URL from the Netlify pilot origin to
   `https://app.dirtyturf.com`.
6. Keep these Supabase redirect URLs during the pilot:
   - `https://app.dirtyturf.com/**`
   - `https://bright-brigadeiros-df8b48.netlify.app/**`
   - `http://localhost:5173/**`
   - `http://127.0.0.1:5173/**`
   - `com.dirtyturf.academy://auth/callback`
7. Set Edge Function configuration to:
   - `APP_URL=https://app.dirtyturf.com`
   - `APP_ALLOWED_ORIGINS=https://app.dirtyturf.com,https://bright-brigadeiros-df8b48.netlify.app`
   - `AUTH_REDIRECT_URLS=https://bright-brigadeiros-df8b48.netlify.app,com.dirtyturf.academy://auth/callback`
8. Configure the verified Mailgun sender in Supabase SMTP and disable Mailgun
   click tracking for Auth messages.
9. Test one provisioned member on production web, iPhone, and Android before
   any broad member notification.
10. Remove the Netlify pilot origin from the Edge Function allowlists only
    after production authentication and rollback evidence pass.

## Rollback

If the custom domain fails, leave Supabase data and accounts untouched, restore
the Netlify pilot origin as the Auth Site URL, stop member notifications, and
keep GHL available. Do not delete imported users or rewrite provider IDs.
