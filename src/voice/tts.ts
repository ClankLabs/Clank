/**
 * Voice / TTS system.
 *
 * Supports both cloud (ElevenLabs) and local (piper) TTS.
 * Voice-in → voice-out routing: receive voice message → transcribe
 * via whisper.cpp → agent processes → TTS → audio reply.
 *
 * Voice selection is per-agent configurable.
 */

export interface VoiceConfig {
  enabled: boolean;
  provider: "elevenlabs" | "piper" | "none";
  elevenlabs?: {
    apiKey: string;
    voiceId: string;
  };
  piper?: {
    modelPath: string;
  };
}

export interface TTSResult {
  audioBuffer: Buffer;
  format: "mp3" | "wav" | "ogg";
  durationMs: number;
}

export class TTSEngine {
  private config: VoiceConfig;

  constructor(config: VoiceConfig) {
    this.config = config;
  }

  /** Convert text to speech */
  async synthesize(text: string): Promise<TTSResult | null> {
    if (!this.config.enabled || this.config.provider === "none") {
      return null;
    }

    switch (this.config.provider) {
      case "elevenlabs":
        return this.synthesizeElevenLabs(text);
      case "piper":
        return this.synthesizePiper(text);
      default:
        return null;
    }
  }

  /** ElevenLabs cloud TTS */
  private async synthesizeElevenLabs(text: string): Promise<TTSResult | null> {
    const config = this.config.elevenlabs;
    if (!config?.apiKey || !config.voiceId) return null;

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "xi-api-key": config.apiKey,
          },
          body: JSON.stringify({
            text,
            model_id: "eleven_monolingual_v1",
          }),
        },
      );

      if (!res.ok) return null;

      const arrayBuffer = await res.arrayBuffer();
      return {
        audioBuffer: Buffer.from(arrayBuffer),
        format: "mp3",
        durationMs: 0, // Would need audio parsing to determine
      };
    } catch {
      return null;
    }
  }

  /** Local piper TTS */
  private async synthesizePiper(text: string): Promise<TTSResult | null> {
    // Piper runs as a subprocess: echo "text" | piper --model model.onnx --output_file -
    // Implementation depends on piper being installed locally
    const config = this.config.piper;
    if (!config?.modelPath) return null;

    try {
      const { execFile } = await import("node:child_process");
      return new Promise((resolve) => {
        const proc = execFile(
          "piper",
          ["--model", config.modelPath, "--output-raw"],
          { maxBuffer: 10 * 1024 * 1024 },
          (error, stdout) => {
            if (error || !stdout) {
              resolve(null);
              return;
            }
            resolve({
              audioBuffer: Buffer.from(stdout, "binary"),
              format: "wav",
              durationMs: 0,
            });
          },
        );
        proc.stdin?.write(text);
        proc.stdin?.end();
      });
    } catch {
      return null;
    }
  }
}

export class STTEngine {
  /** Transcribe audio to text using whisper.cpp */
  async transcribe(audioBuffer: Buffer): Promise<string | null> {
    // whisper.cpp integration — requires whisper binary installed
    // whisper --model base.en --file input.wav --output-txt
    try {
      const { writeFile, unlink } = await import("node:fs/promises");
      const { execSync } = await import("node:child_process");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      const tmpFile = join(tmpdir(), `clank-stt-${Date.now()}.wav`);
      await writeFile(tmpFile, audioBuffer);

      const output = execSync(`whisper "${tmpFile}" --model base.en --output-txt`, {
        encoding: "utf-8",
        timeout: 30_000,
      });

      await unlink(tmpFile).catch(() => {});
      return output.trim() || null;
    } catch {
      return null;
    }
  }
}
