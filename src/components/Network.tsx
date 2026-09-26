import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, AtSign, Bell, BookOpen, CalendarDays, CheckCheck, CheckCircle2, ChevronRight, CreditCard, Database, ExternalLink, FileLock2, GraduationCap, Heart, LifeBuoy, LockKeyhole, Megaphone, MessageCircle, ShieldCheck, Signpost, Trash2, UserRoundCheck, X } from "lucide-react";
import type { AppNotification, NotificationPreferences } from "../domain";
import {
  loadAccountDeletionRequest,
  loadAcademyBillingOverview,
  loadMemberAccessSummary,
  loadNotificationPreferences,
  openAcademyBillingPortal,
  provisionAcademyMemberAccounts,
  requestAccountDeletion,
  saveNotificationPreferences,
  startAcademyCheckout,
  webBillingAvailable,
  type AcademyBillingOverview,
  type AccountDeletionRequest,
  type MemberAccessSummary,
} from "../lib/backend";
import { useModalDialog } from "../lib/useModalDialog";

export type HubSection = "settings" | "access" | "notifications";

type HubProps = {
  section: HubSection;
  onClose: () => void;
  onToast: (message: string) => void;
  onRequestMagicLink: (email: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  dataMode: "device" | "cloud";
  canManage: boolean;
  notifications: AppNotification[];
  onOpenNotification: (notification: AppNotification) => void;
  onMarkAllNotificationsRead: () => Promise<void>;
  primaryNavigation: ReactNode;
};

export function HubSheet(props: HubProps) {
  const { section, onClose } = props;
  const dialogRef = useRef<HTMLElement>(null);
  useModalDialog(dialogRef, onClose);
  const title = section === "settings" ? "Workspace settings" : section === "notifications" ? "Notifications" : "Workspace access";

  return (
    <div className="sheet-layer hub-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="hub-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-header">
          <button className="bare-icon" onClick={onClose} aria-label="Close" data-dialog-autofocus><ArrowLeft size={20} /></button>
          <div><p>Dirty Turf field tools</p><h2>{title}</h2></div>
          <button className="bare-icon" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>
        <div className="hub-body">
          {section === "settings"
            ? <SettingsPanel onToast={props.onToast} dataMode={props.dataMode} canManage={props.canManage} onSignOut={props.onSignOut} />
            : section === "notifications"
              ? <NotificationsPanel notifications={props.notifications} onOpen={props.onOpenNotification} onMarkAll={props.onMarkAllNotificationsRead} />
              : <AccessPanel onRequestMagicLink={props.onRequestMagicLink} />}
        </div>
        {props.primaryNavigation}
      </section>
    </div>
  );
}

function SettingsPanel({ onToast, dataMode, canManage, onSignOut }: { onToast: (message: string) => void; dataMode: "device" | "cloud"; canManage: boolean; onSignOut: () => Promise<void> }) {
  const [memberAccess, setMemberAccess] = useState<MemberAccessSummary | null>(null);
  const [checkingAccess, setCheckingAccess] = useState(dataMode === "cloud" && canManage);
  const [memberAccessError, setMemberAccessError] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [billing, setBilling] = useState<AcademyBillingOverview | null>(null);
  const [billingError, setBillingError] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [deletionRequest, setDeletionRequest] = useState<AccountDeletionRequest | null>(null);
  const [deletionLoading, setDeletionLoading] = useState(dataMode === "cloud");
  const [deletionError, setDeletionError] = useState(false);
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [confirmDeletion, setConfirmDeletion] = useState(false);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences | null>(null);
  const [notificationError, setNotificationError] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const notificationSavePending = useRef(false);
  const [settingsRetry, setSettingsRetry] = useState(0);

  useEffect(() => {
    let mounted = true;
    setMemberAccess(null);
    setMemberAccessError(false);
    setCheckingAccess(dataMode === "cloud" && canManage);
    if (dataMode !== "cloud" || !canManage) return () => { mounted = false; };
    void loadMemberAccessSummary()
      .then((response) => { if (mounted) setMemberAccess(response.summary); })
      .catch(() => { if (mounted) setMemberAccessError(true); })
      .finally(() => { if (mounted) setCheckingAccess(false); });
    return () => { mounted = false; };
  }, [dataMode, canManage, settingsRetry]);

  useEffect(() => {
    let mounted = true;
    setNotificationPreferences(null);
    setNotificationError(false);
    void loadNotificationPreferences()
      .then((preferences) => { if (mounted) setNotificationPreferences(preferences); })
      .catch(() => { if (mounted) setNotificationError(true); });
    return () => { mounted = false; };
  }, [dataMode, settingsRetry]);

  useEffect(() => {
    let mounted = true;
    setDeletionError(false);
    setDeletionRequest(null);
    setDeletionLoading(dataMode === "cloud");
    if (dataMode !== "cloud") {
      return () => { mounted = false; };
    }
    void loadAccountDeletionRequest()
      .then((request) => { if (mounted) setDeletionRequest(request); })
      .catch(() => { if (mounted) setDeletionError(true); })
      .finally(() => { if (mounted) setDeletionLoading(false); });
    return () => { mounted = false; };
  }, [dataMode, settingsRetry]);

  useEffect(() => {
    let mounted = true;
    setBillingError(false);
    setBilling(null);
    if (dataMode !== "cloud" || !webBillingAvailable()) {
      return () => { mounted = false; };
    }
    void loadAcademyBillingOverview()
      .then((overview) => { if (mounted) setBilling(overview); })
      .catch(() => { if (mounted) setBillingError(true); });
    return () => { mounted = false; };
  }, [dataMode, settingsRetry]);

  const provisionMembers = async () => {
    setProvisioning(true);
    try {
      const response = await provisionAcademyMemberAccounts();
      setMemberAccess(response.summary);
      onToast(response.summary.allEligibleReady
        ? "Every current Academy member now has a provisioned account."
        : `${response.summary.membersNotReady} member account${response.summary.membersNotReady === 1 ? "" : "s"} still need review.`);
    } catch {
      onToast("Member accounts could not be provisioned. Review the access service logs.");
    } finally {
      setProvisioning(false);
    }
  };

  const beginCheckout = async (planId: string) => {
    setBillingBusy(true);
    try {
      await startAcademyCheckout(planId);
    } catch {
      onToast("Secure checkout could not be opened. Try again from the Academy website.");
      setBillingBusy(false);
    }
  };

  const manageBilling = async () => {
    setBillingBusy(true);
    try {
      await openAcademyBillingPortal();
    } catch {
      onToast("Billing management could not be opened.");
      setBillingBusy(false);
    }
  };
  const submitDeletionRequest = async () => {
    if (!confirmDeletion) {
      setConfirmDeletion(true);
      return;
    }
    setDeletionBusy(true);
    try {
      const request = await requestAccountDeletion();
      setDeletionRequest(request);
      setConfirmDeletion(false);
      onToast("Account deletion request received. Support will review it before data is removed.");
    } catch {
      onToast("The deletion request could not be saved. Contact hello@dirtyturf.com.");
    } finally {
      setDeletionBusy(false);
    }
  };
  const canChoosePlan = !billing?.subscription || ["cancelled", "expired"].includes(billing.subscription.status);

  const updateNotificationPreference = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!notificationPreferences || notificationSavePending.current) return;
    notificationSavePending.current = true;
    setNotificationSaving(true);
    const previous = notificationPreferences;
    const next = { ...previous, [key]: value };
    setNotificationPreferences(next);
    try {
      await saveNotificationPreferences(next);
      onToast("Notification preferences saved.");
    } catch {
      setNotificationPreferences(previous);
      onToast("Notification preferences could not be saved.");
    } finally {
      notificationSavePending.current = false;
      setNotificationSaving(false);
    }
  };

  return <>
    <section className="profile-summary">
      <span className="avatar">DT</span>
      <div><strong>Operator workspace</strong><small>{dataMode === "cloud" ? "Connected to Supabase" : "Local demo data on this device"}</small></div>
      <button onClick={() => onToast(dataMode === "cloud" ? "Workspace connection is active." : "Connect the client Supabase schema to activate sync.")}>Status</button>
    </section>
    <div className="setting-group">
      <h3>Data boundary</h3>
      <SettingRow icon={<Database size={18} />} title="Company records" detail="Properties, quotes, visits, and photos use Supabase" />
      <SettingRow icon={<BookOpen size={18} />} title="Academy and community" detail="Courses, members, events, and progress use the native workspace" />
      <SettingRow icon={<Signpost size={18} />} title="HighLevel archive" detail="Imported records retain source IDs and migration history" />
    </div>
    {(checkingAccess || memberAccess || memberAccessError) && <div className="setting-group member-access-group">
      <h3>Member access</h3>
      {checkingAccess
        ? <div className="setting-row"><span><UserRoundCheck size={18} /></span><span><strong>Checking account readiness</strong><small>Reconciling enrolled members with Supabase Auth</small></span></div>
        : memberAccessError ? <div className="settings-loading" role="alert">Account readiness could not load. <button type="button" className="secondary-button" onClick={() => setSettingsRetry((value) => value + 1)}>Try again</button></div>
        : memberAccess && <>
          <div className="setting-row"><span>{memberAccess.allEligibleReady ? <CheckCircle2 size={18} /> : <UserRoundCheck size={18} />}</span><span><strong>{memberAccess.provisionedMembers} of {memberAccess.eligibleMembers} current members ready</strong><small>{memberAccess.enrolledReady} of {memberAccess.enrolledMembers} course enrollments are linked. Accounts are created without sending email.</small></span></div>
          <button className="secondary-button" disabled={memberAccess.allEligibleReady || provisioning} onClick={() => void provisionMembers()}>{provisioning ? "Provisioning accounts..." : memberAccess.allEligibleReady ? "Every current member is ready" : `Provision ${memberAccess.membersNotReady} missing account${memberAccess.membersNotReady === 1 ? "" : "s"}`}</button>
        </>}
    </div>}
    <div className="setting-group notification-settings">
      <h3>Email notifications</h3>
      {notificationPreferences ? <>
        <NotificationToggle label="Email notifications" detail="Master email switch" checked={notificationPreferences.emailEnabled} disabled={notificationSaving} onChange={(checked) => void updateNotificationPreference("emailEnabled", checked)} />
        <div className={notificationPreferences.emailEnabled ? "notification-options" : "notification-options disabled"}>
          <NotificationToggle label="Comments and replies" checked={notificationPreferences.replies} disabled={notificationSaving || !notificationPreferences.emailEnabled} onChange={(checked) => void updateNotificationPreference("replies", checked)} />
          <NotificationToggle label="Mentions" checked={notificationPreferences.mentions} disabled={notificationSaving || !notificationPreferences.emailEnabled} onChange={(checked) => void updateNotificationPreference("mentions", checked)} />
          <NotificationToggle label="Likes" checked={notificationPreferences.reactions} disabled={notificationSaving || !notificationPreferences.emailEnabled} onChange={(checked) => void updateNotificationPreference("reactions", checked)} />
          <NotificationToggle label="New community posts" checked={notificationPreferences.newPosts} disabled={notificationSaving || !notificationPreferences.emailEnabled} onChange={(checked) => void updateNotificationPreference("newPosts", checked)} />
          <NotificationToggle label="Academy announcements" checked={notificationPreferences.adminAnnouncements} disabled={notificationSaving || !notificationPreferences.emailEnabled} onChange={(checked) => void updateNotificationPreference("adminAnnouncements", checked)} />
          <NotificationToggle label="Events and reminders" checked={notificationPreferences.eventReminders} disabled={notificationSaving || !notificationPreferences.emailEnabled} onChange={(checked) => void updateNotificationPreference("eventReminders", checked)} />
          <NotificationToggle label="Course updates" checked={notificationPreferences.courseUpdates} disabled={notificationSaving || !notificationPreferences.emailEnabled} onChange={(checked) => void updateNotificationPreference("courseUpdates", checked)} />
          <NotificationToggle label="Weekly digest" checked={notificationPreferences.weeklyDigest} disabled={notificationSaving || !notificationPreferences.emailEnabled} onChange={(checked) => void updateNotificationPreference("weeklyDigest", checked)} />
        </div>
        <p className="setting-help" role="status">{notificationSaving ? "Saving notification preferences... " : ""}In-app alerts stay available in the bell even when email is off.</p>
      </> : notificationError ? <div className="settings-loading" role="alert">Notification settings could not load. Changes are unavailable until they do. <button type="button" className="secondary-button" onClick={() => setSettingsRetry((value) => value + 1)}>Try again</button></div> : <div className="settings-loading">Loading notification preferences...</div>}
    </div>
    {billingError && <div className="setting-group billing-group" role="alert"><h3>Billing</h3><p>Billing details could not load.</p><button type="button" className="secondary-button" onClick={() => setSettingsRetry((value) => value + 1)}>Try again</button></div>}
    {billing && (billing.subscription || billing.plans.length > 0) && <div className="setting-group billing-group">
      <h3>Billing</h3>
      {billing.subscription && <div className="billing-current">
        <span><CreditCard size={18} /></span>
        <span><strong>{billing.subscription.planName}</strong><small>{billingStatusLabel(billing.subscription.status, billing.subscription.cancelAtPeriodEnd, billing.subscription.currentPeriodEnd)}</small></span>
        <button className="icon-plain" aria-label="Manage billing" disabled={billingBusy} onClick={() => void manageBilling()}><ExternalLink size={17} /></button>
      </div>}
      {canChoosePlan && billing.plans.map((plan) => <article className="billing-plan" key={plan.id}>
        <div><strong>{plan.name}</strong><small>{plan.description}</small></div>
        <span>{formatPlanPrice(plan.amountCents, plan.currency, plan.billingInterval)}</span>
        <button className="secondary-button" disabled={billingBusy} onClick={() => void beginCheckout(plan.id)}>{billingBusy ? "Opening..." : "Choose plan"}</button>
      </article>)}
    </div>}
    <div className="setting-group account-controls">
      <h3>Privacy and account</h3>
      {deletionLoading && <div className="settings-loading" role="status">Checking account deletion status...</div>}
      {deletionError && <div className="settings-loading" role="alert">Account deletion status could not load. <button type="button" className="secondary-button" onClick={() => setSettingsRetry((value) => value + 1)}>Try again</button></div>}
      <a className="setting-row setting-link" href="/privacy.html">
        <span><FileLock2 size={18} /></span><span><strong>Privacy policy</strong><small>How account, field, course, and payment data are handled</small></span><ChevronRight size={16} />
      </a>
      <a className="setting-row setting-link" href="/support.html">
        <span><LifeBuoy size={18} /></span><span><strong>Support</strong><small>Get help with sign-in, courses, billing, or measurement</small></span><ChevronRight size={16} />
      </a>
      {deletionRequest
        ? <div className="deletion-status"><CheckCircle2 size={18} /><span><strong>Deletion requested</strong><small>{deletionStatusLabel(deletionRequest)}</small></span></div>
        : <>
          {confirmDeletion && <p className="deletion-warning">This starts a review to remove your login and personal account data. Business records that another company member must retain will be reassigned or separated before deletion.</p>}
          <button className={`secondary-button danger-button${confirmDeletion ? " confirm" : ""}`} disabled={dataMode !== "cloud" || deletionLoading || deletionError || deletionBusy} onClick={() => void submitDeletionRequest()}>
            <Trash2 size={17} />{deletionBusy ? "Submitting request..." : confirmDeletion ? "Confirm deletion request" : "Request account deletion"}
          </button>
          {confirmDeletion && <button className="text-button" onClick={() => setConfirmDeletion(false)}>Keep my account</button>}
        </>}
      <a className="deletion-details" href="/delete-account.html">What account deletion includes <ChevronRight size={13} /></a>
    </div>
    <button className="secondary-button" disabled={dataMode !== "cloud"} onClick={() => void onSignOut()}>{dataMode === "cloud" ? "Sign out" : "Device demo is not signed in"}</button>
  </>;
}

