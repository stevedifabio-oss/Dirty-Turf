import { describe, expect, it } from "vitest";
import { assertAuthPluginRegistered } from "./native-plugin-registry.mjs";

describe("native auth plugin release gate", () => {
  it("rejects an Android bundle whose dependency is present but unregistered", () => {
    expect(() => assertAuthPluginRegistered("[]", "android", "AAB")).toThrow("native App plugin is missing");
    expect(() => assertAuthPluginRegistered('[{"pkg":"@capacitor/app","classpath":"wrong.Class"}]', "android", "AAB")).toThrow();
  });

  it("accepts the generated Android App plugin registry", () => {
    expect(() => assertAuthPluginRegistered('[{"pkg":"@capacitor/app","classpath":"com.capacitorjs.plugins.app.AppPlugin"}]', "android", "AAB")).not.toThrow();
  });

  it("requires AppPlugin in the built iOS configuration", () => {
    expect(() => assertAuthPluginRegistered("{}", "ios", "iOS app")).toThrow();
    expect(() => assertAuthPluginRegistered('{"packageClassList":["AppPlugin"]}', "ios", "iOS app")).not.toThrow();
  });
});
