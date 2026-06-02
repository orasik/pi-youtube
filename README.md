# pi-youtube

YouTube transcript & AI-powered summary extension for [pi](https://github.com/earendil-works/pi-coding-agent).



https://github.com/user-attachments/assets/721c14bd-6d87-40d0-8004-a6dbf0657b8b


## Install

```bash
pi install npm:pi-youtube
```

## Commands

| Command | Description |
|---|---|
| `/youtube <url>` | Fetch transcript & trigger LLM summarisation |
| `/youtube-config` | View current save-directory settings |
| `/youtube-config set transcriptDir ~/path` | Change transcript output directory |
| `/youtube-config set summaryDir ~/path` | Change summary output directory |

## How it works

1. Extracts the YouTube video ID from the URL via regex
2. Calls YouTube's InnerTube API (ANDROID client context) to get video metadata + caption track URLs
3. Fetches the timedtext transcript in JSON format
4. Saves a timestamped Markdown transcript file
5. Sends a structured summarisation prompt to the LLM
6. The LLM produces a comprehensive summary and writes it to disk

**Zero dependencies** — uses only built-in `fetch`.

## Config

Default save locations (edit `~/.pi/youtube-config.json`):

```json
{
  "transcriptDir": "~/YouTube/transcripts",
  "summaryDir": "~/YouTube/summaries"
}
```

Both paths support `~` home-directory expansion.

## License

MIT
