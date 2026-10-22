import { useEffect, useRef, useState } from "react";
import { CircleAlert, LoaderCircle, ShieldCheck } from "lucide-react";
import { previewMemberInviteAction, runMemberInviteAction, type AdminMemberInviteAction, type AdminMemberInvitePreview } from "../lib/adminBackend";

type Props = { disabled: boolean; onRun: (action: AdminMemberInviteAction, execute: () => Promise<unknown>, message: string) => Promise<boolean> };

const reviewReasons: Record<string, string> = {
  member_identity_requires_review: "The membership identity needs review.",
  duplicate_member_invites: "More than one invitation is linked to this member. Review the records first.",
  member_is_not_active: "This membership is not active.",
  invitation_is_cancelled: "This invitation was cancelled.",
  email_delivery_outcome_requires_review: "An earlier email may already have been sent. Check delivery records before approving a resend.",
  invalid_member_email: "The membership email needs correction.",
  duplicate_member_email: "Another member has this email. Confirm the correct account first.",
  duplicate_auth_email: "More than one sign-in account matches this email. Review the accounts first.",
  linked_auth_identity_mismatch: "The membership and sign-in account do not match.",
  shared_auth_identity: "This sign-in account is linked to more than one member. Review the accounts first.",
  auth_sign_in_restricted: "The sign-in account is restricted or unconfirmed.",
  account_already_prepared: "This account is already prepared. No new setup is needed.",
  account_must_be_prepared_first: "Set up this account before sending its first sign-in email.",
  member_already_signed_in: "This member has already signed in.",
  sign_in_email_already_sent: "The first sign-in email has already been sent. Check its delivery before another email.",
  member_not_in_community_invite_queue: "This member is not in the current invitation list.",
};

