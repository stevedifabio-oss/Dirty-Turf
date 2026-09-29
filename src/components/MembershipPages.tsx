import type { AccessState } from "../lib/academyAccess";
import { Capacitor } from "@capacitor/core";
import { useBillingAccess } from "../lib/useBillingAccess";
import { planPurchaseState } from "../lib/membershipBilling";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, CreditCard, LockKeyhole, Mail, Users } from "lucide-react";
import { loadAcademyBillingOverview, openAcademyBillingPortal, requestMagicLink, supabase, type AcademyBillingOverview } from "../lib/backend";
import { beginMembershipCheckout, loadMembershipCatalog, membershipPrice, membershipRequestId, type BillingPageRoute, type MembershipCatalog, type MembershipPlan } from "../lib/membershipBilling";
import "./MembershipPages.css";

export function MembershipPages({ route }: { route: BillingPageRoute }) {
  useEffect(() => {
    const before = document.title;
    document.title = `${route === "membership" ? "Membership" : route === "billing" ? "Manage membership" : "Checkout return"} | Dirty Turf Academy`;
    return () => { document.title = before; };
  }, [route]);
  if (Capacitor.isNativePlatform()) return null;
  return <main className="membership-page">
    <header className="membership-header"><a href="/" aria-label="Dirty Turf Academy home"><img src="/dirty-turf-logo.png" alt="Dirty Turf" /></a><a href="/">Member sign in <ArrowRight size={16} /></a></header>
    {route === "membership" ? <MembershipEnrollment /> : route === "return" ? <CheckoutReturn /> : <MembershipManagement />}
    <footer className="membership-footer"><p>Need a hand? <a href="mailto:hello@dirtyturf.com">hello@dirtyturf.com</a></p><nav aria-label="Membership help"><a href="/privacy.html">Privacy</a><a href="/support.html">Support</a><a href="/billing">Manage membership</a></nav></footer>
  </main>;
}

function MembershipEnrollment() {
  const [catalog, setCatalog] = useState<MembershipCatalog | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setCatalog(null); setError("");
    void loadMembershipCatalog().then((value) => { if (active) setCatalog(value); })
      .catch(() => { if (active) setError("We couldn't load membership options. Please try again."); });
    return () => { active = false; };
  }, [retry]);
  const cancelled = new URLSearchParams(window.location.search).get("checkout") === "cancelled";
  return <div className="membership-layout">
    <section className="membership-intro"><p className="kicker">Dirty Turf Academy</p><h1>Build your turf cleaning know-how.</h1><p className="membership-lead">Training, operator conversations, and practical tools in one Academy account.</p>
      <ul className="membership-benefits"><li><BookOpen size={22} /><span><strong>Learn at your pace</strong>Work through course lessons and pick up where you left off.</span></li><li><Users size={22} /><span><strong>Stay connected</strong>Join the Academy community and follow upcoming sessions.</span></li><li><LockKeyhole size={22} /><span><strong>One member account</strong>Use the same email for your existing Academy access across devices.</span></li></ul>
      <p className="membership-existing"><strong>Already a member?</strong> <a href="/">Sign in first</a>. Your existing access stays in place. Sign in to see which upgrades are available.</p>
    </section>
    <section className="membership-panel" aria-label="Membership options">
      {cancelled && <p className="membership-notice" role="status">Checkout wasn't completed. Select the same membership option and use the same email to resume. To change options, wait for that checkout to expire (up to one hour).</p>}
      {error ? <div role="alert"><h2>Let's try that again.</h2><p>{error}</p><button className="secondary-button wide" onClick={() => setRetry((value) => value + 1)}>Reload options</button></div>
        : !catalog ? <p role="status">Loading membership options…</p>
        : !catalog.enabled || catalog.plans.length === 0 ? <><span className="membership-symbol"><BookOpen size={25} /></span><h2>Online enrollment is being prepared.</h2><p>Current members can sign in as usual. For membership questions, contact the Academy team.</p><a className="primary-button wide" href="/">Member sign in <ArrowRight size={17} /></a><a className="membership-contact" href="mailto:hello@dirtyturf.com">Contact the Academy</a></>
        : <EnrollmentForm plans={catalog.plans} />}
    </section>
  </div>;
}

