import type { TranscriptSegment } from "./types";

// ---------------------------------------------------------------------------
// Video ID extraction
// ---------------------------------------------------------------------------

/**
 * Extract the 11-character YouTube video ID from a variety of URL formats.
 *
 * Supported formats:
 *   - `https://www.youtube.com/watch?v=VIDEO_ID`
 *   - `https://youtu.be/VIDEO_ID`
 *   - `https://www.youtube.com/embed/VIDEO_ID`
 *   - `https://www.youtube.com/shorts/VIDEO_ID`
 *   - `https://m.youtube.com/watch?v=VIDEO_ID`
 *   - Plain 11-character ID
 *
 * @returns The video ID, or `null` if no match
 */
export function extractVideoId(input: string): string | null {
  const trimmed = input.trim();

  // Try each pattern in order — first match wins

  const patterns: RegExp[] = [
    // Plain ID: exactly 11 characters of [A-Za-z0-9_-]
    /^[A-Za-z0-9_-]{11}$/,

    // Standard watch URL
    /(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/watch\?.*v=([A-Za-z0-9_-]{11})/,

    // Short link
    /(?:https?:\/\/)?youtu\.be\/([A-Za-z0-9_-]{11})/,

    // Embed URL
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,

    // Shorts URL
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) {
      // If the pattern has a capture group, return that; otherwise return full match
      return match[1] ?? match[0];
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Number coercion
// ---------------------------------------------------------------------------

/** Coerce a value that may be `number | string` to `number` */
export function asNumber(v: number | string): number {
  return typeof v === "string" ? parseFloat(v) : v;
}

// ---------------------------------------------------------------------------
// Timestamp formatting
// ---------------------------------------------------------------------------

/** Format seconds as `m:ss` or `h:mm:ss` */
export function formatTimestamp(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);

  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");

  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// ---------------------------------------------------------------------------
// Transcript formatting
// ---------------------------------------------------------------------------

/** Compute total video duration in seconds from the last segment end */
export function getVideoDuration(segments: TranscriptSegment[]): number {
  if (segments.length === 0) return 0;
  const last = segments[segments.length - 1];
  return asNumber(last.start) + asNumber(last.dur);
}

/**
 * Format transcript segments as a pretty Markdown document
 * with timestamps and video metadata header.
 */
export function formatTranscriptAsMarkdown(
  segments: TranscriptSegment[],
  metadata: {
    title: string;
    videoId: string;
    videoUrl: string;
  },
): string {
  const lines: string[] = [
    `# ${metadata.title || "Untitled Video"}`,
    "",
    `- **Video ID:** \`${metadata.videoId}\``,
    `- **URL:** ${metadata.videoUrl}`,
    `- **Duration:** ${formatTimestamp(getVideoDuration(segments))}`,
    `- **Segments:** ${segments.length}`,
    "",
    "---",
    "",
    "## Transcript",
    "",
  ];

  for (const seg of segments) {
    const ts = formatTimestamp(asNumber(seg.start));
    lines.push(`**[${ts}]** ${seg.text}`);
    lines.push(""); // blank line between segments for readability
  }

  return lines.join("\n");
}

/** Flatten transcript segments into a single plain-text string */
export function formatTranscriptAsPlainText(segments: TranscriptSegment[]): string {
  return segments.map((s) => s.text).join(" ");
}

// ---------------------------------------------------------------------------
// Sanitisation
// ---------------------------------------------------------------------------

/**
 * Normalise raw segments from the API into clean `TranscriptSegment` objects.
 * The API may return `start` / `dur` as strings; we coerce to numbers.
 */
export function normaliseSegments(
  raw: Array<{ text?: string; start?: number | string; dur?: number | string }>,
): TranscriptSegment[] {
  return raw.map((seg) => ({
    text: seg.text ?? "",
    start: asNumber(seg.start ?? 0),
    dur: asNumber(seg.dur ?? 0),
  }));
}