/** Review exactly who will be affected before any Auth or mail mutation. */
export function AdminMemberSetup({ disabled, onRun }: Props) {
  const [action, setAction] = useState<AdminMemberInviteAction>("provision");
  const [inventory, setInventory] = useState<AdminMemberInvitePreview | null>(null);
  const [review, setReview] = useState<AdminMemberInvitePreview | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const locked = useRef(false);
  const disabledRef = useRef(disabled);
  const reviewRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const focusInventory = useRef(false);
  disabledRef.current = disabled;
  const limit = action === "notify" ? 25 : 50;
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => { if (review) reviewRef.current?.focus(); }, [review]);
  useEffect(() => {
    if (inventory && !pending && focusInventory.current) {
      focusInventory.current = false;
      searchRef.current?.focus();
    }
  }, [inventory, pending]);
  useEffect(() => {
    setExpired(false);
    if (!review?.previewExpiresAt) return;
    const timer = setTimeout(() => setExpired(true), Math.max(0, Date.parse(review.previewExpiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [review?.previewToken, review?.previewExpiresAt]);

  const reset = (next: AdminMemberInviteAction) => {
    if (locked.current || disabledRef.current) return;
    request.current++; setAction(next); setInventory(null); setReview(null); setSelected([]); setSearch(""); setError("");
  };
  const loadPreview = async (ids: string[]) => {
    if (locked.current || disabledRef.current) return;
    locked.current = true; setPending(true); setError(""); setReview(null);
    const current = ++request.current;
    try {
      const next = await previewMemberInviteAction(action, ids);
      if (current !== request.current) return;
      if (ids.length) setReview(next);
      else { focusInventory.current = true; setInventory(next); setSelected([]); }
    } catch (caught) {
      if (current === request.current) setError(caught instanceof Error ? caught.message : "The member preview could not load. Try again.");
    } finally { if (current === request.current) { locked.current = false; setPending(false); } }
  };
  const toggle = (id: string) => {
    if (locked.current || disabledRef.current) return;
    setReview(null); setError("");
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : current.length < limit ? [...current, id] : current);
  };
  const execute = async () => {
    if (locked.current || disabledRef.current || expired || !review?.previewToken || !review.previewExpiresAt || review.blocked.length ||
      !selected.length || review.selected.length !== selected.length) return;
    locked.current = true; setPending(true); setError("");
    const current = ++request.current;
    const approved = review;
    setReview(null); // Every attempt consumes the local approval, including partial failures.
    try {
      const saved = await onRun(action, () => runMemberInviteAction(action, { memberIds: selected, inviteIds: approved.selected.map(member => member.inviteId), previewToken: approved.previewToken!, previewExpiresAt: approved.previewExpiresAt! }),
        action === "notify" ? "Selected sign-in email batch completed. Review statuses before another batch." : "Selected account setup completed. No emails were sent.");
      if (current !== request.current) return;
      setInventory(null); setSelected([]);
      if (!saved) setError("Review current member statuses and load a new preview before trying again.");
    } catch (caught) {
      if (current === request.current) setError(caught instanceof Error ? caught.message : "The member action could not be confirmed. Review statuses before trying again.");
    } finally { if (current === request.current) { locked.current = false; setPending(false); } }
  };
  const visible = (inventory?.candidates ?? []).filter(member => `${member.displayName} ${member.email}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const ready = Boolean(!expired && review?.previewToken && review.previewExpiresAt && !review.blocked.length && selected.length && review.selected.length === selected.length);
  return <details className="admin-composer admin-account-setup">
    <summary><ShieldCheck size={17} /> Account setup and sign-in emails</summary>
    <div className="admin-member-setup">
      <p>Select the exact members to prepare. Account setup creates sign-in accounts without sending email. Email is a separate reviewed action.</p>
      <fieldset disabled={disabled || pending} className="admin-member-setup-fields">
        <label>What would you like to do?<select value={action} onChange={event => reset(event.target.value as AdminMemberInviteAction)}>
          <option value="provision">Set up accounts · no email</option><option value="notify">Send first sign-in email</option>
        </select></label>
        <button className="secondary-button" type="button" onClick={() => void loadPreview([])}>Load eligible members</button>
        {inventory && <>
          <label>Search eligible members<input ref={searchRef} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or email" /></label>
          <p className="admin-results-count" role="status">{selected.length} selected · {visible.length} of {inventory.candidates.length} eligible shown · maximum {limit}</p>
          <p className="admin-form-note">Search only changes what is shown. Selected members remain selected until you uncheck them or clear the selection.</p>
          <div className="admin-member-candidates">{visible.map(member => <label key={member.academyMemberId} className="admin-member-candidate">
            <input type="checkbox" checked={selected.includes(member.academyMemberId)} disabled={!selected.includes(member.academyMemberId) && selected.length >= limit} onChange={() => toggle(member.academyMemberId)} />
            <span><strong>{member.displayName || "Member"}</strong><small>{member.email}</small></span><small>{member.inviteStatus}</small>
          </label>)}{!visible.length && <p>{inventory.candidates.length ? "No matching eligible members." : "No members need this action. This does not prove the source roster is complete."}</p>}</div>
          <div className="admin-member-actions"><button type="button" className="secondary-button" disabled={!selected.length} onClick={() => { if (!locked.current && !disabledRef.current) { setSelected([]); setReview(null); } }}>Clear selection</button>
            <button type="button" className="secondary-button" disabled={!selected.length} onClick={() => void loadPreview(selected)}>Review selected {selected.length || "members"}</button></div>
        </>}
      </fieldset>
      {pending && <p role="status"><LoaderCircle size={16} className="spin" /> Checking selected member accounts…</p>}
      {error && <p role="alert" className="admin-action-error"><CircleAlert size={16} /> {error}</p>}
      {review && <section ref={reviewRef} tabIndex={-1} className="admin-member-review" aria-label="Selected member review">
        <h4>{action === "notify" ? "Review email recipients" : "Review account setup"}</h4>
        <ul>{review.selected.map(member => <li key={member.academyMemberId}><strong>{member.displayName || "Member"}</strong><span>{member.email}</span></li>)}</ul>
        {review.blocked.length > 0 && <div role="alert"><p>Some selected members need review. No action can run for this selection.</p><ul>{review.blocked.map(member => <li key={member.academyMemberId}>{inventory?.candidates.find(candidate => candidate.academyMemberId === member.academyMemberId)?.email ?? "Selected member"}: {reviewReasons[member.reason] ?? "This member's account details changed. Review the current records before continuing."}</li>)}</ul></div>}
        {ready && <p>{action === "notify" ? "Only the people listed above will receive a sign-in email." : "Only the people listed above will get account setup. No email will be sent."} This preview expires in 10 minutes; changed member status requires another review.</p>}
        {expired && <p role="alert">This preview expired. Choose Review selected again before continuing.</p>}
        <button type="button" className="primary-button" disabled={disabled || pending || !ready} onClick={() => void execute()}>{action === "notify" ? `Send ${review.selected.length} sign-in email${review.selected.length === 1 ? "" : "s"}` : `Set up ${review.selected.length} account${review.selected.length === 1 ? "" : "s"} · no email`}</button>
      </section>}
    </div>
  </details>;
}
