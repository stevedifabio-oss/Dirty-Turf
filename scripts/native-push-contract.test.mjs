import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
describe('native push source contracts',()=>{
 it('keeps Firebase Messaging automatic initialization off until explicit registration',()=>{
  expect(read('android/app/src/main/AndroidManifest.xml')).toMatch(/android:name="firebase_messaging_auto_init_enabled"\s+android:value="false"/);
  expect(read('android/app/src/main/AndroidManifest.xml')).toContain('android.permission.POST_NOTIFICATIONS');
 });
 it('pins the reviewed Capacitor8 plugin and prepares both platform dependencies',()=>{
  expect(JSON.parse(read('package.json')).dependencies['@capacitor/push-notifications']).toBe('8.1.3');
  expect(read('android/capacitor.settings.gradle')).toContain("include ':capacitor-push-notifications'");
  expect(read('ios/App/CapApp-SPM/Package.swift')).toContain('.product(name: "CapacitorPushNotifications", package: "CapacitorPushNotifications")');
 });
 it('prepares real APNs callbacks and environment-specific signing entitlements',()=>{
  expect(read('ios/App/App/AppDelegate.swift')).toContain('.capacitorDidRegisterForRemoteNotifications');
  expect(read('ios/App/App/AppDelegate.swift')).toContain('.capacitorDidFailToRegisterForRemoteNotifications');
  expect(read('ios/App/App/DirtyTurf.entitlements')).toContain('<key>aps-environment</key><string>$(APS_ENVIRONMENT)</string>');
  expect(read('ios/App/App.xcodeproj/project.pbxproj')).toContain('APS_ENVIRONMENT = development;');
  expect(read('ios/App/App.xcodeproj/project.pbxproj')).toContain('APS_ENVIRONMENT = production;');
 });
});
