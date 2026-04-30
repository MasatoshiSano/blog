// GitHub repository_dispatch を発火してデプロイ workflow をトリガする。
// PAT は SSM Parameter Store から取得 (repository_dispatch スコープのみ推奨)。

export interface DispatchOptions {
  repo: string; // "owner/repo"
  token: string;
  eventType: string;
  clientPayload?: Record<string, unknown>;
}

// テスト時に差し替えるための injectable fetch。
let _fetch: typeof fetch = (...args) => fetch(...args);
export function __setFetchForTest(fn: typeof fetch | null): void {
  _fetch = fn ?? ((...args) => fetch(...args));
}

export async function triggerDispatch(opts: DispatchOptions): Promise<void> {
  const url = `https://api.github.com/repos/${opts.repo}/dispatches`;
  const res = await _fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${opts.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: opts.eventType,
      client_payload: opts.clientPayload ?? {},
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GitHub dispatch failed: ${res.status} ${res.statusText} ${text}`
    );
  }
}
