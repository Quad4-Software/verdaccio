import { randomBytes, randomUUID } from 'node:crypto';

/** Time an authorization request stays valid while the user is at the IdP. */
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;
/** Time a CLI login session waits for the browser flow to complete. */
const CLI_SESSION_TTL_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;

export interface PendingAuth {
  nonce: string;
  codeVerifier: string;
  /** Same-origin path to continue to after the callback. */
  next: string;
  expiresAt: number;
}

export interface CliSession {
  /** Filled by the callback handler once the browser flow finishes. */
  token?: string;
  expiresAt: number;
}

/** A minted token held until the user clicks Allow on the CLI confirm page. */
export interface PendingConfirm {
  sessionId: string;
  token: string;
  username: string;
  expiresAt: number;
}

function sweep<K, V extends { expiresAt: number }>(map: Map<K, V>): void {
  const now = Date.now();
  for (const [key, value] of map) {
    if (value.expiresAt <= now) {
      map.delete(key);
    }
  }
}

/**
 * In-memory store for pending authorization requests and CLI login sessions.
 *
 * Single-process by design ; deployments with several replicas behind a load
 * balancer need sticky sessions for the ~10 minutes a login flow spans.
 */
export class OidcStateStore {
  private readonly pending = new Map<string, PendingAuth>();
  private readonly cliSessions = new Map<string, CliSession>();
  private readonly confirms = new Map<string, PendingConfirm>();
  private readonly sweeper: ReturnType<typeof setInterval>;

  public constructor() {
    this.sweeper = setInterval(() => {
      sweep(this.pending);
      sweep(this.cliSessions);
      sweep(this.confirms);
    }, SWEEP_INTERVAL_MS);
    // a pending sweep must never keep the process alive
    this.sweeper.unref?.();
  }

  public createPendingAuth(next: string): { state: string; nonce: string; codeVerifier: string } {
    const state = randomBytes(24).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    // PKCE verifier: 43-128 chars of unreserved characters per RFC 7636
    const codeVerifier = randomBytes(48).toString('base64url');
    this.pending.set(state, {
      nonce,
      codeVerifier,
      next,
      expiresAt: Date.now() + PENDING_AUTH_TTL_MS,
    });
    return { state, nonce, codeVerifier };
  }

  /** Read and remove a pending request ; state is single-use. */
  public consumePendingAuth(state: string): PendingAuth | undefined {
    const entry = this.pending.get(state);
    this.pending.delete(state);
    if (!entry || entry.expiresAt <= Date.now()) {
      return undefined;
    }
    return entry;
  }

  public createCliSession(): string {
    const sessionId = randomUUID();
    this.cliSessions.set(sessionId, { expiresAt: Date.now() + CLI_SESSION_TTL_MS });
    return sessionId;
  }

  public hasCliSession(sessionId: string): boolean {
    const session = this.cliSessions.get(sessionId);
    return session !== undefined && session.expiresAt > Date.now();
  }

  /** Store the issued token for a CLI session; unknown sessions are ignored. */
  public completeCliSession(sessionId: string, token: string): boolean {
    if (!this.hasCliSession(sessionId)) {
      return false;
    }
    this.cliSessions.set(sessionId, {
      token,
      expiresAt: Date.now() + CLI_SESSION_TTL_MS,
    });
    return true;
  }

  /** Read and remove the issued token ; a session token is handed out once. */
  public consumeCliToken(sessionId: string): { token?: string } | undefined {
    const session = this.cliSessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      this.cliSessions.delete(sessionId);
      return undefined;
    }
    if (session.token) {
      this.cliSessions.delete(sessionId);
    }
    return { token: session.token };
  }

  /**
   * Park a minted token behind a random confirm id; the CLI session gets it
   * only when the confirm endpoint consumes the id.
   */
  public createPendingConfirm(sessionId: string, token: string, username: string): string {
    const confirmId = randomBytes(24).toString('base64url');
    this.confirms.set(confirmId, {
      sessionId,
      token,
      username,
      expiresAt: Date.now() + PENDING_AUTH_TTL_MS,
    });
    return confirmId;
  }

  public consumePendingConfirm(confirmId: string): PendingConfirm | undefined {
    const entry = this.confirms.get(confirmId);
    this.confirms.delete(confirmId);
    if (!entry || entry.expiresAt <= Date.now()) {
      return undefined;
    }
    return entry;
  }

  public stop(): void {
    clearInterval(this.sweeper);
  }
}