function deletionStatusLabel(request: AccountDeletionRequest) {
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(request.requestedAt));
  if (request.status === "completed") return `Completed · requested ${date}`;
  if (request.status === "declined") return `Needs follow-up · requested ${date}`;
  if (request.status === "in_review") return `Under review · requested ${date}`;
  return `Received ${date}`;
}

function formatPlanPrice(amountCents: number, currency: string, interval: string) {
  const amount = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: amountCents % 100 === 0 ? 0 : 2,
  }).format(amountCents / 100);
  return interval === "one_time" ? amount : `${amount}/${interval}`;
}

function billingStatusLabel(status: string, cancelAtPeriodEnd: boolean, periodEnd: string | null) {
  const end = periodEnd
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(periodEnd))
    : "";
  if (cancelAtPeriodEnd && end) return `Active through ${end}`;
  if (status === "active" || status === "trialing") return end ? `Active · renews ${end}` : "Active";
  return status.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function AccessPanel({ onRequestMagicLink }: { onRequestMagicLink: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    try {
      await onRequestMagicLink(email.trim());
    } finally {
      setSending(false);
    }
  };

  return <>
    <section className="access-intro"><span><ShieldCheck size={25} /></span><h3>Enter your company workspace</h3><p>Use the email connected to your Academy membership. We will send a secure sign-in link.</p></section>
    <form className="access-form" onSubmit={submit}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="operator@company.com" autoComplete="email" required /></label><button className="primary-button wide" disabled={sending || !email.trim()}>{sending ? "Sending link..." : "Email me a sign-in link"}</button></form>
    <div className="access-note"><LockKeyhole size={16} /><p>No password is stored in the app. Access and company membership are controlled by the client-owned Supabase workspace.</p></div>
  </>;
}

