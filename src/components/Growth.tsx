import { useEffect, useId, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowRight, CheckCircle2, Globe, Megaphone, MessageSquare, Search, X } from "lucide-react";
import type { AccessState } from "../lib/academyAccess";
import { createGrowthRequest, loadGrowthCatalog, loadOwnGrowthRequests, type GrowthCatalog, type GrowthRequest, type GrowthService, type GrowthServiceKey } from "../lib/growth";
import { beginServiceBillingPortal, beginServiceCheckout, loadOwnServiceOrders, loadOwnServiceQuotes, type ServiceOrder, type ServiceQuote } from "../lib/serviceCheckout";
import { serviceName, serviceOrderHasPortal, serviceOrderStatus } from "../lib/serviceBillingPresentation";
import { AvailableUpgrades } from "./AccessOffers";
import "./growth.css";

const serviceIcons = { website: Globe, ghl: MessageSquare, "seo-aeo": Search, "facebook-ads": Megaphone, "website-care": Globe, "ghl-subscription": MessageSquare };
const requestLabels: Record<GrowthRequest["status"], string> = { new: "Request received", contacted: "In conversation", closed: "Closed" };

/** Prices come from the configured catalog; the app never changes a Stripe price. */
export function Growth({ access, readOnly = false, onToast }: { access: AccessState; readOnly?: boolean; onToast: (message: string) => void }) {
  const native = Capacitor.isNativePlatform();
  const formId = useId();
  const [catalog, setCatalog] = useState<GrowthCatalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [requests, setRequests] = useState<GrowthRequest[]>([]);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [requestsError, setRequestsError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<GrowthServiceKey | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<GrowthServiceKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [quotes, setQuotes] = useState<ServiceQuote[]>([]);
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof loadOwnServiceOrders>>>([]);
  const [paymentsLoaded, setPaymentsLoaded] = useState(false);
  const [paymentsError, setPaymentsError] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [portalOrder, setPortalOrder] = useState<string | null>(null);
  const [checkoutQuote, setCheckoutQuote] = useState<string | null>(null);
  const checkoutAttempt = useRef<Map<string, string>>(new Map());
  const pending = useRef(false);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  const mounted = useRef(true);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const writable = useRef(!readOnly && !native);
  writable.current = !readOnly && !native;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    if (native || readOnly) return () => { active = false; };
    setCatalogError(false); setRequestsError(false);
    void loadGrowthCatalog().then(value => { if (active) setCatalog(value); }).catch(() => { if (active) setCatalogError(true); });
    void loadOwnGrowthRequests().then(value => { if (active) { setRequests(value); setRequestsLoaded(true); } }).catch(() => { if (active) setRequestsError(true); });
    setPaymentsError(false);
    void Promise.all([loadOwnServiceQuotes(), loadOwnServiceOrders()]).then(([nextQuotes, nextOrders]) => {
      if (active) { setQuotes(nextQuotes); setOrders(nextOrders); setPaymentsLoaded(true); }
    }).catch(() => { if (active) setPaymentsError(true); });
    return () => { active = false; };
  }, [native, readOnly, retry]);
  useEffect(() => { if (selected) headingRef.current?.focus(); }, [selected]);

  if (native) return null;
  const chosen = catalog?.services.find(service => service.key === selected);
  const notes = selected ? drafts[selected] ?? "" : "";
  const activeRequest = (key: GrowthServiceKey) => requests.find(request => request.serviceKey === key && request.status !== "closed");
  const returning = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("service_checkout") === "return";
  const locked = readOnly || busy;
  const beginRequest = (key: GrowthServiceKey) => {
    if (locked || !requestsLoaded || requestsError || activeRequest(key)) return;
    setSelected(key); setSubmitError("");
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!chosen || !writable.current || pending.current || !requestsLoaded || requestsError || activeRequest(chosen.key)) return;
    const service = chosen;
    const cleanNotes = notes.trim();
    const key = `${service.key}:${cleanNotes}`;
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    pending.current = true; setBusy(true); setSubmitError("");
    try {
      const saved = await createGrowthRequest(service.key, cleanNotes, attempt.current.id);
      if (!mounted.current) return;
      // The server may return an existing open request; only its stored notes count.
      setRequests(current => [saved, ...current.filter(request => request.id !== saved.id)]);
      if (saved.notes.trim() === cleanNotes) {
        setDrafts(current => ({ ...current, [service.key]: "" })); setSelected(null); attempt.current = null;
        onToast("Request saved. You can track it in Your requests.");
      } else {
        setSubmitError("An existing request was found. Your new notes were not sent. Your notes are still here to copy; the original request is shown below.");
        onToast("Existing request found. Your new notes were not sent.");
      }
      void loadOwnGrowthRequests().then(value => { if (mounted.current) { setRequests(value); setRequestsError(false); } }).catch(() => { if (mounted.current) setRequestsError(true); });
    } catch {
      if (mounted.current) setSubmitError("Your request could not be confirmed. Your notes are still here. Try again to check the same request.");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const pay = async (quote: ServiceQuote) => {
    if (!writable.current || pending.current || paymentsError || !paymentsLoaded || quote.status !== "offered" || orders.some(order => order.quoteId === quote.id && order.status === "paid")) return;
    pending.current = true; setBusy(true); setCheckoutQuote(quote.id); setCheckoutError("");
    if (!checkoutAttempt.current.has(quote.id)) checkoutAttempt.current.set(quote.id, crypto.randomUUID());
    try {
      const url = await beginServiceCheckout(quote.id, checkoutAttempt.current.get(quote.id)!);
      if (!mounted.current) return;
      if (!writable.current) throw new Error("Reconnect before continuing to checkout.");
      window.location.assign(url);
    } catch {
      if (mounted.current) { setCheckoutError("Secure checkout could not open. Your quote is still here. Try again to resume the same checkout."); setBusy(false); setCheckoutQuote(null); }
      pending.current = false;
    }
  };

  const manageService = async (order: ServiceOrder) => {
    if (!writable.current || pending.current || paymentsError || !paymentsLoaded || !serviceOrderHasPortal(order)) return;
    pending.current = true; setBusy(true); setPortalOrder(order.id); setCheckoutError("");
    try {
      const url = await beginServiceBillingPortal(order.id);
      if (!mounted.current) return;
      if (!writable.current) throw new Error("Reconnect before opening billing.");
      window.location.assign(url);
    } catch {
      if (mounted.current) { setCheckoutError("Secure billing could not open. Your subscription has not changed. Try again or contact support."); setBusy(false); setPortalOrder(null); }
      pending.current = false;
    }
  };

  return <div className="growth-view">
    <header className="growth-intro"><div><h2>Grow your business.</h2><p>Get help with your website, follow-up, and marketing. Choose a service to start a conversation with the Dirty Turf team.</p></div><span className="growth-intro-mark" aria-hidden="true"><Globe size={28} /></span></header>
    {readOnly && <p className="growth-notice" role="status">You’re offline or your connection could not be verified. Your notes stay here. Reconnect to send a request or review upgrades.</p>}
    {returning && <p className="growth-notice" role="status">Checking payment status. Returning from Stripe does not confirm payment; only the confirmed status below does.</p>}
    {catalogError ? <div className="growth-notice growth-error" role="alert"><h3>Business services could not load.</h3><p>These options may still be getting set up. Reload to check again.</p><button type="button" className="secondary-button" disabled={locked} onClick={() => setRetry(value => value + 1)}>Reload services</button></div>
      : !catalog ? <p className="growth-notice" role="status">{readOnly ? "Reconnect to load business services." : "Loading business services…"}</p>
      : <>
        <section className="growth-services" aria-label="Business services">{catalog.services.map(service => {
          const Icon = serviceIcons[service.key];
          const existing = activeRequest(service.key);
          return <article className={`growth-service${selected === service.key ? " selected" : ""}`} key={service.key}><span className="growth-service-icon"><Icon size={22} /></span><div className="growth-service-copy"><h3>{service.title}</h3><p>{service.summary}</p>{(service.key === "website-care" || service.key === "ghl-subscription") && <span className="growth-optional">Optional monthly add-on</span>}</div><div className="growth-service-price"><strong>{servicePrice(service)}</strong><span>{service.billingInterval === "month" ? "per month" : service.billingInterval === "one_time" ? "one-time" : "Billing confirmed in your proposal"}</span></div><button type="button" className="secondary-button" disabled={locked || !requestsLoaded || requestsError || Boolean(existing)} onClick={() => beginRequest(service.key)} aria-expanded={selected === service.key} aria-controls={selected === service.key ? `${formId}-request` : undefined}>{existing ? <><CheckCircle2 size={16} /> {requestLabels[existing.status]}</> : <>Request details <ArrowRight size={16} /></>}</button></article>;
        })}</section>
        <p className="growth-quote-note">Project scope and final price are confirmed before payment. Monthly add-ons are optional.</p>
        {chosen && <section className="growth-request" id={`${formId}-request`} aria-labelledby={`${formId}-title`}><header><div><h3 ref={headingRef} tabIndex={-1} id={`${formId}-title`}>{chosen.title}: request details</h3><p>Tell us what you need. This saves a request for the team to follow up with your Academy account.</p></div><button className="icon-button" type="button" aria-label="Close service request" disabled={locked} onClick={() => setSelected(null)}><X size={18} /></button></header><form onSubmit={event => void submit(event)}><label htmlFor={`${formId}-notes`}>What would you like help with? <span>(optional)</span></label><textarea id={`${formId}-notes`} maxLength={2000} rows={4} disabled={locked} value={notes} onChange={event => { if (!locked) setDrafts(current => ({ ...current, [chosen.key]: event.target.value })); }} placeholder="Tell us about your business and what you want to improve." /><small>{notes.length}/2,000 characters. Never include passwords or payment details.</small>{submitError && <p className="growth-notice growth-error" role="alert">{submitError}</p>}<div className="growth-request-actions"><p>No payment is collected when you request details.</p><button className="primary-button" disabled={locked || requestsError || !requestsLoaded || Boolean(activeRequest(chosen.key))}>{busy ? "Saving request…" : activeRequest(chosen.key) ? "Open request already exists" : "Send request"}<ArrowRight size={16} /></button></div></form></section>}
      </>}
    <section className="growth-your-requests" aria-labelledby={`${formId}-requests`}><header><h3 id={`${formId}-requests`}>Your requests</h3>{requestsLoaded && <button type="button" className="growth-text-button" disabled={locked} onClick={() => setRetry(value => value + 1)}>Refresh</button>}</header>{requestsError && <div className="growth-notice growth-error" role="alert"><p>Your request list could not refresh. Existing requests are still shown; new requests are paused until we can check your list.</p><button type="button" className="secondary-button" disabled={locked} onClick={() => setRetry(value => value + 1)}>Reload requests</button></div>}{!requestsLoaded && !requestsError ? <p className="growth-empty" role="status">{readOnly ? "Reconnect to load your requests." : "Checking your requests…"}</p> : requests.length ? <ul>{requests.map(request => <li key={request.id}><div><strong>{catalog?.services.find(service => service.key === request.serviceKey)?.title ?? serviceName(request.serviceKey)}</strong><span>{request.createdAt ? formatDate(request.createdAt) : "Date unavailable"}</span>{request.notes && <p>{request.notes}</p>}</div><span className={`growth-request-status status-${request.status}`}>{requestLabels[request.status]}</span></li>)}</ul> : requestsLoaded && <p className="growth-empty">No service requests yet. Choose a service above when you’re ready.</p>}</section>
    <section className="growth-payment-quotes" aria-labelledby={`${formId}-quotes`}><header><h3 id={`${formId}-quotes`}>Your service quotes</h3><button type="button" className="growth-text-button" disabled={locked} onClick={() => setRetry(value => value + 1)}>Refresh quotes</button></header><p>When the team confirms your scope and price, your exact quote appears here. Choose whether to continue to Stripe.</p>{paymentsError && <div className="growth-notice growth-error" role="alert"><p>Quotes and payments could not refresh. Checkout is paused until we can verify their status.</p><button type="button" className="secondary-button" disabled={locked} onClick={() => setRetry(value => value + 1)}>Reload quotes and payments</button></div>}{checkoutError && <p className="growth-notice growth-error" role="alert">{checkoutError}</p>}{!paymentsLoaded && !paymentsError ? <p className="growth-empty" role="status">{readOnly ? "Reconnect to load your quotes." : "Loading quotes and payments…"}</p> : quotes.length ? <ul>{quotes.map(quote => {
      const paidOrder = orders.find(order => order.quoteId === quote.id && order.status === "paid");
      const paid = quote.status === "paid" || Boolean(paidOrder);
      return <li key={quote.id}>
        <div><h4>{serviceName(quote.serviceKey)}</h4><strong>{exactPrice(quote.amountCents)} <span>{quote.billingInterval === "month" ? "per month" : "one-time"}</span></strong><p>{quote.billingInterval === "month" ? paid ? "Manage invoices, payment details, and cancellation through secure Stripe billing." : "This optional subscription renews monthly until cancelled. Nothing is added to your existing membership unless you complete checkout." : "One-time payment for the scope agreed with the team."}</p>{paid && <span className="growth-request-status"><CheckCircle2 size={15} /> {paidOrder ? serviceOrderStatus(paidOrder) : "Payment confirmed"}</span>}</div>
        {paid ? paidOrder && serviceOrderHasPortal(paidOrder) ? <button type="button" className="secondary-button" disabled={locked || paymentsError} onClick={() => void manageService(paidOrder)}>{portalOrder === paidOrder.id ? "Opening billing…" : "Manage billing"}<ArrowRight size={16} /></button> : null : quote.status === "withdrawn" ? <span className="growth-request-status status-closed">Quote withdrawn</span> : <button type="button" className="primary-button" disabled={locked || paymentsError || !paymentsLoaded} onClick={() => void pay(quote)}>{checkoutQuote === quote.id ? "Opening Stripe…" : "Continue to Stripe"}<ArrowRight size={16} /></button>}
      </li>;
    })}</ul> : paymentsLoaded && <p className="growth-empty">No quotes yet. Start with a service request above.</p>}
    {orders.length > 0 && <div className="growth-payment-history"><h4>Payment status</h4><ul>{orders.map(order => <li key={order.id}><span>{serviceName(order.serviceKey)}<small>{exactPrice(order.amountCents)} {order.billingInterval === "month" ? "per month" : "one-time"}</small></span><div><strong>{serviceOrderStatus(order)}</strong>{serviceOrderHasPortal(order) && !quotes.some(quote => quote.id === order.quoteId) && <button type="button" className="growth-text-button" disabled={locked || paymentsError} onClick={() => void manageService(order)}>{portalOrder === order.id ? "Opening billing…" : "Manage billing"}<ArrowRight size={15} /></button>}</div></li>)}</ul></div>}
    {!readOnly && <a className="growth-text-button" href="/billing">View all billing <ArrowRight size={15} /></a>}
    </section>
    <section className="growth-upgrades" aria-labelledby={`${formId}-upgrades`}><h3 id={`${formId}-upgrades`}>Membership and Academy upgrades</h3><p>Course and measuring-tool options are based on your current access.</p>{access.status === "member" && (!access.pricingGatesEnabled || access.communityAccess || access.canManage) && <p className="growth-included"><CheckCircle2 size={18} /> Community membership is already included in your access.</p>}<AvailableUpgrades access={access} readOnly={readOnly} />{!readOnly && <a className="growth-text-button" href="/membership">View membership and upgrade options <ArrowRight size={15} /></a>}</section>
  </div>;
}

function servicePrice(service: GrowthService) {
  const format = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
  return service.fromCents === service.toCents ? format(service.fromCents) : `${format(service.fromCents)}–${format(service.toCents)}`;
}
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "Date unavailable" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date); }
function exactPrice(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
