import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HubSheet } from "./Network";
import { PrimaryNavigation } from "./PrimaryNavigation";

vi.mock("../lib/backend", () => ({
  defaultNotificationPreferences: {},
  loadAccountDeletionRequest: vi.fn(),
  loadAcademyBillingOverview: vi.fn(),
  loadMemberAccessSummary: vi.fn(),
  loadNotificationPreferences: vi.fn(),
  openAcademyBillingPortal: vi.fn(),
  provisionAcademyMemberAccounts: vi.fn(),
  requestAccountDeletion: vi.fn(),
  saveNotificationPreferences: vi.fn(),
  startAcademyCheckout: vi.fn(),
  webBillingAvailable: () => false,
}));

const noOp = vi.fn();

function navigation(settingsOpen: boolean) {
  return <PrimaryNavigation activeView="learn" settingsOpen={settingsOpen} onNavigate={noOp} onOpenSettings={noOp} />;
}

describe("PrimaryNavigation", () => {
  it("keeps exactly one primary destination active when Settings is open", () => {
    const markup = renderToStaticMarkup(navigation(true));
    expect(markup.match(/aria-current="page"/g)).toHaveLength(1);
    expect(markup).toMatch(/aria-current="page"[^>]*>.*Settings/s);
  });

  it("renders the primary navigation inside the Settings dialog", () => {
    const markup = renderToStaticMarkup(
      <HubSheet
        section="settings"
        onClose={noOp}
        onToast={noOp}
        onRequestMagicLink={async () => undefined}
        onSignOut={async () => undefined}
        dataMode="device"
        canManage={false}
        notifications={[]}
        onOpenNotification={noOp}
        onMarkAllNotificationsRead={async () => undefined}
        primaryNavigation={navigation(true)}
      />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-label="App sections"');
    expect(markup.indexOf('aria-label="App sections"')).toBeGreaterThan(markup.indexOf('role="dialog"'));
  });
});
