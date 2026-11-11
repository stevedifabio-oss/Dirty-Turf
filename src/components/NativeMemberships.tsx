import { useEffect, useRef, useState } from "react";
import { BookOpen, RefreshCw, Ruler, Users } from "lucide-react";
import { supabase } from "../lib/backend";
import type { AccessState } from "../lib/academyAccess";
import { listenForNativeMemberships, loadNativeMemberships, nativeMembershipsSupported, purchaseNativeMembership, restoreNativeMemberships, startScannerTrial, manageNativeMemberships, type MembershipProductId, type StoreProduct, type StoreStatus } from "../lib/nativeMemberships";
import { CourseAddOns } from "./CourseAddOns";
import "./Upgrades.css";

const choices = [
  { id: "dirty_turf_community_monthly" as const, name: "Community", Icon: Users, description: "Connect with turf cleaning operators, share advice and join community conversations." },
  { id: "dirty_turf_scanner_monthly" as const, name: "Turf Scanner", Icon: Ruler, description: "Measure artificial turf areas, calculate job pricing and determine infill based on square footage." },
  { id: "dirty_turf_academy_monthly" as const, name: "Turf Cleaning Academy", Icon: BookOpen, description: "Learn professional turf cleaning and build your business. Includes the existing Academy course; add-on courses are separate." },
];
function hasAccess(id: string, access: AccessState) {
  if (access.status !== "member") return false;
  return access.canManage || (id === choices[0].id ? access.communityAccess : id === choices[1].id ? access.features.includes("measuring_tool") : access.courseIds.includes("a0238fea-1bfd-46de-978d-f476492edec8"));
}
export const nativeMembershipServices = { load: loadNativeMemberships, supported: nativeMembershipsSupported, purchase: purchaseNativeMembership, restore: restoreNativeMemberships, trial: startScannerTrial, manage: manageNativeMemberships, listen: listenForNativeMemberships };
export function NativeMemberships({ access, onSignOut, services = nativeMembershipServices }: { access: AccessState; onSignOut?: () => void; services?: typeof nativeMembershipServices }) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  const pending = useRef(false);
  useEffect(() => {
    let mounted = true;
    const invalidate = () => { generation.current++; pending.current = false; setProducts([]); setAvailable(false); setStatus(null); setBusy(null); setMessage(""); setReload(value => value + 1); };
    const auth = services === nativeMembershipServices ? supabase?.auth.onAuthStateChange(event => { if (["SIGNED_OUT", "SIGNED_IN", "USER_UPDATED"].includes(event)) invalidate(); }).data.subscription : undefined;
    const revision = generation.current;
    let cleanup: () => void = () => undefined;
    setLoading(true); setAvailable(false); setError("");
    void services.load().then(result => {
      if (!mounted || revision !== generation.current) return;
      setProducts(result.products); setAvailable(result.available); setStatus(result.status);
    }).catch(() => { if (mounted && revision === generation.current) setError("Membership options could not load. Check your connection and try again."); })
      .finally(() => { if (mounted && revision === generation.current) setLoading(false); });
    void services.listen(() => { if (mounted) setError("A store purchase needs confirmation. Tap Restore purchases to retry."); }).then(dispose => { if (mounted) cleanup = dispose; else dispose(); }).catch(() => undefined);
    return () => { mounted = false; cleanup(); auth?.unsubscribe(); };
  }, [reload, services]);
  const action = async (key: string, operation: () => Promise<string>) => {
    if (pending.current) return;
    pending.current = true; setBusy(key); setError(""); setMessage("");
    const revision = generation.current;
    try { const result = await operation(); if (revision === generation.current) { setMessage(result); setReload(value => value + 1); } }
    catch (failure) { if (revision === generation.current) setError(failure instanceof Error ? failure.message : "Please try again."); }
    finally { if (revision === generation.current) { pending.current = false; setBusy(null); } }
  };
  const purchase = (id: MembershipProductId) => action(id, async () => {
    const result = await services.purchase(id);
    return result === "pending" ? "Your payment is pending. Access will turn on after the store confirms it." : result === "cancelled" ? "Purchase cancelled. Your memberships have not changed." : "Purchase confirmed. Your access is refreshing.";
  });
  return <div className="view-content upgrades-page">
    <section className="upgrades-intro"><p className="kicker">Your account. Your choice.</p><h2>Choose your memberships</h2><p>Get one, any two, or all three. Each monthly subscription is purchased and managed separately. You only get charged for the products you choose.</p><a className="secondary-button" href="#courses-heading">See course add-ons</a></section>
    {loading && <p role="status">Loading your memberships and store prices…</p>}
    {!loading && (!status?.enabled || !services.supported() || !available) && <p className="upgrades-availability" role="status">{!services.supported() ? "Update the app to purchase memberships here." : "Store purchases are temporarily unavailable. Your current access stays in place."}</p>}
    {error && <div role="alert" className="upgrades-availability"><p>{error}</p><button className="secondary-button" disabled={Boolean(busy)} onClick={() => setReload(value => value + 1)}>Try again</button></div>}
    {message && <p role="status" className="upgrades-availability">{message}</p>}
    <div className="upgrade-cards">{choices.map(({ id, name, Icon, description }) => {
      const product = products.find(value => value.id === id);
      const owned = status ? status.ownedProducts.includes(id) : hasAccess(id, access);
      return <article key={id}><span className="upgrade-icon"><Icon size={23} /></span><h4>{name}</h4><p>{description}</p>
        {product && <strong className="upgrade-price">{product.displayPrice}<small> / month</small></strong>}
        {owned ? <span className="upgrade-status">You have access</span> : <button className="primary-button membership-buy" disabled={loading || Boolean(busy) || !status?.enabled || !available || !product} onClick={() => void purchase(id)}>{busy === id ? "Confirming…" : `Subscribe to ${name}`}</button>}
        {id === choices[1].id && <><p className="upgrade-trial">Try Turf Scanner free for seven days. No card or automatic charge. Access ends unless you choose a paid subscription.</p>
          {status?.trialEligible && !owned && <button className="secondary-button membership-buy" disabled={Boolean(busy)} onClick={() => void action("trial", async () => { await services.trial(); return "Your seven-day Turf Scanner trial has started."; })}>{busy === "trial" ? "Starting…" : "Start 7-day free trial"}</button>}
          {status?.trialExpiresAt && <p className="upgrade-trial">Trial ends {new Date(status.trialExpiresAt).toLocaleDateString()}.</p>}</>}
      </article>;
    })}</div>
    <p className="membership-store-terms">Paid subscriptions renew monthly until cancelled in your Apple or Google account. Store checkout shows the final price before you confirm. Cancelling one membership does not cancel your others.</p>
    <div className="membership-store-actions"><button className="secondary-button" disabled={Boolean(busy) || !services.supported()} onClick={() => void action("restore", async () => { const result = await services.restore(); return result.failed ? "Some purchases were restored. Others could not be confirmed for this login; contact support before buying again." : result.confirmed ? "Your purchases have been checked and access is refreshing." : "No matching purchases were found for this store account."; })}><RefreshCw size={16} />{busy === "restore" ? "Restoring…" : "Restore purchases"}</button><button className="secondary-button" disabled={Boolean(busy) || !services.supported()} onClick={() => void action("manage", async () => { await services.manage(); return "Manage or cancel each membership in your store account."; })}>Manage subscriptions</button>{onSignOut && <button className="secondary-button" disabled={Boolean(busy)} onClick={onSignOut}>Sign out</button>}</div>
    <CourseAddOns />
    <p className="membership-store-terms"><a href="/terms.html">Terms</a> · <a href="/privacy.html">Privacy</a> · <a href="/support.html">Support</a></p>
  </div>;
}
