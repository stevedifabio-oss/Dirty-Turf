import { useEffect, useId, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { RefreshCw, Save } from "lucide-react";
import { loadAdminGrowthRequests, loadGrowthCatalog, updateGrowthRequestStatus, type GrowthRequest, type GrowthService, type GrowthServiceKey, type GrowthSettings } from "../lib/growth";
import { createServiceQuote, loadAdminServiceQuotes, withdrawServiceQuote, type ServiceQuote } from "../lib/serviceCheckout";
import "./growth.css";

const serviceTitles: Record<GrowthServiceKey, string> = { website: "Website", ghl: "GoHighLevel", "seo-aeo": "SEO and AEO", "facebook-ads": "Facebook ads management", "website-care": "Website care", "ghl-subscription": "GoHighLevel subscription" };
type RequestStatus = GrowthRequest["status"];
const statusLabels: Record<RequestStatus, string> = { new: "New", contacted: "Contacted", closed: "Closed" };
type QuoteDraft = { amount: string };

export function GrowthAdmin({ communityId, readOnly = false, onToast, onDirtyChange }: { communityId: string; readOnly?: boolean; onToast: (message: string) => void; onDirtyChange?: (dirty: boolean) => void }) {
  const native = Capacitor.isNativePlatform();
  const id = useId();
  const [settings, setSettings] = useState<GrowthSettings | null>(null);
  const [services, setServices] = useState<GrowthService[]>([]);
  const [settingsError, setSettingsError] = useState(false);
  const [settingsRetry, setSettingsRetry] = useState(0);
  const [requests, setRequests] = useState<GrowthRequest[]>([]);
  const [requestsLoaded, setRequestsLoaded] = useState(false);
  const [requestsError, setRequestsError] = useState(false);
  const [requestsRetry, setRequestsRetry] = useState(0);
  const [filter, setFilter] = useState<RequestStatus | "all">("new");
  const [busy, setBusy] = useState<string | null>(null);
  const [writeError, setWriteError] = useState("");
  const [quotes, setQuotes] = useState<ServiceQuote[]>([]);
  const [quotesLoaded, setQuotesLoaded] = useState(false);
  const [quotesError, setQuotesError] = useState(false);
  const [quoteDrafts, setQuoteDrafts] = useState<Record<string, QuoteDraft>>({});
  const pending = useRef(false);
  const mounted = useRef(true);
  const writable = useRef(!readOnly && !native);
  writable.current = !readOnly && !native;
  const dirty = Object.values(quoteDrafts).some(value => Boolean(value.amount));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { onDirtyChange?.(dirty || Boolean(busy)); }, [dirty, busy, onDirtyChange]);
  useEffect(() => () => { onDirtyChange?.(false); }, [onDirtyChange]);
  useEffect(() => { setSettings(null); setServices([]); setRequests([]); setRequestsLoaded(false); setQuotes([]); setQuotesLoaded(false); setQuoteDrafts({}); }, [communityId]);
  useEffect(() => {
    let active = true;
    if (readOnly || native) return () => { active = false; };
    setSettingsError(false);
    void loadGrowthCatalog().then(catalog => {
      if (!active) return;
      if (catalog.settings.communityId !== communityId) throw new Error("Business settings belong to a different Academy.");
      setSettings(catalog.settings); setServices(catalog.services);
    }).catch(() => { if (active) setSettingsError(true); });
    return () => { active = false; };
  }, [communityId, settingsRetry, readOnly, native]);
  useEffect(() => {
    let active = true;
    if (readOnly || native) return () => { active = false; };
    setRequestsError(false);
    void loadAdminGrowthRequests(communityId, filter === "all" ? undefined : filter).then(value => { if (active) { setRequests(value); setRequestsLoaded(true); } }).catch(() => { if (active) setRequestsError(true); });
    return () => { active = false; };
  }, [communityId, filter, readOnly, requestsRetry, native]);
  useEffect(() => { setRequests([]); setRequestsLoaded(false); }, [communityId, filter]);
  useEffect(() => {
    let active = true;
    if (readOnly || native) return () => { active = false; };
    setQuotesError(false);
    void loadAdminServiceQuotes(communityId).then(value => { if (active) { setQuotes(value); setQuotesLoaded(true); } }).catch(() => { if (active) setQuotesError(true); });
    return () => { active = false; };
  }, [communityId, readOnly, requestsRetry, native]);
  if (native) return null;
  const locked = readOnly || Boolean(busy);
  const changeStatus = async (request: GrowthRequest, status: RequestStatus) => {
    if (!writable.current || pending.current || status === request.status) return;
    pending.current = true; setBusy(request.id); setWriteError("");
    try {
      await updateGrowthRequestStatus(request.id, status);
      if (!mounted.current) return;
      setRequests(current => current.map(item => item.id === request.id ? { ...item, status } : item).filter(item => filter === "all" || item.status === filter));
      onToast("Request status updated.");
    } catch { if (mounted.current) setWriteError("The request status could not be saved. Its previous status is still shown. Try again."); }
    finally { pending.current = false; if (mounted.current) setBusy(null); }
  };
  const offerQuote = async (event: React.FormEvent, request: GrowthRequest) => {
    event.preventDefault();
    const values = quoteDrafts[request.id];
    const service = services.find(item => item.key === request.serviceKey);
    const amountCents = parseDollars(values?.amount ?? "");
    const billingInterval = service?.billingInterval;
    if (!values || !service || !writable.current || pending.current || request.status === "closed" || quotesError || !quotesLoaded ||
      quotes.some(quote => quote.requestId === request.id && quote.status !== "withdrawn") || amountCents === null || amountCents < service.fromCents || amountCents > service.toCents ||
      !billingInterval || billingInterval === "quote") return;
    pending.current = true; setBusy(`quote:${request.id}`); setWriteError("");
    try {
      const quote = await createServiceQuote({ requestId: request.id, amountCents, billingInterval });
      if (!mounted.current) return;
      setQuotes(current => [quote, ...current.filter(item => item.id !== quote.id)]);
      setQuoteDrafts(current => { const next = { ...current }; delete next[request.id]; return next; });
      onToast("Quote saved. It is available in the member’s account.");
    } catch { if (mounted.current) setWriteError("The quote could not be confirmed. Your quoted price is still here. Try again to check the same request."); }
    finally { pending.current = false; if (mounted.current) setBusy(null); }
  };
  const withdrawQuote = async (quote: ServiceQuote) => {
    if (!writable.current || pending.current || quotesError || quote.status !== "offered") return;
    pending.current = true; setBusy(`withdraw:${quote.id}`); setWriteError("");
    let confirmed = false;
    try {
      await withdrawServiceQuote(quote.id); confirmed = true;
      const current = await loadAdminServiceQuotes(communityId);
      if (!mounted.current) return;
      if (!current.some(item => item.id === quote.id && item.status === "withdrawn")) {
        setQuotesError(true); setWriteError("The withdrawal status is not yet confirmed. Refresh requests before offering another quote."); return;
      }
      setQuotes(current); onToast("Quote withdrawn. You can now offer revised terms.");
    } catch {
      if (mounted.current) {
        if (confirmed) { setQuotesError(true); setWriteError("The withdrawal was saved, but its status could not refresh. Refresh requests before offering another quote."); }
        else setWriteError("This quote could not be withdrawn. A pending checkout or completed payment may need review. Refresh its status before trying again.");
      }
    } finally { pending.current = false; if (mounted.current) setBusy(null); }
  };
  const filtered = requests;
  return <section className="growth-admin">
    <header className="growth-admin-heading"><div><h3>Business services</h3><p>Manage service requests and offer exact prices from the approved member catalog.</p></div></header>
    {readOnly && <p className="growth-notice" role="status">Reconnect to refresh requests, offer a quote, or change a request’s status. Your unsaved quote drafts stay here.</p>}
    {writeError && <p className="growth-notice growth-error" role="alert">{writeError}</p>}
    {settingsError ? <div className="growth-notice growth-error" role="alert"><h4>Business settings could not load.</h4><p>If this feature is new, its database update may still need to be applied. Reload to check again.</p><button type="button" className="secondary-button" disabled={locked} onClick={() => setSettingsRetry(value => value + 1)}>Reload settings</button></div>
      : !settings ? <p className="growth-notice" role="status">{readOnly ? "Reconnect to load business services." : "Loading business services…"}</p>
      : <section className="growth-approved-prices" aria-label="Approved service prices"><h4>Approved prices</h4><p>These are the member-facing prices and payment schedules. Website care and the GoHighLevel subscription are optional monthly add-ons.</p><dl>{services.map(service => <div key={service.key}><dt>{service.title}</dt><dd><strong>{money(service.fromCents)}{service.fromCents !== service.toCents ? `–${money(service.toCents)}` : ""}</strong><span>{service.billingInterval === "month" ? "per month" : service.billingInterval === "one_time" ? "one-time" : "Schedule confirmed in proposal"}</span></dd></div>)}</dl></section>}
    <section className="growth-request-queue" aria-labelledby={`${id}-queue`}>
      <header><div><h4 id={`${id}-queue`}>Service requests</h4><p>Follow up with members, then offer an exact price for the scope you agreed.</p></div><button type="button" className="secondary-button" disabled={locked} onClick={() => setRequestsRetry(value => value + 1)}><RefreshCw size={15} /> Refresh</button></header>
      <div className="growth-queue-toolbar"><label htmlFor={`${id}-filter`}>Show<select id={`${id}-filter`} disabled={Boolean(busy)} value={filter} onChange={event => setFilter(event.target.value as RequestStatus | "all")}><option value="new">New requests</option><option value="contacted">Contacted</option><option value="closed">Closed</option><option value="all">All requests</option></select></label><span>{filtered.length} request{filtered.length === 1 ? "" : "s"}</span></div>
      {requestsError && <div className="growth-notice growth-error" role="alert"><p>Service requests could not refresh. Previously loaded requests are still shown.</p><button type="button" className="secondary-button" disabled={locked} onClick={() => setRequestsRetry(value => value + 1)}>Reload requests</button></div>}
      {quotesError && <p className="growth-notice growth-error" role="alert">Payment quotes could not load. New quotes are paused; refresh after the payment setup is available.</p>}
      {!requestsLoaded && !requestsError ? <p className="growth-empty" role="status">{readOnly ? "Reconnect to load requests." : "Loading service requests…"}</p> : filtered.length ? <ul>{filtered.map(request => {
        const service = services.find(item => item.key === request.serviceKey);
        const values = quoteDrafts[request.id] ?? { amount: "" };
        const amountCents = parseDollars(values.amount);
        const validAmount = Boolean(service && amountCents !== null && amountCents >= service.fromCents && amountCents <= service.toCents);
        const schedule = service?.billingInterval;
        const requestQuotes = quotes.filter(quote => quote.requestId === request.id);
        const hasQuote = requestQuotes.some(quote => quote.status !== "withdrawn");
        const setQuoteField = (field: keyof QuoteDraft, value: string) => { if (!locked && writable.current) setQuoteDrafts(current => ({ ...current, [request.id]: { ...(current[request.id] ?? { amount: "" }), [field]: value } })); };
        return <li key={request.id}>
          <div className="growth-queue-request"><span>{serviceTitles[request.serviceKey]}</span><h5>{request.memberName || "Academy member"}</h5>{request.companyName && <p>{request.companyName}</p>}<small>{dateLabel(request.createdAt)}</small>{request.notes && <p className="growth-request-notes">{request.notes}</p>}</div>
          <label className="growth-field" htmlFor={`${id}-request-${request.id}`}>Status<select id={`${id}-request-${request.id}`} disabled={locked || requestsError} value={request.status} onChange={event => void changeStatus(request, event.target.value as RequestStatus)}>{(Object.keys(statusLabels) as RequestStatus[]).map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select>{busy === request.id && <small role="status">Saving…</small>}</label>
          <div className="growth-admin-quote">
            {requestQuotes.map(quote => <div className="growth-existing-quote" key={quote.id}><div><strong>{money(quote.amountCents)} {quote.billingInterval === "month" ? "per month" : "one-time"}</strong><span>{quote.status === "paid" ? "Payment confirmed" : quote.status === "offered" ? "Quote offered" : "Quote withdrawn"}</span></div>{quote.status === "offered" && <button type="button" className="growth-text-button" disabled={locked || quotesError} onClick={() => void withdrawQuote(quote)}>{busy === `withdraw:${quote.id}` ? "Withdrawing…" : "Withdraw quote"}</button>}</div>)}
            {!hasQuote && <form onSubmit={event => void offerQuote(event, request)} aria-label={`Quote for ${serviceTitles[request.serviceKey]} requested by ${request.memberName || "Academy member"}`}>
              <fieldset disabled={locked || requestsError || quotesError || !quotesLoaded || request.status === "closed" || !service}>
                <legend>Offer an exact price</legend><p>Confirm the scope with the member, then enter the final price. Saving a quote does not charge them; they choose whether to pay through Stripe.</p>
                <div className="growth-quote-fields">
                  <label className="growth-field" htmlFor={`${id}-amount-${request.id}`}>Quoted price (USD)<input id={`${id}-amount-${request.id}`} inputMode="decimal" autoComplete="off" maxLength={12} value={values.amount} placeholder={service ? (service.fromCents / 100).toFixed(2) : "0.00"} onChange={event => setQuoteField("amount", event.target.value)} aria-invalid={Boolean(values.amount && !validAmount) || undefined} aria-describedby={`${id}-amount-help-${request.id}`} /></label>
                  <div className="growth-quote-schedule"><span>Payment schedule</span><strong>{service?.billingInterval === "month" ? "Monthly" : service?.billingInterval === "one_time" ? "One-time" : "Not configured"}</strong></div>
                </div>
                <small id={`${id}-amount-help-${request.id}`}>{service ? `Approved price: ${money(service.fromCents)}${service.fromCents !== service.toCents ? `–${money(service.toCents)}` : ""}${service.billingInterval === "month" ? " per month" : service.billingInterval === "one_time" ? " one-time" : ""}.` : "Load the service catalog before quoting."}</small>
                {values.amount && !validAmount && <p className="growth-field-error">Enter an exact dollar amount within this service’s approved range.</p>}
                {request.status === "closed" && <p className="growth-field-error">Reopen this request before offering a quote.</p>}
                <button className="primary-button" disabled={locked || requestsError || quotesError || !quotesLoaded || request.status === "closed" || !validAmount || !schedule || schedule === "quote"}><Save size={16} /> {busy === `quote:${request.id}` ? "Saving quote…" : "Offer quote"}</button>
              </fieldset>
            </form>}
          </div>
        </li>;
      })}</ul> : requestsLoaded && <p className="growth-empty">{filter === "all" ? "No service requests yet. Member requests will appear here." : `No ${filter === "new" ? "new" : filter} requests.`}</p>}
    </section>
  </section>;
}

function dateLabel(value: string) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "Date unavailable" : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date); }

function parseDollars(value: string) { const clean = value.trim(); if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(clean)) return null; const cents = Math.round(Number(clean) * 100); return Number.isSafeInteger(cents) && cents > 0 ? cents : null; }
function money(cents: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100); }
