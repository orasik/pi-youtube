import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { YoutubeConfig } from "./types";

// ---------------------------------------------------------------------------
// Config file path & defaults
// ---------------------------------------------------------------------------

const CONFIG_PATH = path.join(os.homedir(), ".pi", "youtube-config.json");

const DEFAULTS: YoutubeConfig = {
  transcriptDir: "~/YouTube/transcripts",
  summaryDir: "~/YouTube/summaries",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Expand `~/...` paths to absolute paths */
function expandHome(dir: string): string {
  if (dir.startsWith("~/")) {
    return path.join(os.homedir(), dir.slice(2));
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Load config from disk, falling back to defaults */
export function loadConfig(): YoutubeConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
      const user = JSON.parse(raw) as Partial<YoutubeConfig>;
      return {
        transcriptDir: expandHome(user.transcriptDir ?? DEFAULTS.transcriptDir),
        summaryDir: expandHome(user.summaryDir ?? DEFAULTS.summaryDir),
      };
    }
  } catch {
    // Malformed JSON or permission error — fall through to defaults
  }
  return {
    transcriptDir: expandHome(DEFAULTS.transcriptDir),
    summaryDir: expandHome(DEFAULTS.summaryDir),
  };
}

/** Persist a config key/value pair to disk */
export function saveConfig(key: keyof YoutubeConfig, value: string): void {
  const current: YoutubeConfig = (() => {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
        return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<YoutubeConfig>) };
      }
    } catch {
      /* use defaults */
    }
    return { ...DEFAULTS };
  })();

  current[key] = value;

  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2), "utf-8");
}

/** Path to the config file (for display purposes) */
export { CONFIG_PATH };
