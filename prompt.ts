// ---------------------------------------------------------------------------
// Summarisation prompt — with user-override support
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Built-in default prompt
// ---------------------------------------------------------------------------

const DEFAULT_PROMPT = `You are an expert at analysing and summarising video content.
I will provide you with the full transcript of a YouTube video.

**Your task:** Create a comprehensive, well-structured summary in Markdown
format and save it to the file path specified below.

Use the following template structure for the summary:

---

# \${title}

## 📋 Overview
A concise 2–3 sentence summary of what the video is about.

## 🎯 Main Points
- Each main point as a bullet point
- Group related ideas together
- Be specific, not vague

## 👤 People Mentioned
- **Name** — Role / affiliation, and what they said or contributed

## 🛠️ Tools, Technologies & Products Mentioned
- **Tool Name** — What it is and how it was discussed

## 💡 Key Takeaways
1. Actionable insight
2. Important lesson
3. …etc.

## 📚 Resources & References
- Any books, papers, links, or resources mentioned

## 🔗 Video Info
- **Title:** \${title}
- **URL:** \${url}
- **Duration:** \${duration}

---

**Important instructions:**
- Use the EXACT transcript content provided below — do not fabricate or guess
  details.
- If a section has no relevant information (e.g. no people mentioned), write
  *"None mentioned"* rather than omitting the section.
- Be thorough but concise — quality over quantity.
- Save the completed summary using the **write** tool to this exact path:

  \`\${summaryPath}\`

Here is the transcript:

---

\${transcript}

---

Now please create the summary and save it to \`\${summaryPath}\` using the write tool.`;

// ---------------------------------------------------------------------------
// User-override path
// ---------------------------------------------------------------------------

const USER_PROMPT_PATH = path.join(os.homedir(), ".pi", "agent", "YOUTUBE.md");

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Template variables available for substitution */
export interface PromptVariables {
  transcript: string;
  title: string;
  url: string;
  duration: string;
  summaryPath: string;
}

/**
 * Build the full summarisation prompt to send to the LLM.
 *
 * If `~/.pi/agent/YOUTUBE.md` exists, its content is used as the prompt
 * template.  Otherwise the built-in default is used.
 *
 * Template variables: `${title}`, `${url}`, `${duration}`,
 * `${summaryPath}`, `${transcript}`
 */
export function buildSummaryPrompt(vars: PromptVariables): string {
  const template = loadPromptTemplate();
  return applyTemplate(template, vars);
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Load the prompt template: user file first, default fallback */
function loadPromptTemplate(): string {
  try {
    if (fs.existsSync(USER_PROMPT_PATH)) {
      const raw = fs.readFileSync(USER_PROMPT_PATH, "utf-8").trim();
      if (raw.length > 0) return raw;
    }
  } catch {
    // Permission error, malformed, etc. — use default
  }
  return DEFAULT_PROMPT;
}

/** Replace `${key}` placeholders in the template with values */
function applyTemplate(
  template: string,
  vars: PromptVariables,
): string {
  return template
    .replace(/\$\{title\}/g, vars.title)
    .replace(/\$\{url\}/g, vars.url)
    .replace(/\$\{duration\}/g, vars.duration)
    .replace(/\$\{summaryPath\}/g, vars.summaryPath)
    .replace(/\$\{transcript\}/g, vars.transcript);
}
