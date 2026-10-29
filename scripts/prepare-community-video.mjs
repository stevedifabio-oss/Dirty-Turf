#!/usr/bin/env node
// Local files only. This tool never uploads, changes the source, or grants access.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, mkdir, open, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execute = promisify(execFile);
export const COMMUNITY_VIDEO_UPLOAD_LIMIT = 50_000_000;

const finite = value => { const number = Number(value); return Number.isFinite(number) ? number : null; };
const ratio = value => {
  const parts = String(value ?? "").split(/[/:]/).map(Number);
  return parts.length === 2 && parts[1] ? parts[0] / parts[1] : finite(value);
};
async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function command(binary, args, timeout = 60_000) {
  try { return await execute(binary, args, { timeout, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" }); }
  catch (error) {
    // ffmpeg stderr can contain private file paths; retain it only in the private
    // manifest, never in a normal CLI error or a shell command.
    const failure = new Error(`${path.basename(binary)} could not process this local file.`);
    failure.diagnostic = String(error.stderr ?? error.message ?? "").slice(-8_000);
    throw failure;
  }
}
async function probe(file, binary) {
  const { stdout } = await command(binary, ["-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", file]);
  return JSON.parse(stdout);
}

/** Inspect MP4 atoms without loading a potentially large video into memory. */
export async function inspectMp4Layout(file) {
  const handle = await open(file, "r");
  try {
    const size = (await handle.stat()).size;
    let offset = 0, moov = null, mdat = null, fragmented = false;
    while (offset + 8 <= size) {
      const header = Buffer.alloc(16);
      const { bytesRead } = await handle.read(header, 0, 16, offset);
      if (bytesRead < 8) break;
      const type = header.toString("ascii", 4, 8);
      let atomSize = header.readUInt32BE(0), minimum = 8;
      if (atomSize === 1) {
        if (bytesRead < 16) break;
        const large = header.readBigUInt64BE(8);
        if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
        atomSize = Number(large); minimum = 16;
      } else if (atomSize === 0) atomSize = size - offset;
      if (atomSize < minimum || offset + atomSize > size) break;
      if (type === "moov" && moov === null) moov = offset;
      if (type === "mdat" && mdat === null) mdat = offset;
      if (type === "moof") fragmented = true;
      offset += atomSize;
    }
    return { moovOffset: moov, firstMediaOffset: mdat, faststart: moov !== null && mdat !== null && moov < mdat, fragmented };
  } finally { await handle.close(); }
}

export function describeVideo(data, bytes) {
  const streams = data.streams ?? [];
  const videos = streams.filter(item => item.codec_type === "video" && !item.disposition?.attached_pic);
  const audios = streams.filter(item => item.codec_type === "audio");
  if (videos.length !== 1 || audios.length > 1 || streams.some(item => item.codec_type === "subtitle")) {
    throw new Error("Multiple video/audio tracks or subtitles need an explicit preservation review.");
  }
  const video = videos[0], audio = audios[0];
  const width = finite(video.width), height = finite(video.height);
  const duration = finite(data.format?.duration) ?? finite(video.duration);
  const rotation = finite(video.side_data_list?.find(item => item.rotation !== undefined)?.rotation ?? video.tags?.rotate) ?? 0;
  const sar = ratio(video.sample_aspect_ratio) || 1;
  if (!width || !height || width < 2 || height < 2 || !duration || duration <= 0) throw new Error("A complete local video with known duration and dimensions is required.");
  const quarterTurn = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  return {
    bytes, durationSeconds: duration, width, height, rotationDegrees: rotation,
    displayWidth: quarterTurn ? height : width * sar, displayHeight: quarterTurn ? width * sar : height,
    sampleAspectRatio: sar, codec: video.codec_name, pixelFormat: video.pix_fmt, profile: video.profile,
    level: finite(video.level), averageFps: ratio(video.avg_frame_rate), nominalFps: ratio(video.r_frame_rate),
    color: { transfer: video.color_transfer ?? null, primaries: video.color_primaries ?? null, matrix: video.color_space ?? null,
      range: video.color_range ?? null, bitsPerRawSample: finite(video.bits_per_raw_sample),
      hdrMetadataTypes: (video.side_data_list ?? []).map(item => item.side_data_type ?? "").filter(type => /hdr|dovi|dolby|mastering display|content light/i.test(type)) },
    videoStreamIndex: video.index, audioStreamIndex: audio?.index ?? null,
    audio: audio ? { codec: audio.codec_name, channels: finite(audio.channels), sampleRate: finite(audio.sample_rate) } : null,
    container: data.format?.format_name ?? "", majorBrand: String(data.format?.tags?.major_brand ?? "").trim(),
  };
}

function supportedColorProfile(video) {
  const unspecified = [null, "unknown", "unspecified"];
  return [...unspecified, "bt709", "smpte170m", "bt470bg", "smpte240m", "gamma22", "gamma28", "iec61966-2-1"].includes(video.color.transfer)
    && [...unspecified, "bt709", "smpte170m", "bt470bg", "smpte240m", "bt470m"].includes(video.color.primaries)
    && [...unspecified, "bt709", "smpte170m", "bt470bg", "smpte240m"].includes(video.color.matrix)
    && video.color.hdrMetadataTypes.length === 0;
}

function compatibleVideo(video, maxEdge) {
  const shortEdge = Math.round(maxEdge * 9 / 16);
  return video.codec === "h264" && video.pixelFormat === "yuv420p" && video.level > 0 && video.level <= 40
    && Math.abs(video.rotationDegrees % 360) < .001 && Math.abs(video.sampleAspectRatio - 1) < .001
    && Math.max(video.width, video.height) <= maxEdge && Math.min(video.width, video.height) <= shortEdge
    && video.averageFps > 0 && video.averageFps <= 30.05 && (video.nominalFps ?? 0) <= 30.05;
}
const compatibleAudio = video => !video.audio || (video.audio.codec === "aac" && video.audio.channels > 0 && video.audio.channels <= 2 && video.audio.sampleRate <= 48_000);

/** Report keyframe intervals in a bounded sample; never claim full-file coverage. */
async function keyframeSample(file, index, binary) {
  const { stdout } = await command(binary, ["-v", "error", "-protocol_whitelist", "file,pipe", "-select_streams", String(index),
    "-read_intervals", "0%+12", "-skip_frame", "nokey", "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", file]);
  const times = (JSON.parse(stdout).frames ?? []).map(frame => finite(frame.best_effort_timestamp_time)).filter(value => value !== null).sort((a, b) => a - b);
  return { scope: "first_12_seconds_only", frameTimesSeconds: times, maximumObservedGapSeconds: times.length > 1 ? Math.max(...times.slice(1).map((time, i) => time - times[i])) : null };
}

export async function prepareCommunityVideo({ inputPath, outputDirectory, maxBytes = COMMUNITY_VIDEO_UPLOAD_LIMIT, maxEdge = 1920, crf = 23, ffmpeg = "ffmpeg", ffprobe = "ffprobe" }) {
  if (typeof inputPath !== "string" || !inputPath || /^[a-z][a-z0-9+.-]*:/i.test(inputPath)) throw new Error("Choose an existing local video file; URLs and playlists are not accepted.");
  if (typeof outputDirectory !== "string" || !outputDirectory) throw new Error("A new output directory is required.");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > COMMUNITY_VIDEO_UPLOAD_LIMIT) throw new Error("The output limit must be between 1 and 50,000,000 bytes.");
  if (!Number.isSafeInteger(maxEdge) || maxEdge < 640 || maxEdge > 1920 || !Number.isSafeInteger(crf) || crf < 18 || crf > 30) throw new Error("Use max-edge 640–1920 and CRF 18–30.");
  const input = await realpath(path.resolve(inputPath));
  const inputStat = await stat(input);
  if (!inputStat.isFile() || !inputStat.size) throw new Error("The source must be a nonempty regular local file.");
  const directory = path.resolve(outputDirectory);
  // Refuse to replace any existing folder or output. Originals are never edited.
  await mkdir(directory, { mode: 0o700 });
  const output = path.join(directory, "optimized.mp4"), poster = path.join(directory, "poster.jpg"), manifestFile = path.join(directory, "manifest.json");
  const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), status: "preparing", inputPath: input, maxUploadBytes: maxBytes, options: { maxEdge, crf }, outputFile: output, posterFile: poster,
    operations: { uploads: 0, databaseWrites: 0, originalWrites: 0 }, publication: { sourceOwnershipVerified: false, communityAssociationVerified: false, uploaded: false, deployed: false }, limitations: ["A progressive MP4 derivative, not adaptive streaming or an upload.", "Source ownership, exact Community association, asset registration and authorization must be verified separately before upload.", "Poster integration requires the app's private asset workflow."] };
  const save = async () => writeFile(manifestFile, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600 });
  try {
    await save();
    manifest.tools = { ffmpeg: (await command(ffmpeg, ["-version"])).stdout.split("\n")[0], ffprobe: (await command(ffprobe, ["-version"])).stdout.split("\n")[0] };
    manifest.inputSha256 = await sha256(input);
    const original = await probe(input, ffprobe);
    const source = describeVideo(original, inputStat.size);
    if (!/(?:^|,)(?:mov|mp4|matroska|webm|avi|mpegts)(?:,|$)/.test(source.container)) throw new Error("Use a self-contained MP4/MOV/WebM/MKV/AVI/TS file; source playlists require separate recovery.");
    manifest.input = source; manifest.inputLayout = await inspectMp4Layout(input);
    // SDR conversion is not a verified HDR tone-mapping pipeline. Preserve HDR,
    // wide-gamut and unfamiliar tagged inputs for an explicit color review.
    if (!supportedColorProfile(source)) {
      manifest.action = "hold_color_review"; manifest.status = "blocked";
      manifest.decisionReasons = ["color_profile_preservation_review"];
      manifest.originalUnchanged = manifest.inputSha256 === await sha256(input);
      manifest.checks = { originalUnchanged: manifest.originalUnchanged, supportedColorProfile: false };
      manifest.failedChecks = ["supportedColorProfile"]; manifest.locallyPrepared = false;
      manifest.finishedAt = new Date().toISOString(); await save();
      return { manifestFile, manifest };
    }
    manifest.inputKeyframes = await keyframeSample(input, source.videoStreamIndex, ffprobe);
    const seekNeedsWork = manifest.inputKeyframes.maximumObservedGapSeconds > 2.5
      || (source.durationSeconds > 3 && manifest.inputKeyframes.frameTimesSeconds.length < 2);
    const videoCopy = compatibleVideo(source, maxEdge) && !seekNeedsWork && source.bytes <= maxBytes;
    const audioCopy = compatibleAudio(source);
    const mp4Brand = /^(?:isom|iso[2-9]|mp4[12]|avc1|M4V|dash)$/.test(source.majorBrand);
    manifest.decisionReasons = [...(!compatibleVideo(source, maxEdge) ? ["mobile_video_normalization"] : []), ...(seekNeedsWork ? ["seek_interval_normalization"] : []),
      ...(source.bytes > maxBytes ? ["upload_size_reduction"] : []), ...(!audioCopy ? ["audio_normalization"] : []),
      ...(!manifest.inputLayout.faststart ? ["faststart_remux"] : []), ...(!mp4Brand || manifest.inputLayout.fragmented ? ["mp4_container_normalization"] : [])];
    if (videoCopy && audioCopy && mp4Brand && manifest.inputLayout.faststart && !manifest.inputLayout.fragmented) {
      manifest.action = "copy_already_compatible";
      await copyFile(input, output);
    } else {
      manifest.action = videoCopy ? (audioCopy ? "remux_faststart" : "copy_video_encode_audio") : "encode_h264_aac";
      const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-protocol_whitelist", "file,pipe", "-i", input,
        "-map", `0:${source.videoStreamIndex}`, ...(source.audio ? ["-map", `0:${source.audioStreamIndex}`] : []), "-map_metadata", "-1"];
      if (videoCopy) args.push("-c:v", "copy");
      else {
        const shortEdge = Math.round(maxEdge * 9 / 16), fps = Math.min(30, source.averageFps || 30);
        const filters = [
          ...(Math.abs(source.sampleAspectRatio - 1) > .001 ? ["scale=trunc(iw*sar/2)*2:ih"] : []),
          `scale=w='if(gte(iw,ih),min(iw,${maxEdge}),min(iw,${shortEdge}))':h='if(gte(iw,ih),min(ih,${shortEdge}),min(ih,${maxEdge}))':force_original_aspect_ratio=decrease:force_divisible_by=2`,
          "setsar=1", ...(Math.max(source.averageFps || 0, source.nominalFps || 0) > 30.05 ? [`fps=${fps}`] : []),
        ];
        args.push("-vf", filters.join(","), "-c:v", "libx264", "-preset", "fast", "-crf", String(crf), "-pix_fmt", "yuv420p", "-profile:v", "high", "-level:v", "4.0",
          "-maxrate", "4M", "-bufsize", "8M", "-g", String(Math.max(1, Math.round(fps * 2))), "-keyint_min", String(Math.max(1, Math.round(fps))),
          "-sc_threshold", "0", "-force_key_frames", "expr:gte(t,n_forced*2)", "-threads", "4", "-metadata:s:v:0", "rotate=0");
      }
      if (source.audio) args.push(...(audioCopy ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "128k", "-ac", String(Math.min(2, source.audio.channels || 2)), "-ar", "48000"]));
      args.push("-movflags", "+faststart", "-brand", "mp42", output);
      await command(ffmpeg, args, 30 * 60_000);
    }
    await chmod(output, 0o600);
    const optimizedStat = await stat(output);
    manifest.output = describeVideo(await probe(output, ffprobe), optimizedStat.size);
    manifest.outputLayout = await inspectMp4Layout(output);
    manifest.outputKeyframes = await keyframeSample(output, manifest.output.videoStreamIndex, ffprobe);
    manifest.outputSha256 = await sha256(output);
    manifest.originalUnchanged = manifest.inputSha256 === await sha256(input);
    const seekSampleOkay = source.durationSeconds <= 3 || (manifest.outputKeyframes.frameTimesSeconds.length > 1 && manifest.outputKeyframes.maximumObservedGapSeconds <= 2.5);
    const noUpscale = manifest.output.displayWidth <= source.displayWidth + 2 && manifest.output.displayHeight <= source.displayHeight + 2;
    manifest.checks = { originalUnchanged: manifest.originalUnchanged, supportedColorProfile: supportedColorProfile(manifest.output), h264MobileCompatible: compatibleVideo(manifest.output, maxEdge), aacOrNoAudio: compatibleAudio(manifest.output),
      faststartMoovBeforeMedia: manifest.outputLayout.faststart, noUpscale, durationPreserved: Math.abs(source.durationSeconds - manifest.output.durationSeconds) <= 1,
      seekSampleOkay, withinUploadLimit: optimizedStat.size <= maxBytes };
    const posterTime = Math.min(2, manifest.output.durationSeconds / 10);
    await command(ffmpeg, ["-hide_banner", "-loglevel", "error", "-nostdin", "-n", "-protocol_whitelist", "file,pipe", "-ss", String(posterTime), "-i", output,
      "-map", `0:${manifest.output.videoStreamIndex}`, "-vf", "scale=w='min(960,iw)':h='min(960,ih)':force_original_aspect_ratio=decrease", "-frames:v", "1", "-q:v", "3", poster]);
    await chmod(poster, 0o600);
    manifest.poster = { bytes: (await stat(poster)).size, sha256: await sha256(poster), timeSeconds: posterTime };
    manifest.checks.posterCreated = manifest.poster.bytes > 0;
    const failed = Object.entries(manifest.checks).filter(([, okay]) => !okay).map(([key]) => key);
    manifest.locallyPrepared = failed.length === 0;
    manifest.failedChecks = failed;
    manifest.status = failed.length ? "blocked" : "ready";
    manifest.finishedAt = new Date().toISOString();
    await save();
    return { manifestFile, manifest };
  } catch (error) {
    manifest.status = "failed"; manifest.locallyPrepared = false;
    manifest.error = error.message; if (error.diagnostic) manifest.privateDiagnostic = error.diagnostic;
    if (manifest.inputSha256) { try { manifest.originalUnchanged = manifest.inputSha256 === await sha256(input); } catch { manifest.originalUnchanged = false; } }
    manifest.finishedAt = new Date().toISOString(); await save();
    throw new Error(`${error.message} Private preparation receipt: ${manifestFile}`);
  } finally { for (const file of [output, poster, manifestFile]) await chmod(file, 0o600).catch(() => undefined); }
}