function NotificationsPanel({ notifications, onOpen, onMarkAll }: { notifications: AppNotification[]; onOpen: (notification: AppNotification) => void; onMarkAll: () => Promise<void> }) {
  const unread = notifications.filter((notification) => !notification.read).length;
  return <>
    <div className="panel-toolbar"><span>{unread ? `${unread} unread` : "You're all caught up"}</span>{unread > 0 && <button onClick={() => void onMarkAll()}><CheckCheck size={15} /> Mark all read</button>}</div>
    <section className="notification-list" aria-label="Recent notifications">
      {notifications.map((notification) => <button className={notification.read ? "notification-row" : "notification-row unread"} key={notification.cloudId ?? notification.id} onClick={() => onOpen(notification)}>
        <span className="notification-icon">{notificationIcon(notification.kind)}</span>
        <span><strong>{notification.title}</strong><small>{notification.detail}</small><em>{notification.age}</em></span>
        {!notification.read && <i aria-label="Unread" />}
      </button>)}
      {notifications.length === 0 && <div className="empty-state notification-empty"><Bell size={25} /><h3>No notifications yet</h3><p>Replies, likes, mentions, events, and course updates will show here.</p></div>}
    </section>
  </>;
}

function notificationIcon(kind: AppNotification["kind"]) {
  if (kind === "reply") return <MessageCircle size={18} />;
  if (kind === "mention") return <AtSign size={18} />;
  if (kind === "reaction") return <Heart size={18} />;
  if (kind === "event") return <CalendarDays size={18} />;
  if (kind === "course") return <GraduationCap size={18} />;
  return <Megaphone size={18} />;
}

function NotificationToggle({ label, detail, checked, disabled = false, onChange }: { label: string; detail?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className="toggle-row"><span><strong>{label}</strong>{detail && <small>{detail}</small>}</span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i aria-hidden="true" /></label>;
}

function SettingRow({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="setting-row"><span>{icon}</span><span><strong>{title}</strong><small>{detail}</small></span></div>;
}
