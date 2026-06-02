/**
 * YouTube Extension for pi
 *
 * Commands:
 *   /youtube <url>         Fetch transcript & trigger LLM summarisation
 *   /youtube-config [args] View or update save-directory configuration
 *
 * Flow:
 *   1. Extract video ID from the provided URL via regex
 *   2. Fetch the full transcript + title via YouTube's InnerTube API
 *   3. Fetch the video thumbnail from YouTube's CDN
 *   4. Save the transcript as a timestamped Markdown file
 *   5. Render the thumbnail inline in the chat (PNG, via a custom message)
 *   6. Send the summarisation prompt to the LLM as a HIDDEN message — the
 *      transcript/prompt go to the model but are never dumped into the chat
 *   7. Show a "Summarising…" working indicator while the LLM streams
 *   8. The LLM writes the structured summary to disk
 *
 * The chat therefore shows only: progress, the thumbnail, and the summary.
 *
 * Config:  ~/.pi/youtube-config.json
 * Prompt:  ~/.pi/agent/YOUTUBE.md  (optional override)
 * Defaults:
 *   transcriptDir → ~/YouTube/transcripts
 *   summaryDir    → ~/YouTube/summaries
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { convertToPng } from "@earendil-works/pi-coding-agent";
import { Box, Image, Text } from "@earendil-works/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";

import { fetchTranscript } from "./transcript-client";
import { loadConfig, saveConfig, CONFIG_PATH } from "./config";
import { buildSummaryPrompt } from "./prompt";
import {
  extractVideoId,
  formatTimestamp,
  formatTranscriptAsMarkdown,
  formatTranscriptAsPlainText,
  getVideoDuration,
  normaliseSegments,
} from "./utils";

import type { YoutubeConfig } from "./types";

// ---------------------------------------------------------------------------
// Thumbnail helpers
// ---------------------------------------------------------------------------

const THUMBNAIL_FALLBACKS = [
  (id: string) => `https://img.youtube.com/vi/${id}/maxresdefault.jpg`,
  (id: string) => `https://img.youtube.com/vi/${id}/hqdefault.jpg`,
  (id: string) => `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
];

/** A decoded thumbnail ready for both inline rendering and the LLM message. */
interface Thumbnail {
  /** Base64-encoded JPEG bytes (no data-URI prefix). */
  data: string;
  /** MIME type — always image/jpeg for YouTube CDN thumbnails. */
  mimeType: "image/jpeg";
}

/**
 * Try to fetch the video thumbnail as raw base64 JPEG bytes.
 * Falls back through progressively smaller thumbnails.
 */
