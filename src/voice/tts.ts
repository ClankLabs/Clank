/**
 * Voice system — TTS and STT powered by integrations config.
 *
 * TTS: ElevenLabs (cloud) or piper (local)
 * STT: OpenAI Whisper API (cloud) or whisper.cpp (local)
 *
 * The agent uses these through tools — it can generate speech
 * from text and transcribe audio from voice messages.
 */

import type { ClankConfig } from "../config/index.js";

export interface TTSResult {
  audioBuffer: Buffer;
  format: "mp3" | "wav" | "ogg";
}

export interface STTResult {
  text: string;
  language?: string;
}

/**
 * Text-to-Speech engine.
 */
export class TTSEngine {
  private config: ClankConfig;

  constructor(config: ClankConfig) {
    this.config = config;
  }

  /** Check if TTS is available */
  isAvailable(): boolean {
    return !!(this.config.integrations.elevenlabs?.enabled && this.config.integrations.elevenlabs?.apiKey);
  }

  /** Convert text to speech */
  async synthesize(text: string, opts?: { voiceId?: string }): Promise<TTSResult | null> {
    const elevenlabs = this.config.integrations.elevenlabs;
    if (!elevenlabs?.enabled || !elevenlabs.apiKey) return null;

    const voiceId = opts?.voiceId || elevenlabs.voiceId || "JBFqnCBsd6RMkjVDRZzb"; // Default: George
    const model = elevenlabs.model || "eleven_multilingual_v2";

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": elevenlabs.apiKey,
          },
          body: JSON.stringify({
            text,
            model_id: model,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
        },
      );

      if (!res.ok) {
        const err = await res.text().catch(() => "");
        console.error(`ElevenLabs TTS error ${res.status}: ${err}`);
        return null;
      }

      const arrayBuffer = await res.arrayBuffer();
      return {
        audioBuffer: Buffer.from(arrayBuffer),
        format: "mp3",
      };
    } catch (err) {
      console.error(`TTS error: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  /** List available voices from ElevenLabs */
  async listVoices(): Promise<Array<{ id: string; name: string }>> {
    const elevenlabs = this.config.integrations.elevenlabs;
    if (!elevenlabs?.enabled || !elevenlabs.apiKey) return [];

    try {
      const res = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": elevenlabs.apiKey },
      });
      if (!res.ok) return [];
      const data = await res.json() as { voices?: Array<{ voice_id: string; name: string }> };
      return (data.voices || []).map((v) => ({ id: v.voice_id, name: v.name }));
    } catch {
      return [];
    }
  }
}

/**
 * Speech-to-Text engine.
 */
export class STTEngine {
  private config: ClankConfig;

  constructor(config: ClankConfig) {
    this.config = config;
  }

  /** Check if STT is available */
  isAvailable(): boolean {
    const whisper = this.config.integrations.whisper;
    if (whisper?.enabled) {
      if (whisper.provider === "openai" && whisper.apiKey) return true;
      if (whisper.provider === "local") return true;
    }
    // Fall back to OpenAI key from model providers
    if (this.config.models.providers.openai?.apiKey) return true;
    return false;
  }

  /** Transcribe audio to text */
  async transcribe(audioBuffer: Buffer, format = "ogg"): Promise<STTResult | null> {
    const whisper = this.config.integrations.whisper;

    // Try OpenAI Whisper API
    const apiKey = whisper?.apiKey || this.config.models.providers.openai?.apiKey;
    if (apiKey && whisper?.provider !== "local") {
      return this.transcribeOpenAI(audioBuffer, format, apiKey);
    }

    // Try local whisper.cpp
    return this.transcribeLocal(audioBuffer, format);
  }

  /** Transcribe via OpenAI Whisper API */
  private async transcribeOpenAI(audioBuffer: Buffer, format: string, apiKey: string): Promise<STTResult | null> {
    try {
      // Build multipart form data
      const blob = new Blob([new Uint8Array(audioBuffer)], { type: `audio/${format}` });
      const formData = new FormData();
      formData.append("file", blob, `audio.${format}`);
      formData.append("model", "whisper-1");

      const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}` },
        body: formData,
      });

      if (!res.ok) return null;
      const data = await res.json() as { text?: string; language?: string };
      return data.text ? { text: data.text, language: data.language } : null;
    } catch {
      return null;
    }
  }

  /** Transcribe via local whisper.cpp */
  private async transcribeLocal(audioBuffer: Buffer, format: string): Promise<STTResult | null> {
    try {
      const { writeFile, unlink } = await import("node:fs/promises");
      const { execSync } = await import("node:child_process");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      const tmpFile = join(tmpdir(), `clank-stt-${Date.now()}.${format}`);
      await writeFile(tmpFile, audioBuffer);

      const output = execSync(`whisper "${tmpFile}" --model base.en --output-txt`, {
        encoding: "utf-8",
        timeout: 60_000,
      });

      await unlink(tmpFile).catch(() => {});
      return output.trim() ? { text: output.trim() } : null;
    } catch {
      return null;
    }
  }
}
