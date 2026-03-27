/**
 * Web fetch tool — fetch content from a URL.
 */

import type { Tool, ToolContext, ValidationResult } from "./types.js";

const MAX_BODY = 500 * 1024; // 500KB cap

/**
 * Strip HTML to readable text.
 * Removes scripts, styles, and tags; collapses whitespace; decodes common entities.
 */
function htmlToText(html: string): string {
  let text = html;
  // Remove script/style blocks entirely
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  // Convert block-level tags to newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|br|hr|blockquote|section|article|header|footer|nav|main)[\s>]/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  // Collapse whitespace: multiple spaces → single, but preserve newlines
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\n[ \t]+/g, "\n");
  text = text.replace(/[ \t]+\n/g, "\n");
  // Collapse 3+ newlines → 2
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

export const webFetchTool: Tool = {
  definition: {
    name: "web_fetch",
    description: "Fetch content from a URL. HTML pages are converted to readable plain text. JSON is returned as-is. Max 500KB.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
      },
      required: ["url"],
    },
  },

  safetyLevel: "low",
  readOnly: true,

  validate(args: Record<string, unknown>): ValidationResult {
    if (!args.url || typeof args.url !== "string") {
      return { ok: false, error: "url is required" };
    }
    try {
      const parsed = new URL(args.url as string);
      // Block SSRF targets
      if (parsed.protocol === "file:") return { ok: false, error: "file:// URLs are not allowed" };
      const host = parsed.hostname.toLowerCase();
      // Block loopback
      if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "0.0.0.0") {
        return { ok: false, error: "localhost URLs are blocked (SSRF protection)" };
      }
      // Block private RFC 1918 ranges
      if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
        return { ok: false, error: "Private network IPs are blocked (SSRF protection)" };
      }
      // Block IPv4-mapped IPv6
      if (host.startsWith("[::ffff:")) {
        return { ok: false, error: "IPv4-mapped IPv6 addresses are blocked" };
      }
      // Block cloud metadata
      if (host === "169.254.169.254" || host === "metadata.google.internal") {
        return { ok: false, error: "Cloud metadata endpoints are blocked" };
      }
      // Block internal hostnames
      if (host.endsWith(".internal") || host.endsWith(".local")) {
        return { ok: false, error: "Internal network hostnames are blocked" };
      }
    } catch {
      return { ok: false, error: "Invalid URL" };
    }
    return { ok: true };
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const url = args.url as string;

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "Clank/0.1.0" },
        signal: ctx.signal || AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        return `HTTP ${res.status}: ${res.statusText}`;
      }

      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const json = await res.json();
        const text = JSON.stringify(json, null, 2);
        return text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "\n... (truncated)" : text;
      }

      const raw = await res.text();
      // If it looks like HTML, extract readable text
      const text = contentType.includes("text/html") || raw.trimStart().startsWith("<!") || raw.trimStart().startsWith("<html")
        ? htmlToText(raw)
        : raw;
      return text.length > MAX_BODY ? text.slice(0, MAX_BODY) + "\n... (truncated)" : text;
    } catch (err) {
      return `Fetch error: ${err instanceof Error ? err.message : err}`;
    }
  },
};
