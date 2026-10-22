import { useEffect, useRef, useState } from "react";
import { COMMUNITY_TERMS_VERSION } from "../lib/termsConsent";
import { useModalDialog } from "../lib/useModalDialog";
import { loadLegalDocument, type LegalDocumentName } from "../lib/legalDocument";

export function TermsChoice({ checked, onChange, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const [document, setDocument] = useState<"terms" | "privacy" | null>(null);
  return <div className="terms-agreement">
    <label className="terms-consent"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} required aria-describedby="community-conduct-summary" /><span>I agree to the <button type="button" className="terms-link" onClick={() => setDocument("terms")}>Terms of Use and Community Rules</button> and acknowledge the <button type="button" className="terms-link" onClick={() => setDocument("privacy")}>Privacy Policy</button>.</span></label>
    <p id="community-conduct-summary" className="terms-summary">There is zero tolerance for objectionable content or abusive users. Report inappropriate content and block abusive members in Community.</p>
    {document && <LegalDocument document={document} onDocumentChange={setDocument} onClose={() => setDocument(null)} />}
  </div>;
}

function LegalDocument({ document, onDocumentChange, onClose }: { document: LegalDocumentName; onDocumentChange: (document: LegalDocumentName) => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLElement>(null);
  const [html, setHtml] = useState<string>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useModalDialog(dialogRef, onClose);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setHtml(undefined); setError(false);
    void loadLegalDocument(document, controller.signal).then(value => { if (active) setHtml(value); }).catch(() => { if (active) setError(true); });
    return () => { active = false; controller.abort(); };
  }, [document, retry]);
  const title = document === "terms" ? "Terms of Use and Community Rules" : "Privacy Policy";
  return <div className="legal-document-backdrop"><section ref={dialogRef} className="legal-document-dialog" role="dialog" aria-modal="true" aria-labelledby="legal-document-title">
    <header><h2 id="legal-document-title">{title}</h2><button type="button" className="secondary-button" onClick={onClose} data-dialog-autofocus>Close</button></header>
    <nav className="legal-document-tabs" aria-label="Legal documents"><button type="button" className="secondary-button" aria-pressed={document === "terms"} onClick={() => onDocumentChange("terms")}>Terms and Community Rules</button><button type="button" className="secondary-button" aria-pressed={document === "privacy"} onClick={() => onDocumentChange("privacy")}>Privacy Policy</button></nav>
    {html ? <iframe srcDoc={html} title={title} sandbox="" tabIndex={0} /> : <div className="legal-document-status" role={error ? "alert" : "status"}>{error ? <><p>This document could not load. Reconnect and try again.</p><button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>Retry</button></> : <p>Loading {title.toLowerCase()}…</p>}</div>}
  </section></div>;
}

export function CommunityTermsGate({ onAccept, onSignOut, pendingLink = false }: { onAccept: () => void; onSignOut: () => Promise<void>; pendingLink?: boolean }) {
  const [checked, setChecked] = useState(false);
  return <main className="launch-gate"><section className="launch-card">
    <img src="/dirty-turf-logo.png" alt="Dirty Turf" />
    <p className="kicker">Dirty Turf Academy</p><h1>Before you continue.</h1>
    <p className="launch-copy">Read and agree to our community terms before {pendingLink ? "completing your sign-in" : "using the Academy"}.</p>
    <TermsChoice checked={checked} onChange={setChecked} />
    <button className="primary-button wide" disabled={!checked} onClick={() => { if (checked) onAccept(); }}>Agree and continue</button>
    <button className="launch-auth-switch" type="button" onClick={() => void onSignOut()}>Sign out</button>
    <p className="terms-version">Community terms · {COMMUNITY_TERMS_VERSION}</p>
  </section></main>;
}
