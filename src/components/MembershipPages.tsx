import type { AccessState } from "../lib/academyAccess";
import { Capacitor } from "@capacitor/core";
import { useBillingAccess } from "../lib/useBillingAccess";
import { planPurchaseState } from "../lib/membershipBilling";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, CreditCard, LockKeyhole, Mail, Users } from "lucide-react";
import { loadAcademyBillingOverview, openAcademyBillingPortal, requestMagicLink, supabase, type AcademyBillingOverview } from "../lib/backend";
import { beginMembershipCheckout, loadMembershipCatalog, membershipPrice, membershipRequestId, type BillingPageRoute, type MembershipCatalog, type MembershipPlan } from "../lib/membershipBilling";
import { beginServiceBillingPortal, loadOwnServiceOrders, type ServiceOrder } from "../lib/serviceCheckout";
import { serviceName, serviceOrderHasPortal, serviceOrderStatus } from "../lib/serviceBillingPresentation";
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

function defaultEnrollmentPlan(plans: MembershipPlan[], access?: AccessState) {
  const available = access ? plans.filter(plan => planPurchaseState(plan, access) === "available") : plans;
  return available.find(plan => (plan.offerKind ?? "membership") === "membership") ?? available[0];
}

export function EnrollmentForm({ plans, verifiedAccess, verifiedEmail }: { plans: MembershipPlan[]; verifiedAccess?: AccessState; verifiedEmail?: string }) {
  const [selectedId, setSelectedId] = useState(() => { const requested = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("plan") : null; return plans.find((plan) => plan.id === requested && (!verifiedAccess || planPurchaseState(plan, verifiedAccess) === "available"))?.id ?? defaultEnrollmentPlan(plans, verifiedAccess)?.id ?? ""; });
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
    if (!selected || planPurchaseState(selected, access) === "owned") setSelectedId(defaultEnrollmentPlan(plans, access)?.id ?? "");
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
    <h2>Membership and upgrades.</h2><p>Choose one option, review its terms, then continue to Stripe. Existing access stays with your account.</p>
    {(["membership", "course", "tool"] as const).map((kind) => {
      const group = plans.filter((plan) => (plan.offerKind ?? "membership") === kind);
      if (!group.length) return null;
      return <fieldset className="membership-options" disabled={busy} key={kind}><legend>{kind === "membership" ? "Community + Turf Cleaning Academy" : kind === "course" ? "Individual course upgrades" : "Tool subscriptions"}</legend>{group.map((plan) => {
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
    {selected && eligibility === "available" && <CheckoutSummary plan={selected} />}
    <label className="membership-email">Your email address<input type="email" autoComplete="email" inputMode="email" maxLength={254} required readOnly={Boolean(accountEmail)} disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" aria-describedby="membership-email-help" /></label>
    <p id="membership-email-help" className="membership-fine">{accountEmail ? <>Checkout uses your signed-in Academy account. To use a different email, <a href="/">return to your workspace</a> and sign out first.</> : <>Use this same email when signing into the Academy. Already have an account? <a href="/">Sign in before buying.</a></>}</p>
    {eligibility === "available" && selected?.billingInterval !== "one_time" && <p className="membership-fine">This subscription renews automatically until cancelled. Manage cancellation through web billing.</p>}
    {error && <p className="membership-error" role="alert">{error}</p>}
    <button className="primary-button wide" disabled={busy || !selected || eligibility !== "available" || !email.trim()}><CreditCard size={18} />{busy ? "Opening secure checkout…" : "Continue to secure checkout"}</button>
    <p className="membership-secure"><LockKeyhole size={14} /> Payments are processed by Stripe.</p>
  </form>;
}

export function CheckoutSummary({ plan }: { plan: MembershipPlan }) {
  const once = plan.billingInterval === "one_time";
  return <section className="checkout-summary" aria-label="Order review" aria-live="polite">
    <div className="checkout-summary-heading"><CreditCard size={18} /><h3>Your selection</h3><span>{once ? "One-time" : "Subscription"}</span></div>
    <dl><div><dt>{plan.name}</dt><dd>{membershipPrice(plan)}{!once && <small> / {plan.billingInterval}</small>}</dd></div></dl>
    <p>{once ? "One payment. No recurring charge for this purchase." : `Renews every ${plan.billingInterval} until cancelled. This is a separate subscription.`}</p>
    {plan.trialDays > 0 && <p>{plan.trialDays}-day trial, followed by the recurring price above.</p>}
    <p className="checkout-summary-tax">Stripe will show the final total and any applicable tax before you pay. Nothing else is added automatically.</p>
  </section>;
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
  const native = Capacitor.isNativePlatform();
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const [overview, setOverview] = useState<AcademyBillingOverview | null>(null);
  const [state, setState] = useState<"loading" | "signed_out" | "ready" | "error">("loading");
  const [serviceOrders, setServiceOrders] = useState<ServiceOrder[]>([]);
  const [serviceState, setServiceState] = useState<"loading" | "signed_out" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [serviceRetry, setServiceRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [serviceBusy, setServiceBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [serviceError, setServiceError] = useState("");
  const pending = useRef(false);
  const operation = useRef(0);
  const account = useRef(accountEmail);
  const loadedAccount = useRef(accountEmail);
  const mounted = useRef(true);
  const writable = useRef(!native && online && Boolean(accountEmail));
  account.current = accountEmail;
  writable.current = !native && online && Boolean(accountEmail);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current += 1; }; }, []);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  useEffect(() => {
    loadedAccount.current = accountEmail;
    operation.current += 1; pending.current = false; setBusy(false); setServiceBusy(null); setError(""); setServiceError(""); setOverview(null); setServiceOrders([]);
  }, [accountEmail]);
  useEffect(() => {
    let active = true;
    if (native || !online) return () => { active = false; };
    setState("loading"); setOverview(null);
    if (access.status === "loading") return () => { active = false; };
    if (access.status === "error") { setState("error"); return () => { active = false; }; }
    if (!accountEmail) { setState("signed_out"); return () => { active = false; }; }
    void loadAcademyBillingOverview().then(next => { if (active) { setOverview(next); setState("ready"); } }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, [retry, access.status, accountEmail, online, native]);
  useEffect(() => {
    let active = true;
    if (native || !online) return () => { active = false; };
    setServiceState("loading"); setServiceOrders([]);
    if (!accountEmail) {
      setServiceState(access.status === "loading" ? "loading" : access.status === "error" ? "error" : "signed_out");
      return () => { active = false; };
    }
    // An authenticated customer can manage an existing service subscription even
    // after Academy access expires. This load is independent of Academy billing.
    void loadOwnServiceOrders().then(next => { if (active) { setServiceOrders(next); setServiceState("ready"); } }).catch(() => { if (active) setServiceState("error"); });
    return () => { active = false; };
  }, [serviceRetry, access.status, accountEmail, online, native]);
  const openPortal = async () => {
    if (pending.current || !writable.current || accountEmail !== account.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await openAcademyBillingPortal(); }
    catch { if (mounted.current) { setError("Billing management could not open. Please try again or contact support."); pending.current = false; setBusy(false); } }
  };
  const openServicePortal = async (order: ServiceOrder) => {
    if (pending.current || !writable.current || accountEmail !== account.current || !serviceOrderHasPortal(order)) return;
    const run = ++operation.current;
    const email = accountEmail;
    pending.current = true; setServiceBusy(order.id); setServiceError("");
    try {
      const url = await beginServiceBillingPortal(order.id);
      if (!mounted.current || run !== operation.current || email !== account.current) return;
      if (!writable.current) throw new Error("Reconnect before opening billing.");
      window.location.assign(url);
    } catch {
      if (mounted.current && run === operation.current) { setServiceError("Secure service billing could not open. Your subscription has not changed. Try again or contact support."); pending.current = false; setServiceBusy(null); }
    }
  };
  if (native) return null;
  const sameAccount = loadedAccount.current === accountEmail;
  const academyState = sameAccount ? state : "loading";
  const businessState = sameAccount ? serviceState : "loading";
  const visibleOrders = sameAccount ? serviceOrders : [];
  return <section className="membership-panel membership-centered membership-billing">
    <span className="membership-symbol"><CreditCard size={26} /></span><h1>Manage your billing.</h1>
    {!online && <p className="membership-notice" role="status">You’re offline. Reconnect to load billing or manage a subscription.</p>}
    {academyState === "signed_out" && businessState === "signed_out" ? <><p>Sign in with your Academy email to manage your payments securely.</p><a className="primary-button wide" href="/">Member sign in <ArrowRight size={17} /></a></> : <>
      <section className="membership-billing-section" aria-labelledby="academy-billing-heading"><h2 id="academy-billing-heading">Academy membership</h2>
        {academyState === "loading" ? <p role="status">{online ? "Checking your Academy billing account…" : "Reconnect to check Academy billing."}</p> : academyState === "error" ? <div role="alert"><p>We couldn't check your Academy billing account. Your membership has not changed.</p><button type="button" className="secondary-button wide" disabled={!online || busy || Boolean(serviceBusy)} onClick={() => { refreshAccess(); setRetry(value => value + 1); }}>Retry Academy billing</button></div>
          : academyState === "signed_out" ? <p>Sign in to check your Academy billing account.</p>
          : (overview?.subscriptions?.length || overview?.subscription) ? <>{(overview.subscriptions ?? (overview.subscription ? [overview.subscription] : [])).map((subscription, index) => <article key={index}><h3>{subscription.planName}</h3><p className="membership-notice">{subscription.cancelAtPeriodEnd ? "Cancellation is scheduled at the end of your billing period." : `Status: ${subscription.status.replaceAll("_", " ")}.`}</p></article>)}<p>View invoices, update your payment method, or manage your Academy subscription in Stripe.</p><button type="button" className="primary-button wide" disabled={!online || busy || Boolean(serviceBusy)} onClick={() => void openPortal()}>{busy ? "Opening…" : "Open Academy billing"}</button></>
          : <><p>No Academy Stripe subscription is connected to this login.</p><p>Already paying through another arrangement? Contact the Academy team before starting a new subscription.</p></>}
        {error && <p className="membership-error" role="alert">{error}</p>}
      </section>
      <section className="membership-billing-section" aria-labelledby="service-billing-heading"><h2 id="service-billing-heading">Business services</h2>
        <p>Manage service invoices, payment details, and cancellation separately from your Academy membership.</p>
        {accountEmail && access.status === "no_access" && <p className="membership-notice">You can manage existing service subscriptions even when your Academy access has ended.</p>}
        {businessState === "loading" ? <p role="status">{online ? "Checking your service payments…" : "Reconnect to check service payments."}</p> : businessState === "error" ? <div role="alert"><p>Service payments could not load. Retry this section independently of your Academy billing.</p><button type="button" className="secondary-button wide" disabled={!online || busy || Boolean(serviceBusy)} onClick={() => setServiceRetry(value => value + 1)}>Retry service billing</button></div>
          : businessState === "signed_out" ? <p>Sign in to check your service payments.</p>
          : visibleOrders.length ? <ul className="membership-service-orders">{visibleOrders.map(order => <li key={order.id}><h3>{serviceName(order.serviceKey)}</h3><strong>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(order.amountCents / 100)} <small>{order.billingInterval === "month" ? "per month" : "one-time"}</small></strong><p className="membership-notice">{serviceOrderStatus(order)}</p>{serviceOrderHasPortal(order) && <button type="button" className="secondary-button wide" disabled={!online || busy || Boolean(serviceBusy)} onClick={() => void openServicePortal(order)} aria-label={`Manage billing for ${serviceName(order.serviceKey)}`}>{serviceBusy === order.id ? "Opening billing…" : "Manage billing"}<ArrowRight size={16} /></button>}</li>)}</ul> : <p>No service payments are linked to this account.</p>}
        {serviceError && <p className="membership-error" role="alert">{serviceError}</p>}
      </section>
    </>}
    <a className="membership-contact" href="/"><ArrowLeft size={16} /> Back to Academy</a>
  </section>;
}
