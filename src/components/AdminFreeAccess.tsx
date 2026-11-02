import { useEffect, useRef, useState } from "react";
import { loadFreeAccess, saveFreeAccess, type FreeAccessGrant } from "../lib/freeAccess";

export function AdminFreeAccess({ memberId, courses, disabled, onChange }: {
  memberId: string; courses: { id: string; title: string }[]; disabled: boolean; onChange: () => void;
}) {
  const [grants, setGrants] = useState<FreeAccessGrant[] | null>(null);
  const [expires, setExpires] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const options = [{ id: "community", title: "Community" }, { id: "measuring_tool", title: "Turf Scanner" }, ...courses];
  const run = async (resource?: string, mutate?: boolean) => {
    if (lock.current || disabled) return;
    lock.current = true; setPending(true); setMessage("");
    try {
      if (resource !== undefined && mutate !== undefined) {
        await saveFreeAccess(memberId, resource, mutate, mutate && expires ? new Date(expires).toISOString() : null);
        onChange();
      }
      const current = await loadFreeAccess(memberId);
      if (mounted.current) { setGrants(current); if (mutate !== undefined) setMessage(mutate ? "Free access saved. Billing is unchanged." : "Free grant removed. Paid and existing access are unchanged."); }
    } catch (error) { if (mounted.current) { setGrants(null); setMessage(error instanceof Error ? error.message : "Access could not be confirmed. Reload before trying again."); } }
    finally { lock.current = false; if (mounted.current) setPending(false); }
  };
  return <details className="admin-composer" onToggle={event => {
    if (event.currentTarget.open && grants === null && !lock.current) void run();
  }}><summary>Free access · owner controls</summary>
    <p>These choices apply only to this member. Check an item to grant free access; uncheck it to remove only your free grant. Existing and paid access are preserved.</p>
    <p>Only the verified steve@dirtyturf.com master account can change these grants.</p>
    <button type="button" className="secondary-button" disabled={disabled || pending} onClick={() => void run()}>Reload free grants</button>
    {grants && <fieldset disabled={disabled || pending} className="admin-course-access"><legend>Free access for this member</legend>
      <label>New grant expiration (leave blank for permanent)<input type="datetime-local" value={expires} onChange={event => setExpires(event.target.value)} /></label>
      {options.map(option => {
        const grant = grants.find(item => item.resource === option.id);
        return <label key={option.id}><input type="checkbox" checked={Boolean(grant)} onChange={event => void run(option.id, event.target.checked)} />
          <span>{option.title}{grant && <small> · {grant.endsAt ? `until ${new Date(grant.endsAt).toLocaleString()}` : "Permanent free access"}</small>}</span>
        </label>;
      })}
    </fieldset>}
    {pending && <p role="status">Checking free access…</p>}{message && <p role="status">{message}</p>}
  </details>;
}
