import { useEffect, useState } from "react";
import { getWorkspaceAccessState, supabase } from "./backend";
import type { AccessState } from "./academyAccess";

/** A different account invalidates all previously displayed purchase eligibility. */
export function useBillingAccess() {
  const [access, setAccess] = useState<AccessState>({ status: "loading" });
  const [email, setEmail] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const refresh = async () => {
      const request = ++revision;
      setAccess({ status: "loading" });
      setEmail("");
      try {
        if (!supabase) { setAccess({ status: "signed_out" }); return; }
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const next = data.session ? await getWorkspaceAccessState() : { status: "signed_out" as const };
        if (active && request === revision) { setEmail(data.session?.user.email ?? ""); setAccess(next); }
      } catch { if (active && request === revision) setAccess({ status: "error" }); }
    };
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener("focus", onFocus);
    const listener = supabase?.auth.onAuthStateChange(() => {
      revision += 1; setAccess({ status: "loading" }); setEmail("");
      window.setTimeout(() => { if (active) void refresh(); });
    }).data.subscription;
    return () => { active = false; revision += 1; window.removeEventListener("focus", onFocus); listener?.unsubscribe(); };
  }, [retry]);
  return { access, accountEmail: email, refresh: () => setRetry((value) => value + 1) };
}
