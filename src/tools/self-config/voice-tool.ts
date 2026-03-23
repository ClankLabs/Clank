/**
 * Voice tools — let the agent generate speech and transcribe audio.
 *
 * "Read this summary out loud" → agent uses tts tool
 * "What did they say in that voice message?" → agent uses stt tool
 */

import { TTSEngine, STTEngine } from "../../voice/index.js";
import { loadConfig } from "../../config/index.js";
import type { Tool, ToolContext, ValidationResult } from "../types.js";

export const ttsTool: Tool = {
  definition: {
    name: "text_to_speech",
    description:
      "Convert text to speech audio using ElevenLabs. Returns the audio file path. " +
      "Requires ElevenLabs integration to be configured.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to convert to speech" },
        voice_id: { type: "string", description: "ElevenLabs voice ID (optional, uses default)" },
      },
      required: ["text"],
    },
  },

  safetyLevel: "low",
  readOnly: true,

  validate(args: Record<string, unknown>): ValidationResult {
    if (!args.text || typeof args.text !== "string") return { ok: false, error: "text is required" };
    if ((args.text as string).length > 5000) return { ok: false, error: "text too long (max 5000 chars)" };
    return { ok: true };
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const config = await loadConfig();
    const engine = new TTSEngine(config);

    if (!engine.isAvailable()) {
      return "Error: ElevenLabs not configured. Tell me to set it up, or run: clank setup --section integrations";
    }

    const result = await engine.synthesize(args.text as string, {
      voiceId: args.voice_id as string | undefined,
    });

    if (!result) return "Error: TTS synthesis failed";

    // Save to temp file and return path
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const outPath = join(tmpdir(), `clank-tts-${Date.now()}.${result.format}`);
    await writeFile(outPath, result.audioBuffer);

    return `Audio generated: ${outPath} (${result.format}, ${Math.round(result.audioBuffer.length / 1024)}KB)`;
  },
};

export const sttTool: Tool = {
  definition: {
    name: "speech_to_text",
    description:
      "Transcribe an audio file to text using Whisper (OpenAI API or local whisper.cpp). " +
      "Provide a file path to an audio file.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path to audio file (.mp3, .wav, .ogg, .m4a)" },
      },
      required: ["file_path"],
    },
  },

  safetyLevel: "low",
  readOnly: true,

  validate(args: Record<string, unknown>): ValidationResult {
    if (!args.file_path || typeof args.file_path !== "string") return { ok: false, error: "file_path is required" };
    return { ok: true };
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const { readFile } = await import("node:fs/promises");
    const { existsSync } = await import("node:fs");

    const filePath = args.file_path as string;
    if (!existsSync(filePath)) return `Error: File not found: ${filePath}`;

    const config = await loadConfig();
    const engine = new STTEngine(config);

    if (!engine.isAvailable()) {
      return "Error: Speech-to-text not configured. Need OpenAI API key or local whisper.cpp installed.";
    }

    const audioBuffer = await readFile(filePath);
    const ext = filePath.split(".").pop() || "wav";
    const result = await engine.transcribe(audioBuffer, ext);

    if (!result) return "Error: Transcription failed";
    return result.text;
  },
};

export const voiceListTool: Tool = {
  definition: {
    name: "list_voices",
    description: "List available ElevenLabs voices for text-to-speech.",
    parameters: { type: "object", properties: {} },
  },

  safetyLevel: "low",
  readOnly: true,

  validate(): ValidationResult { return { ok: true }; },

  async execute(): Promise<string> {
    const config = await loadConfig();
    const engine = new TTSEngine(config);

    if (!engine.isAvailable()) {
      return "Error: ElevenLabs not configured.";
    }

    const voices = await engine.listVoices();
    if (voices.length === 0) return "No voices found or API error.";
    return voices.map((v) => `${v.name}: ${v.id}`).join("\n");
  },
};