export function EnrollmentForm({ plans, verifiedAccess, verifiedEmail }: { plans: MembershipPlan[]; verifiedAccess?: AccessState; verifiedEmail?: string }) {
  const [selectedId, setSelectedId] = useState(() => { const requested = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("plan") : null; return plans.find((plan) => plan.id === requested && (!verifiedAccess || planPurchaseState(plan, verifiedAccess) === "available"))?.id ?? (verifiedAccess ? plans.find((plan) => planPurchaseState(plan, verifiedAccess) === "available")?.id : plans[0]?.id) ?? ""; });
  const [email, setEmail] = useState(verifiedEmail ?? "");
  const billingAccess = useBillingAccess();
  const access = verifiedAccess ?? billingAccess.access;
  const accountEmail = verifiedEmail ?? billingAccess.accountEmail;
  const refresh = billingAccess.refresh;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const request = useRef<{ key: string; id: string } | null>(null);
  const selected = plans.find((plan) => plan.id === selectedId);
  useEffect(() => { setEmail(accountEmail); }, [accountEmail]);
  const eligibility = selected ? planPurchaseState(selected, access) : "unavailable";
  useEffect(() => {
    if (access.status === "loading" || access.status === "error") return;
    if (!selected || planPurchaseState(selected, access) === "owned") setSelectedId(plans.find((plan) => planPurchaseState(plan, access) === "available")?.id ?? "");
  }, [access, plans, selected]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected || eligibility !== "available" || pending.current) return;
    pending.current = true; setBusy(true); setError("");
    const key = `${selected.id}:${email.trim().toLowerCase()}`;
    try {
      if (request.current?.key !== key) {
        let storage: Storage | null = null;
        try { storage = window.sessionStorage; } catch { /* Storage is optional. */ }
        request.current = { key, id: await membershipRequestId(selected.id, email, storage) };
      }
      const url = await beginMembershipCheckout(selected.id, email, request.current.id);
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout could not open. Please try again.");
      pending.current = false; setBusy(false);
    }
  };
  if (Capacitor.isNativePlatform()) return null;
  return <form onSubmit={submit}>
    <h2>Membership and upgrades.</h2><p>Your price and payment details are confirmed at secure checkout.</p>
    {(["membership", "course", "tool"] as const).map((kind) => {
      const group = plans.filter((plan) => (plan.offerKind ?? "membership") === kind);
      if (!group.length) return null;
      return <fieldset className="membership-options" disabled={busy} key={kind}><legend>{kind === "membership" ? "Community and certification membership" : kind === "course" ? "Individual course upgrades" : "Tool subscriptions"}</legend>{group.map((plan) => {
        const state = planPurchaseState(plan, access);
        return <label className={`membership-option${selectedId === plan.id ? " selected" : ""}`} key={plan.id}>
          <input type="radio" name="membership-plan" value={plan.id} disabled={state === "owned"} checked={selectedId === plan.id} onChange={() => setSelectedId(plan.id)} />
          <span><strong>{plan.name}</strong>{plan.description && <small>{plan.description}</small>}{state === "owned" ? <small>Already included in your access</small> : <><span className="membership-price">{membershipPrice(plan)} <small>{plan.billingInterval === "one_time" ? "one-time payment" : `per ${plan.billingInterval}`}</small></span>{plan.trialDays > 0 && <small>{plan.trialDays}-day trial, then the price shown above.</small>}</>}</span>
        </label>;
      })}</fieldset>;
    })}
    {access.status === "loading" && <p role="status">Checking your access…</p>}
    {access.status === "error" && <div role="alert"><p>We couldn't check your access. Please retry before purchasing.</p><button type="button" className="secondary-button" onClick={refresh}>Check access again</button></div>}
    {eligibility === "sign_in" && <p className="membership-notice"><a href="/">Sign in to your Academy account</a> to choose this upgrade.</p>}
    {eligibility === "unavailable" && access.status === "no_access" && <p className="membership-notice">This account is not ready for this upgrade. Contact the Academy team to check your account.</p>}
    {eligibility === "membership_required" && <p className="membership-notice">This upgrade requires active community membership.</p>}
    {eligibility === "owned" && <p className="membership-notice">This option is already included in your access.</p>}
    <label className="membership-email">Your email address<input type="email" autoComplete="email" inputMode="email" maxLength={254} required readOnly={Boolean(accountEmail)} disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" aria-describedby="membership-email-help" /></label>
    <p id="membership-email-help" className="membership-fine">{accountEmail ? <>Checkout uses your signed-in Academy account. To use a different email, <a href="/">return to your workspace</a> and sign out first.</> : <>Use this same email when signing into the Academy. Already have an account? <a href="/">Sign in before buying.</a></>}</p>
    {eligibility === "available" && selected?.billingInterval !== "one_time" && <p className="membership-fine">This subscription renews automatically until cancelled. Manage cancellation through web billing.</p>}
    {error && <p className="membership-error" role="alert">{error}</p>}
    <button className="primary-button wide" disabled={busy || !selected || eligibility !== "available" || !email.trim()}><CreditCard size={18} />{busy ? "Opening secure checkout…" : "Continue to secure checkout"}</button>
    <p className="membership-secure"><LockKeyhole size={14} /> Payments are processed by Stripe.</p>
  </form>;
}

