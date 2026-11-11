import { useEffect, useRef, useState } from "react";
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { Download, X } from "lucide-react";
import { APP_BUNDLE_ID, APP_RELEASE_CHECK_INTERVAL, appReleaseKey, appStoreUrl, fetchAppRelease, isNewerAppRelease, type AppPlatform, type AppRelease } from "../lib/appUpdates";
import "./app-update-notice.css";
import { resolveAppUpdateNotice } from "../lib/nativePush";

const DISMISSED_RELEASE = "dirty-turf-dismissed-app-release-v1";
const OPEN_NOTICE = "dirty-turf-open-app-update";
export function requestAppUpdateNotice(notificationId: string) {
  window.dispatchEvent(new CustomEvent(OPEN_NOTICE, { detail: notificationId }));
}

/** Optional, nonblocking store notice. No push registration or update installation. */
export function AppUpdateNotice() {
  const [available, setAvailable] = useState<{ platform: AppPlatform; release: AppRelease } | null>(null);
  const dismissed = useRef("");
  useEffect(() => {
    const detected = Capacitor.getPlatform();
    const platform = Capacitor.isNativePlatform() && (detected === "ios" || detected === "android") ? detected : null;
    let disposed = false;
    let checking = false;
    let lastCheck: number | undefined;
    let removeListener: (() => Promise<void>) | undefined;
    try { dismissed.current = localStorage.getItem(DISMISSED_RELEASE) ?? ""; } catch { /* Storage can be unavailable. */ }
    const check = async () => {
      if (!platform) return;
      if (disposed || checking || (lastCheck !== undefined && Date.now() - lastCheck < APP_RELEASE_CHECK_INTERVAL)) return;
      checking = true;
      lastCheck = Date.now();
      setAvailable(current => current && Date.parse(current.release.expiresAt) <= Date.now() ? null : current);
      try {
        const installed = await App.getInfo();
        if (disposed || installed.id !== APP_BUNDLE_ID) return;
        const release = await fetchAppRelease(platform);
        if (disposed) return;
        setAvailable(release && isNewerAppRelease(release, installed, platform) && appReleaseKey(platform, release) !== dismissed.current ? { platform, release } : null);
      } catch { /* Offline and unavailable native APIs never block use of the app. */ }
      finally { checking = false; }
    };
    void check();
    const openNotice = (event: Event) => {
      const id: unknown = (event as CustomEvent).detail;
      if (typeof id !== "string") return;
      void resolveAppUpdateNotice(id).then(async notice => {
        if (disposed || !notice || (platform && notice.platform !== platform)) return;
        if (!platform) { setAvailable(notice); return; }
        const installed = await App.getInfo();
        if (!disposed && installed.id === APP_BUNDLE_ID && isNewerAppRelease(notice.release, installed, platform)) setAvailable(notice);
      }).catch(() => undefined);
    };
    window.addEventListener(OPEN_NOTICE, openNotice);
    void App.addListener("appStateChange", ({ isActive }) => { if (isActive) void check(); }).then(handle => {
      if (disposed) void handle.remove().catch(() => undefined);
      else removeListener = () => handle.remove();
    }).catch(() => undefined);
    return () => { disposed = true; window.removeEventListener(OPEN_NOTICE, openNotice); void removeListener?.().catch(() => undefined); };
  }, []);

  if (!available) return null;
  const dismiss = () => {
    dismissed.current = appReleaseKey(available.platform, available.release);
    try { localStorage.setItem(DISMISSED_RELEASE, dismissed.current); } catch { /* Dismiss still works for this session. */ }
    setAvailable(null);
  };
  return <aside className="app-update-notice" aria-label="App update" role="status">
    <Download size={22} aria-hidden="true" />
    <div className="app-update-notice-copy"><strong>A new app version is available</strong><p>Dirty Turf {available.release.availableVersion} is ready in the {available.platform === "ios" ? "App Store" : "Google Play Store"}.</p>{available.release.releaseNotes && <p>{available.release.releaseNotes}</p>}
      <a className="primary-button" href={appStoreUrl(available.platform)} target="_blank" rel="noopener noreferrer">View update</a>
    </div>
    <button type="button" className="app-update-notice-dismiss" onClick={dismiss} aria-label="Dismiss app update notice"><X size={20} /></button>
  </aside>;
}