async function fetchThumbnail(videoId: string): Promise<Thumbnail | null> {
  // Try each resolution in order
  for (const urlFn of THUMBNAIL_FALLBACKS) {
    try {
      const resp = await fetch(urlFn(videoId));
      if (!resp.ok) continue;

      const arrayBuffer = await resp.arrayBuffer();
      // Filter out placeholder images (YouTube returns a tiny default for missing)
      if (arrayBuffer.byteLength < 1000) continue;

      return {
        data: Buffer.from(arrayBuffer).toString("base64"),
        mimeType: "image/jpeg",
      };
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Spinner frames
// ---------------------------------------------------------------------------

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function youtubeExtension(pi: ExtensionAPI) {
  // Tracks whether *we* installed the streaming "Summarising…" indicator, so
  // the agent_end handler only restores defaults for our own turns.
  let summarising = false;

  // -----------------------------------------------------------------------
  // Inline thumbnail rendering
  //
  // Images attached to a user message are NOT rendered in the TUI (only their
  // text blocks are). To show the thumbnail inline in the chat we inject a
  // custom message and render it ourselves with pi-tui's Image component.
  //
  // The image data here must be PNG: the Kitty graphics protocol (used by
  // Ghostty/Kitty) only accepts PNG (f=100), so a JPEG would render as a blank
  // box. The command handler converts the JPEG thumbnail before sending.
  // -----------------------------------------------------------------------
  pi.registerMessageRenderer("youtube-thumbnail", (message, _opts, theme) => {
    const d = message.details as
      | { data?: string; mimeType?: string; title?: string }
      | undefined;
    if (!d) return undefined;

    const box = new Box(1, 0, (t) => theme.bg("customMessageBg", t));
    if (d.title) box.addChild(new Text(theme.fg("accent", `📺 ${d.title}`), 0, 0));
    if (d.data && d.mimeType) {
      box.addChild(
        new Image(
          d.data,
          d.mimeType,
          { fallbackColor: (s) => theme.fg("dim", s) },
          { maxWidthCells: 48 },
        ),
      );
    }
    return box;
  });

  // Restore the default working indicator once our summarisation turn ends.
  pi.on("agent_end", async (_event, ctx) => {
    if (!summarising) return;
    summarising = false;
    ctx.ui.setWorkingMessage();
    ctx.ui.setWorkingIndicator();
  });

  // -----------------------------------------------------------------------
  // /youtube <url>
  // -----------------------------------------------------------------------
  pi.registerCommand("youtube", {
    description: "Fetch YouTube transcript and summarise the video",
    handler: async (args, ctx) => {
      const input = args.trim();
      if (!input) {
        ctx.ui.notify("Usage: /youtube <video-url>", "error");
        return;
      }

      // 1. Extract video ID -------------------------------------------------
      const videoId = extractVideoId(input);
      if (!videoId) {
        ctx.ui.notify(
          `Could not extract a YouTube video ID from: ${input}`,
          "error",
        );
        return;
      }

      const config = loadConfig();
      const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

      // ---- Spinner animation during fetch --------------------------------
      let spinnerIdx = 0;
      const spinnerInterval = setInterval(() => {
        spinnerIdx = (spinnerIdx + 1) % SPINNER.length;
        ctx.ui.setStatus(
          "youtube",
          `${SPINNER[spinnerIdx]} Fetching transcript for ${videoId} …`,
        );
      }, 80);

      // 2. Fetch transcript + thumbnail in parallel -------------------------
      let title: string;
      let segments: ReturnType<typeof normaliseSegments>;
      let thumbnail: Awaited<ReturnType<typeof fetchThumbnail>>;

      try {
        const [raw, thumb] = await Promise.all([
          fetchTranscript(videoId),
          fetchThumbnail(videoId),
        ]);
        thumbnail = thumb;

        title = raw.title || "Untitled";
        const firstTrack = raw.tracks?.[0];
        const rawSegments = firstTrack?.transcript ?? [];

        if (rawSegments.length === 0) {
          clearInterval(spinnerInterval);
          ctx.ui.setStatus("youtube", undefined);
          ctx.ui.notify(
            "No transcript available — this video may not have captions.",
            "warning",
          );
          return;
        }

        segments = normaliseSegments(rawSegments);
      } catch (err: unknown) {
        clearInterval(spinnerInterval);
        ctx.ui.setStatus("youtube", undefined);
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(`Failed to fetch transcript: ${msg}`, "error");
        return;
      }

      clearInterval(spinnerInterval);
      ctx.ui.setStatus("youtube", undefined);

      // ---- Show the thumbnail inline in the chat --------------------------
      // Render it ourselves via a custom message (display only — its content is
      // never shown, only our renderer's Image is). Convert JPEG → PNG first so
      // the Kitty graphics protocol can decode it.
      if (thumbnail) {
        const png = await convertToPng(thumbnail.data, thumbnail.mimeType);
        pi.sendMessage(
          {
            customType: "youtube-thumbnail",
            // content is required but unused by our renderer; keep it minimal.
            content: `📺 ${title}`,
            display: true,
            details: png
              ? { data: png.data, mimeType: png.mimeType, title }
              : { title },
          },
          { triggerTurn: false },
        );
      }

      const duration = formatTimestamp(getVideoDuration(segments));
      ctx.ui.notify(
        `✓  ${title}  •  ${segments.length} segments  •  ${duration}`,
        "info",
      );

      // 3. Save transcript as Markdown --------------------------------------
      const transcriptDir = config.transcriptDir;
      fs.mkdirSync(transcriptDir, { recursive: true });

      const transcriptName = `${videoId}_transcript.md`;
      const transcriptPath = path.join(transcriptDir, transcriptName);
      const transcriptMd = formatTranscriptAsMarkdown(segments, {
        title,
        videoId,
        videoUrl,
      });
      fs.writeFileSync(transcriptPath, transcriptMd, "utf-8");

      ctx.ui.notify(`Transcript saved → ${transcriptPath}`, "info");

      // 4. Build summarisation prompt (with user override if present) --------
      const summaryDir = config.summaryDir;
      fs.mkdirSync(summaryDir, { recursive: true });

      const summaryName = `${videoId}_summary.md`;
      const summaryPath = path.join(summaryDir, summaryName);

      const promptText = buildSummaryPrompt({
        transcript: formatTranscriptAsPlainText(segments),
        title,
        url: videoUrl,
        duration,
        summaryPath,
      });

      // 5. Send prompt to the LLM — WITHOUT dumping it into the chat ---------
      // A custom message with `display: false` is converted to an LLM user
      // message (so the model receives the full prompt + transcript) but is
      // never rendered in the TUI. pi's ImageContent shape is
      // { type: "image", data, mimeType } — NOT the Anthropic `source` shape.
      const llmContent: Array<
        | { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [
        {
          type: "text",
          text: `📺 ${title}\n${videoUrl} • ${duration} • ${segments.length} segments`,
        },
      ];

      if (thumbnail) {
        llmContent.push({
          type: "image",
          data: thumbnail.data,
          mimeType: thumbnail.mimeType,
        });
      }

      llmContent.push({ type: "text", text: promptText });

      // ---- Show "Summarising…" during streaming --------------------------
      // Use the built-in streaming working indicator (reliable across custom
      // footers); it's restored to default by the agent_end handler above.
      summarising = true;
      ctx.ui.setWorkingMessage("Summarising…");
      ctx.ui.setWorkingIndicator({ frames: SPINNER, intervalMs: 100 });

      ctx.ui.notify("Summarising — the transcript was saved, not shown.", "info");

      pi.sendMessage(
        {
          customType: "youtube-summary-request",
          content: llmContent,
          display: false, // hidden from the chat; still sent to the LLM
        },
        { triggerTurn: true },
      );
    },
  });

  // -----------------------------------------------------------------------
  // /youtube-config  —  view or update save-directory config
  // -----------------------------------------------------------------------
  pi.registerCommand("youtube-config", {
    description: "Show or update YouTube extension configuration",
    handler: async (args, ctx) => {
      const config = loadConfig();

      // Handle "set <key> <value>" -------------------------------------------------
      const parts = args.trim().split(/\s+/);
      if (parts.length >= 2 && parts[0] === "set") {
        const key = parts[1] as keyof YoutubeConfig;
        const value = parts.slice(2).join(" ");

        if (key !== "transcriptDir" && key !== "summaryDir") {
          ctx.ui.notify(
            `Unknown config key "${key}". Valid keys: transcriptDir, summaryDir`,
            "error",
          );
          return;
        }

        try {
          saveConfig(key, value);
          ctx.ui.notify(`✓ ${key} = ${value}`, "info");
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.ui.notify(`Failed to save config: ${msg}`, "error");
        }
        return;
      }

      // Show current config ----------------------------------------------------------
      const lines = [
        "YouTube Extension Configuration",
        "",
        `  transcriptDir  ${config.transcriptDir}`,
        `  summaryDir     ${config.summaryDir}`,
        "",
        `Config file: ${CONFIG_PATH}`,
        "",
        "Usage:",
        "  /youtube-config                     show this screen",
        "  /youtube-config set transcriptDir ~/MyTranscripts",
        "  /youtube-config set summaryDir    ~/MySummaries",
      ];

      const selected = await ctx.ui.select("YouTube Config", lines);
      if (selected) {
        ctx.ui.notify(selected, "info");
      }
    },
  });
}
