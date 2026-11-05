import { useMemo, useState } from "react";
import { NativeMemberships, type nativeMembershipServices } from "./NativeMemberships";
import { MEMBERSHIP_PRODUCTS, type MembershipProductId } from "../lib/nativeMemberships";
export default function NativeMembershipPreview() {
  const [selected, setSelected] = useState<MembershipProductId[]>([]);
  const services = useMemo<typeof nativeMembershipServices>(() => {
    let owned: MembershipProductId[] = [];
    let trialEnd: string | null = null;
    return {
      supported: () => true,
      load: async () => ({ available: true, status: { enabled: true, products: [...MEMBERSHIP_PRODUCTS], ownedProducts: [...owned], trialEligible: !trialEnd && !owned.includes(MEMBERSHIP_PRODUCTS[1]), trialUsed: Boolean(trialEnd), trialExpiresAt: trialEnd }, products: MEMBERSHIP_PRODUCTS.map((id, index) => ({ id, displayName: ["Community", "Turf Scanner", "Turf Cleaning Academy"][index], displayPrice: index === 0 ? "$19.99" : "$24.95", priceAmountMicros: index === 0 ? 19_990_000 : 24_950_000, currencyCode: "USD" })) }),
      purchase: async id => { owned = [...new Set([...owned, id])]; setSelected([...owned]); return "purchased"; },
      trial: async () => { trialEnd = new Date(Date.now() + 7 * 86400_000).toISOString(); return { started: true, alreadyUsed: false, expiresAt: trialEnd }; },
      restore: async () => ({ confirmed: owned.length, failed: 0 }),
      manage: async () => undefined,
      listen: async () => () => undefined,
    };
  }, []);
  return <main className="membership-shell"><div className="upgrades-availability" role="status"><strong>Sample signup — no real purchases</strong><p>This example only changes this page. Choose any memberships to see independent access.</p></div><NativeMemberships services={services} access={{ status: "no_access" }} /><div className="upgrades-availability"><strong>Sample access</strong><p>Community: {selected.includes(MEMBERSHIP_PRODUCTS[0]) ? "On" : "Off"} · Turf Scanner: {selected.includes(MEMBERSHIP_PRODUCTS[1]) ? "On" : "Off"} · Academy: {selected.includes(MEMBERSHIP_PRODUCTS[2]) ? "On" : "Off"}</p><button className="secondary-button" onClick={() => window.location.reload()}>Reset sample</button></div></main>;
}
