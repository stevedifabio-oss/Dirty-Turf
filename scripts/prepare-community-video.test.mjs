import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMMUNITY_VIDEO_UPLOAD_LIMIT, describeVideo, inspectMp4Layout, prepareCommunityVideo } from "./prepare-community-video.mjs";

let available = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); } catch { available = false; }
let directory, original, faststart;
const hash = data => createHash("sha256").update(data).digest("hex");
const run = args => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-n", ...args], { timeout: 30_000, stdio: "pipe" });
const out = name => path.join(directory, name);

describe.skipIf(!available)("local video preparation using actual ffmpeg fixtures", () => {
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "dirty-turf-video-test-"));
    original = out("original.mov"); faststart = out("already-ready.mp4");
    run(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "1.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", original]);
    run(["-i", original, "-c", "copy", "-movflags", "+faststart", "-brand", "mp42", faststart]);
  });
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it("remuxes compatible MOV without re-encoding video/audio and proves faststart, poster and original preservation", async () => {
    const before = hash(await readFile(original));
    expect((await inspectMp4Layout(original)).faststart).toBe(false);
    const { manifest, manifestFile } = await prepareCommunityVideo({ inputPath: original, outputDirectory: out("remux") });
    expect(manifest.action).toBe("remux_faststart"); expect(manifest.status).toBe("ready");
    expect(manifest.output).toMatchObject({ codec: "h264", pixelFormat: "yuv420p", width: 320, height: 180, audio: { codec: "aac" } });
    expect(manifest.outputLayout.faststart).toBe(true); expect(Object.values(manifest.checks).every(Boolean)).toBe(true);
    expect(manifest.poster.bytes).toBeGreaterThan(0); expect(manifest.originalUnchanged).toBe(true);
    expect(hash(await readFile(original))).toBe(before);
    expect((await stat(manifestFile)).mode & 0o777).toBe(0o600);
    expect((await stat(manifest.outputFile)).mode & 0o777).toBe(0o600);
    expect((await stat(manifest.posterFile)).mode & 0o777).toBe(0o600);
    expect((await stat(path.dirname(manifestFile))).mode & 0o777).toBe(0o700);
  });

  it("copies an already compatible faststart MP4 byte for byte instead of blindly transcoding", async () => {
    const { manifest } = await prepareCommunityVideo({ inputPath: faststart, outputDirectory: out("copy") });
    expect(manifest.action).toBe("copy_already_compatible"); expect(manifest.decisionReasons).toEqual([]);
    expect(manifest.status).toBe("ready"); expect(manifest.outputSha256).toBe(manifest.inputSha256);
    expect(hash(await readFile(manifest.outputFile))).toBe(hash(await readFile(faststart)));
  });

  it("normalizes an above-1080p 60fps non-H264/PCM source into bounded H264/AAC without upscaling", async () => {
    const source = out("large.mkv");
    run(["-f", "lavfi", "-i", "color=c=green:size=2000x1200:rate=60", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "0.6", "-c:v", "ffv1", "-c:a", "pcm_s16le", source]);
    const { manifest } = await prepareCommunityVideo({ inputPath: source, outputDirectory: out("encode") });
    expect(manifest.action).toBe("encode_h264_aac"); expect(manifest.status).toBe("ready");
    expect(manifest.output).toMatchObject({ codec: "h264", pixelFormat: "yuv420p", width: 1800, height: 1080, rotationDegrees: 0, audio: { codec: "aac", channels: 1 } });
    expect(manifest.output.averageFps).toBeLessThanOrEqual(30); expect(manifest.checks.noUpscale).toBe(true);
    expect(manifest.outputLayout.faststart).toBe(true); expect(manifest.output.bytes).toBeLessThan(COMMUNITY_VIDEO_UPLOAD_LIMIT);
    expect(manifest.originalUnchanged).toBe(true);
  }, 30_000);

  it("normalizes rotation into portrait pixels and does not invent an audio track", async () => {
    const rotated = out("rotated.mp4");
    run(["-display_rotation:v:0", "90", "-i", faststart, "-map", "0:v:0", "-c", "copy", "-movflags", "+faststart", rotated]);
    const { manifest } = await prepareCommunityVideo({ inputPath: rotated, outputDirectory: out("portrait") });
    expect(Math.abs(manifest.input.rotationDegrees)).toBe(90); expect(manifest.action).toBe("encode_h264_aac");
    expect(manifest.output).toMatchObject({ width: 180, height: 320, rotationDegrees: 0, audio: null });
    expect(manifest.status).toBe("ready"); expect(manifest.checks.noUpscale).toBe(true);
  });

  it("creates two-second seeking keyframes when an otherwise compatible source has a long GOP", async () => {
    const slow = out("slow-seek.mp4");
    run(["-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30", "-t", "4.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "300", "-keyint_min", "300", "-sc_threshold", "0", "-movflags", "+faststart", slow]);
    const { manifest } = await prepareCommunityVideo({ inputPath: slow, outputDirectory: out("seek") });
    expect(manifest.decisionReasons).toContain("seek_interval_normalization"); expect(manifest.action).toBe("encode_h264_aac");
    expect(manifest.outputKeyframes.frameTimesSeconds.length).toBeGreaterThanOrEqual(3);
    expect(manifest.outputKeyframes.maximumObservedGapSeconds).toBeLessThanOrEqual(2.05); expect(manifest.status).toBe("ready");
  });

  it("reports an oversized derivative as blocked, keeps the source and uploads nothing", async () => {
    const { manifest } = await prepareCommunityVideo({ inputPath: faststart, outputDirectory: out("oversize"), maxBytes: 256 });
    expect(manifest.status).toBe("blocked"); expect(manifest.locallyPrepared).toBe(false);
    expect(manifest.failedChecks).toContain("withinUploadLimit"); expect(manifest.originalUnchanged).toBe(true);
    expect(manifest.operations).toEqual({ uploads: 0, databaseWrites: 0, originalWrites: 0 });
  });

  it("holds HDR and wide-gamut inputs without producing a misleading SDR derivative", async () => {
    for (const [name, args] of [
      ["hdr", ["-color_trc", "smpte2084", "-color_primaries", "bt2020", "-colorspace", "bt2020nc"]],
      ["wide-gamut", ["-color_trc", "bt709", "-color_primaries", "bt2020", "-colorspace", "bt2020nc"]],
    ]) {
      const source = out(`${name}.mp4`);
      run(["-i", faststart, "-c", "copy", ...args, "-movflags", "+faststart", source]);
      const before = hash(await readFile(source));
      const { manifest } = await prepareCommunityVideo({ inputPath: source, outputDirectory: out(`${name}-hold`) });
      expect(manifest.status).toBe("blocked"); expect(manifest.action).toBe("hold_color_review");
      expect(manifest.locallyPrepared).toBe(false); expect(manifest.failedChecks).toContain("supportedColorProfile");
      expect(manifest.input.color.primaries).toBe("bt2020"); expect(manifest.output).toBeUndefined();
      expect(hash(await readFile(source))).toBe(before); expect(manifest.originalUnchanged).toBe(true);
      await expect(stat(manifest.outputFile)).rejects.toMatchObject({ code: "ENOENT" });
      expect(manifest.operations).toEqual({ uploads: 0, databaseWrites: 0, originalWrites: 0 });
    }
  });

  it("rejects remote inputs and existing output directories before changing an original", async () => {
    await expect(prepareCommunityVideo({ inputPath: "https://example.com/private.mp4", outputDirectory: out("remote") })).rejects.toThrow("local video");
    await expect(stat(out("remote"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(prepareCommunityVideo({ inputPath: faststart, outputDirectory: out("copy") })).rejects.toMatchObject({ code: "EEXIST" });
    expect(hash(await readFile(faststart))).not.toBe("");
  });
});

describe("input track preservation", () => {
  it("requires review for multiple tracks and subtitles instead of silently discarding them", () => {
    const video = { index: 0, codec_type: "video", width: 320, height: 180 };
    for (const extra of [[{ ...video, index: 1 }], [{ codec_type: "audio" }, { codec_type: "audio" }], [{ codec_type: "subtitle" }]]) {
      expect(() => describeVideo({ format: { duration: 1 }, streams: [video, ...extra] }, 100)).toThrow("preservation review");
    }
  });
});
