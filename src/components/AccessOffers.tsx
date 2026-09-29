import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { ArrowRight, LockKeyhole } from "lucide-react";
import type { AccessState } from "../lib/academyAccess";
import { loadMembershipCatalog, membershipPrice, planPurchaseState, type MembershipPlan } from "../lib/membershipBilling";

export function AccessRequired({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="access-required"><LockKeyhole size={24} /><h2>{title}</h2><p>{children}</p></section>;
}

export function AvailableUpgrades({ access, kind, feature }: { access: AccessState; kind?: "membership" | "course" | "tool"; feature?: string }) {
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const native = Capacitor.isNativePlatform();
  useEffect(() => {
    let active = true;
    setPlans([]); setError(false);
    if (!native && access.status === "member" && access.pricingGatesEnabled) {
      void loadMembershipCatalog().then((catalog) => { if (active) setPlans(catalog.plans); }).catch(() => { if (active) setError(true); });
    }
    return () => { active = false; };
  }, [native, access, retry]);
  if (native || access.status !== "member" || !access.pricingGatesEnabled) return null;
  if (error) return <section className="access-required" role="alert"><p>Options could not load.</p><button className="secondary-button" onClick={() => setRetry((value) => value + 1)}>Try again</button></section>;
  const available = plans.filter((plan) => (!kind || (plan.offerKind ?? "membership") === kind) && (!feature || plan.featureKeys?.includes(feature)) && planPurchaseState(plan, access) === "available");
  if (!available.length) return null;
  return <section className="access-offers" aria-label="Available upgrades">{available.map((plan) => <article key={plan.id}><div><h3>{plan.name}</h3><p>{plan.description}</p><strong>{membershipPrice(plan)} {plan.billingInterval === "one_time" ? "one-time" : `per ${plan.billingInterval}`}</strong></div><a className="secondary-button" href={`/membership?plan=${encodeURIComponent(plan.id)}`}>Upgrade <ArrowRight size={16} /></a></article>)}</section>;
}