async function main(args) {
  if (args.includes("--help")) {
    console.log("Local-only video preparation; originals stay unchanged.\nnode scripts/prepare-community-video.mjs --input /local/original.mp4 --out /existing/private-parent/new-folder [--max-edge 1920] [--crf 23] [--max-bytes 50000000]\nCreates optimized.mp4, poster.jpg and a private manifest. Oversized or incompatible output stays blocked; nothing is uploaded.");
    return;
  }
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!["--input", "--out", "--max-edge", "--crf", "--max-bytes"].includes(args[i]) || !args[i + 1] || values[args[i]] !== undefined) throw new Error("Use --help for the supported local preparation options.");
    values[args[i]] = args[i + 1];
  }
  const { manifestFile, manifest } = await prepareCommunityVideo({ inputPath: values["--input"], outputDirectory: values["--out"],
    ...(values["--max-edge"] ? { maxEdge: Number(values["--max-edge"]) } : {}), ...(values["--crf"] ? { crf: Number(values["--crf"]) } : {}), ...(values["--max-bytes"] ? { maxBytes: Number(values["--max-bytes"]) } : {}) });
  console.log(JSON.stringify({ status: manifest.status, action: manifest.action, bytes: manifest.output?.bytes ?? null, withinUploadLimit: manifest.checks.withinUploadLimit ?? null, manifestFile }));
  if (!manifest.locallyPrepared) process.exitCode = 2;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
