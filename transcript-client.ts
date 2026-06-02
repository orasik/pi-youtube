/**
 * TranscriptClient — talks directly to YouTube's InnerTube API.
 *
 * Flow:
 *   1. POST youtubei/v1/player  (ANDROID client → avoids bot detection)
 *   2. Extract videoDetails.title + captionTracks[].baseUrl
 *   3. Fetch timedtext with fmt=json3 for clean JSON
 *   4. Parse events[] into TranscriptSegment[]
 *
 * Zero dependencies — uses only built-in fetch.
 */

import type { TranscriptResult, TranscriptTrack, TranscriptSegment } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INNERTUBE_API = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

const ANDROID_CONTEXT = {
  client: { clientName: "ANDROID", clientVersion: "20.10.38" },
};

const ANDROID_UA = "com.google.android.youtube/20.10.38 (Linux; U; Android 14)";

// ---------------------------------------------------------------------------
// Internal types for the API responses
// ---------------------------------------------------------------------------

interface CaptionTrackRaw {
  baseUrl: string;
  languageCode: string;
  kind?: string; // "asr" = auto-generated, absent = manual
  vssId?: string;
}

interface InnerTubeResponse {
  videoDetails?: { title?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrackRaw[];
    };
  };
}

interface TimedTextEvent {
  tStartMs: number;
  dDurationMs: number;
  segs?: Array<{ utf8?: string }>;
}

interface TimedTextResponse {
  events?: TimedTextEvent[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fetch transcript + title for a YouTube video.
 *
 * @param videoId  11-character YouTube video ID
 * @param options  Language preference & custom fetch function
 * @throws On video unavailable, no captions, or network errors
 */
export async function fetchTranscript(
  videoId: string,
  options?: {
    /** ISO 639-1 language code (e.g. "en", "ja") */
    lang?: string;
    /** Custom fetch (for proxies / testing) */
    fetchFn?: typeof fetch;
  },
): Promise<TranscriptResult> {
  const fetchImpl = options?.fetchFn ?? fetch;

  // ---- 1. Call InnerTube -------------------------------------------------
  const resp = await fetchImpl(INNERTUBE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": ANDROID_UA,
    },
    body: JSON.stringify({
      context: ANDROID_CONTEXT,
      videoId,
    }),
  });

  if (!resp.ok) {
    throw new Error(`InnerTube API returned HTTP ${resp.status}`);
  }

  const data = (await resp.json()) as InnerTubeResponse;

  // ---- 2. Extract title --------------------------------------------------
  const title = data?.videoDetails?.title ?? "";
  if (!title) {
    // Try to extract from playabilityStatus reason
    const ps = (data as any)?.playabilityStatus;
    if (ps?.status === "ERROR") {
      throw new Error(ps?.reason ?? "Video unavailable");
    }
  }

  // ---- 3. Extract caption tracks -----------------------------------------
  const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw new Error(`No captions available for ${videoId}`);
  }

  // ---- 4. Pick language --------------------------------------------------
  const track = pickBestTrack(tracks, options?.lang);

  // ---- 5. Fetch the timedtext (fmt=json3 for clean JSON) ----------------
  // Replace fmt=srv3 with fmt=json3 for machine-parseable output
  const jsonUrl = track.baseUrl.replace(/fmt=[^&]+/, "fmt=json3");

  const ttResp = await fetchImpl(jsonUrl, {
    headers: { "User-Agent": ANDROID_UA },
  });

  if (!ttResp.ok) {
    throw new Error(`Timedtext API returned HTTP ${ttResp.status}`);
  }

  const ttData = (await ttResp.json()) as TimedTextResponse;
  const events = ttData?.events;

  if (!Array.isArray(events) || events.length === 0) {
    throw new Error(`Transcript for ${videoId} is empty`);
  }

  // ---- 6. Build segments -------------------------------------------------
  const segments: TranscriptSegment[] = [];
  for (const ev of events) {
    const text = (ev.segs ?? [])
      .map((s) => s.utf8 ?? "")
      .join("")
      .trim();
    if (text.length === 0) continue; // skip blank pauses/breaks

    segments.push({
      text,
      start: ev.tStartMs / 1000,
      dur: ev.dDurationMs / 1000,
    });
  }

  if (segments.length === 0) {
    throw new Error(`Transcript for ${videoId} has no readable content`);
  }

  // ---- 7. Return ---------------------------------------------------------
  const trackObj: TranscriptTrack = {
    language: formatLanguage(track.languageCode, track.kind),
    transcript: segments,
  };

  return {
    id: videoId,
    title,
    tracks: [trackObj],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Pick the best caption track based on language preference */
function pickBestTrack(
  tracks: CaptionTrackRaw[],
  preferredLang?: string,
): CaptionTrackRaw {
  if (!preferredLang) {
    // Prefer manual English > auto English > whatever's first
    return (
      tracks.find((t) => t.languageCode === "en" && t.kind !== "asr") ??
      tracks.find((t) => t.languageCode === "en") ??
      tracks[0]
    );
  }

  return (
    tracks.find(
      (t) =>
        t.languageCode === preferredLang &&
        t.kind !== "asr",
    ) ??
    tracks.find((t) => t.languageCode === preferredLang) ??
    tracks[0]
  );
}

/** Format language code + kind into a human-readable label */
function formatLanguage(code: string, kind?: string): string {
  if (kind === "asr") return `${code} (auto-generated)`;
  return code;
}
