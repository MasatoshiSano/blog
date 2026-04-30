import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

// Cold start 時のみ取得した値をプロセス内キャッシュ。
const cache = new Map<string, string>();

let _client: SSMClient | null = null;
function client(): SSMClient {
  if (!_client) _client = new SSMClient({});
  return _client;
}

// テスト用: クライアントを差し替える / キャッシュをクリアする。
export function __setSsmClientForTest(c: SSMClient | null): void {
  _client = c;
  cache.clear();
}

export async function getParameter(name: string, decrypt = true): Promise<string> {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const res = await client().send(
    new GetParameterCommand({ Name: name, WithDecryption: decrypt })
  );
  const value = res.Parameter?.Value;
  if (!value) throw new Error(`SSM parameter not found or empty: ${name}`);
  cache.set(name, value);
  return value;
}

export interface ApiSecrets {
  adminPasswordHash: string;
  jwtSecret: string;
  apiKeyHashes: string[]; // 複数キー対応 (カンマ区切りで保存)
  anthropicKey: string;
  githubDispatchToken: string;
}

export async function loadApiSecrets(prefix: string): Promise<ApiSecrets> {
  const [
    adminPasswordHash,
    jwtSecret,
    apiKeyHashesRaw,
    anthropicKey,
    githubDispatchToken,
  ] = await Promise.all([
    getParameter(`${prefix}/admin-password-hash`),
    getParameter(`${prefix}/jwt-secret`),
    getParameter(`${prefix}/api-key-hash`),
    getParameter(`${prefix}/anthropic-key`),
    getParameter(`${prefix}/github-dispatch-token`),
  ]);
  return {
    adminPasswordHash,
    jwtSecret,
    apiKeyHashes: apiKeyHashesRaw.split(",").map((s) => s.trim()).filter(Boolean),
    anthropicKey,
    githubDispatchToken,
  };
}
