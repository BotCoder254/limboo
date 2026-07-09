/**
 * Cursor CLI capability record — main-process-owned, deliberately NOT in
 * settings (settings.set is renderer-writable over IPC; whether Limboo may pass
 * `--force` is an execution-capability gate, so only verified main-process
 * observations can flip it).
 *
 * The one capability tracked today: "the hooks bridge actually connects for
 * this CLI version". Hook support in the print-mode CLI is undocumented, so
 * default/acceptEdits runs stay propose-only until a run has OBSERVED the
 * bundled hookRunner connect over the per-run pipe. Once verified for a CLI
 * version, later runs may pass `--force` with every tool gated live through
 * `decideToolUse` (fail-closed hookRunner + the deny-first cli.json floor).
 * A CLI update changes the version string, which simply stops matching — the
 * next run is automatically a propose-only re-probe.
 */
import { readJson, writeJson } from '../../storage';

const FILE = 'cursor-capabilities.json';

interface CursorCapabilities {
  /** `cursor-agent --version` string the hooks bridge was last verified for. */
  hooksVerifiedFor?: string;
  /** Epoch ms of the last verification write (diagnostics only). */
  verifiedAt?: number;
}

export function getVerifiedHooksVersion(): string | undefined {
  const caps = readJson<CursorCapabilities>(FILE, {});
  return typeof caps.hooksVerifiedFor === 'string' && caps.hooksVerifiedFor.length > 0
    ? caps.hooksVerifiedFor
    : undefined;
}

export function setHooksVerified(cliVersion: string): void {
  if (!cliVersion) return;
  writeJson(FILE, { hooksVerifiedFor: cliVersion, verifiedAt: Date.now() } as CursorCapabilities);
}

/** Forget the verification (a forced run saw gated tools but no hook connect). */
export function clearHooksVerified(): void {
  writeJson(FILE, {} as CursorCapabilities);
}