export function CheckoutReturn() {
  const { access, accountEmail, refresh } = useBillingAccess();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current || !supabase) return;
    pending.current = true; setBusy(true); setMessage(""); setFailed(false);
    try { const { error } = await requestMagicLink(email.trim()); if (error) throw error; setMessage("If your membership is ready, a sign-in link is on its way. Payment confirmation can take a moment; check your inbox and spam folder."); }
    catch { setFailed(true); setMessage("We couldn't send a sign-in link. Please try again or contact support."); }
    finally { pending.current = false; setBusy(false); }
  };
  if (Capacitor.isNativePlatform()) return null;
  if (accountEmail) return <section className="membership-panel membership-centered"><span className="membership-symbol"><BookOpen size={26} /></span><h1>Welcome back.</h1><p>Your purchase unlocks when payment is confirmed. Your existing sign-in is ready to use.</p><p role="status">{access.status === "member" ? "Your current account access has been refreshed." : "Payment confirmation may still be processing."}</p><a className="primary-button wide" href="/?view=learn">Open Academy <ArrowRight size={17} /></a><button className="secondary-button wide" onClick={refresh}>Check access again</button><p className="membership-fine">Access not ready yet? Contact support before purchasing again.</p></section>;
  if (access.status === "loading" || access.status === "error") return <section className="membership-panel membership-centered"><h1>Checking your account.</h1>{access.status === "error" ? <><p role="alert">We couldn't check your account access.</p><button className="secondary-button wide" onClick={refresh}>Try again</button></> : <p role="status">Your purchase unlocks once payment is confirmed. Checking your existing sign-in…</p>}</section>;
  return <section className="membership-panel membership-centered"><span className="membership-symbol"><Mail size={26} /></span><p className="kicker">Back from checkout</p><h1>Let's get you into the Academy.</h1><p>Your purchase unlocks once payment is confirmed. This can take a moment.</p><p>Enter the email you used at checkout to request your sign-in link.</p>
    <form onSubmit={submit}><label className="membership-email">Checkout email<input type="email" autoComplete="email" inputMode="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required disabled={busy} /></label><button className="primary-button wide" disabled={busy || !email.trim() || !supabase}>{busy ? "Sending…" : "Email me a sign-in link"}</button></form>
    {message && <p className={failed ? "membership-error" : "membership-notice"} role={failed ? "alert" : "status"}>{message}</p>}
    <p className="membership-fine">Payment completed but access isn't ready? Contact support before making another purchase.</p><a className="membership-contact" href="/">Go to member sign in <ArrowRight size={16} /></a>
  </section>;
}

function MembershipManagement() {
  const { access, accountEmail, refresh: refreshAccess } = useBillingAccess();
  const [overview, setOverview] = useState<AcademyBillingOverview | null>(null);
  const [state, setState] = useState<"loading" | "signed_out" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    setState("loading"); setOverview(null);
    if (access.status === "loading") return () => { active = false; };
    if (access.status === "error") { setState("error"); return () => { active = false; }; }
    if (!accountEmail) { setState("signed_out"); return () => { active = false; }; }
    void (async () => {
      const next = await loadAcademyBillingOverview();
      if (active) { setOverview(next); setState("ready"); }
    })().catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [retry, access.status, accountEmail]);
  const openPortal = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await openAcademyBillingPortal(); }
    catch { setError("Billing management could not open. Please try again or contact support."); pending.current = false; setBusy(false); }
  };
  return <section className="membership-panel membership-centered"><span className="membership-symbol"><CreditCard size={26} /></span><h1>Manage your membership.</h1>
    {state === "loading" ? <p role="status">Checking your billing account…</p> : state === "error" ? <div role="alert"><p>We couldn't check your billing account. Your membership has not changed.</p><button className="secondary-button wide" onClick={() => { refreshAccess(); setRetry((value) => value + 1); }}>Try again</button></div>
      : state === "signed_out" ? <><p>Sign in with your Academy email to manage payments securely. You can also open billing from your workspace settings after signing in.</p><a className="primary-button wide" href="/">Member sign in <ArrowRight size={17} /></a></>
      : (overview?.subscriptions?.length || overview?.subscription) ? <>{(overview.subscriptions ?? (overview.subscription ? [overview.subscription] : [])).map((subscription, index) => <article key={index}><h2>{subscription.planName}</h2><p className="membership-notice">{subscription.cancelAtPeriodEnd ? "Cancellation is scheduled at the end of your billing period." : `Status: ${subscription.status.replaceAll("_", " ")}.`}</p></article>)}<p>View invoices, update your payment method, or manage your subscription in Stripe.</p><button className="primary-button wide" disabled={busy} onClick={() => void openPortal()}>{busy ? "Opening…" : "Open secure billing"}</button></>
      : <><p>No Stripe billing account is connected to this login yet. Existing Academy access is unchanged.</p><p>Already paying through another arrangement? Contact the Academy team before starting a new subscription.</p></>}
    {error && <p className="membership-error" role="alert">{error}</p>}<a className="membership-contact" href="/"><ArrowLeft size={16} /> Back to Academy</a>
  </section>;
}
