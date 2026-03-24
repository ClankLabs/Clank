/**
 * Auth credential store — manages OAuth tokens and API keys.
 *
 * Credentials are stored in `~/.clank/auth-profiles.json` with
 * restricted file permissions. OAuth tokens auto-refresh 5 minutes
 * before expiry with file-based locking to prevent concurrent refresh.
 */

import { readFile, writeFile, unlink, stat } from "node:fs/promises";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config/index.js";
import { refreshAccessToken, type OAuthCredential } from "./oauth.js";

/** API key credential */
export interface ApiKeyCredential {
  type: "api_key";
  provider: string;
  key: string;
}

/** Any stored credential */
export type StoredCredential = OAuthCredential | ApiKeyCredential;

/** The full auth profiles file structure */
export interface AuthProfiles {
  profiles: Record<string, StoredCredential>;
}

export class AuthProfileStore {
  private filePath: string;
  private lockPath: string;

  constructor() {
    const configDir = getConfigDir();
    this.filePath = join(configDir, "auth-profiles.json");
    this.lockPath = join(configDir, ".auth-lock");
  }

  /** Load profiles from disk */
  async load(): Promise<AuthProfiles> {
    try {
      const data = await readFile(this.filePath, "utf-8");
      return JSON.parse(data) as AuthProfiles;
    } catch {
      return { profiles: {} };
    }
  }

  /** Save profiles to disk with restricted permissions */
  async save(profiles: AuthProfiles): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(profiles, null, 2), { mode: 0o600 });
  }

  /** Get a specific credential by profile ID */
  async getCredential(profileId: string): Promise<StoredCredential | undefined> {
    const profiles = await this.load();
    return profiles.profiles[profileId];
  }

  /** Store a credential */
  async setCredential(profileId: string, credential: StoredCredential): Promise<void> {
    const profiles = await this.load();
    profiles.profiles[profileId] = credential;
    await this.save(profiles);
  }

  /** Remove a credential */
  async removeCredential(profileId: string): Promise<void> {
    const profiles = await this.load();
    delete profiles.profiles[profileId];
    await this.save(profiles);
  }

  /** List all profile IDs */
  async listProfiles(): Promise<Array<{ id: string; provider: string; type: string; email?: string }>> {
    const profiles = await this.load();
    return Object.entries(profiles.profiles).map(([id, cred]) => ({
      id,
      provider: cred.provider,
      type: cred.type,
      email: cred.type === "oauth" ? (cred as OAuthCredential).email : undefined,
    }));
  }

  /**
   * Resolve an API key or access token for a profile.
   * For OAuth: checks expiry, refreshes if needed, returns access token.
   * For API key: returns the key directly.
   */
  async resolveApiKey(profileId: string): Promise<string> {
    const credential = await this.getCredential(profileId);
    if (!credential) {
      throw new Error(`No credential found for profile "${profileId}". Run 'clank auth login' first.`);
    }

    if (credential.type === "api_key") {
      return credential.key;
    }

    // OAuth — check if refresh is needed
    if (needsRefresh(credential)) {
      const refreshed = await this.refreshWithLock(credential, profileId);
      return refreshed.access;
    }

    return credential.access;
  }

  /**
   * Refresh an OAuth token with file-based locking.
   * Prevents multiple processes from refreshing simultaneously.
   */
  private async refreshWithLock(credential: OAuthCredential, profileId: string): Promise<OAuthCredential> {
    // Check if another process is already refreshing
    if (existsSync(this.lockPath)) {
      try {
        const lockStat = await stat(this.lockPath);
        // If lock is older than 30 seconds, it's stale — proceed anyway
        if (Date.now() - lockStat.mtimeMs < 30_000) {
          // Wait and re-read (another process likely refreshed)
          await new Promise((r) => setTimeout(r, 2000));
          const fresh = await this.getCredential(profileId);
          if (fresh && fresh.type === "oauth" && !needsRefresh(fresh)) {
            return fresh;
          }
        }
      } catch {
        // Lock file gone, proceed
      }
    }

    try {
      // Create lock file (exclusive create to avoid race)
      writeFileSync(this.lockPath, String(process.pid), { flag: "wx" });
    } catch {
      // Another process got the lock first — wait and re-read
      await new Promise((r) => setTimeout(r, 2000));
      const fresh = await this.getCredential(profileId);
      if (fresh && fresh.type === "oauth" && !needsRefresh(fresh)) {
        return fresh;
      }
      // Still needs refresh and we can't get lock — try anyway
    }

    try {
      const tokens = await refreshAccessToken(credential.refresh);
      const refreshed: OAuthCredential = {
        ...credential,
        access: tokens.access_token,
        refresh: tokens.refresh_token,
        expires: Date.now() + tokens.expires_in * 1000,
      };
      await this.setCredential(profileId, refreshed);
      return refreshed;
    } finally {
      try {
        await unlink(this.lockPath);
      } catch {
        // Lock already removed
      }
    }
  }
}

/** Check if a credential needs refreshing (5 minutes before expiry) */
export function needsRefresh(credential: OAuthCredential): boolean {
  return Date.now() >= credential.expires - 5 * 60 * 1000;
}
