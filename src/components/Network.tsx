import { useState } from "react";
import { ArrowLeft, BookOpen, Database, LockKeyhole, ShieldCheck, Signpost, X } from "lucide-react";

export type HubSection = "settings" | "access";

type HubProps = {
  section: HubSection;
  onClose: () => void;
  onToast: (message: string) => void;
  onRequestMagicLink: (email: string) => Promise<void>;
  onSignOut: () => Promise<void>;
  dataMode: "device" | "cloud";
};

export function HubSheet(props: HubProps) {
  const { section, onClose } = props;
  const title = section === "settings" ? "Workspace settings" : "Workspace access";

  return (
    <div className="sheet-layer hub-layer" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="hub-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="sheet-header">
          <button className="bare-icon" onClick={onClose} aria-label="Close"><ArrowLeft size={20} /></button>
          <div><p>Dirty Turf field tools</p><h2>{title}</h2></div>
          <button className="bare-icon" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>
        <div className="hub-body">
          {section === "settings"
            ? <SettingsPanel onToast={props.onToast} dataMode={props.dataMode} onSignOut={props.onSignOut} />
            : <AccessPanel onRequestMagicLink={props.onRequestMagicLink} />}
        </div>
      </section>
    </div>
  );
}

function SettingsPanel({ onToast, dataMode, onSignOut }: { onToast: (message: string) => void; dataMode: "device" | "cloud"; onSignOut: () => Promise<void> }) {
  return <>
    <section className="profile-summary">
      <span className="avatar">DT</span>
      <div><strong>Operator workspace</strong><small>{dataMode === "cloud" ? "Connected to Supabase" : "Local demo data on this device"}</small></div>
      <button onClick={() => onToast(dataMode === "cloud" ? "Workspace connection is active." : "Connect the client Supabase schema to activate sync.")}>Status</button>
    </section>
    <div className="setting-group">
      <h3>Data boundary</h3>
      <SettingRow icon={<Database size={18} />} title="Company records" detail="Properties, quotes, visits, and photos use Supabase" />
      <SettingRow icon={<BookOpen size={18} />} title="Academy and community" detail="Courses, members, events, and progress stay live in HighLevel" />
      <SettingRow icon={<Signpost size={18} />} title="Future native rebuild" detail="Import provenance and cutover gates are documented" />
    </div>
    <button className="secondary-button" disabled={dataMode !== "cloud"} onClick={() => void onSignOut()}>{dataMode === "cloud" ? "Sign out" : "Device demo is not signed in"}</button>
  </>;
}

function AccessPanel({ onRequestMagicLink }: { onRequestMagicLink: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    await onRequestMagicLink(email.trim());
    setSending(false);
  };

  return <>
    <section className="access-intro"><span><ShieldCheck size={25} /></span><h3>Enter your company workspace</h3><p>Use the email invited by the client administrator. We will send a secure sign-in link.</p></section>
    <form className="access-form" onSubmit={submit}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="operator@company.com" autoComplete="email" required /></label><button className="primary-button wide" disabled={sending || !email.trim()}>{sending ? "Sending link..." : "Email me a sign-in link"}</button></form>
    <div className="access-note"><LockKeyhole size={16} /><p>No password is stored in the app. Access and company membership are controlled by the client-owned Supabase workspace.</p></div>
  </>;
}

function SettingRow({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="setting-row"><span>{icon}</span><span><strong>{title}</strong><small>{detail}</small></span></div>;
}
