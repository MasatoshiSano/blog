/**
 * RSS feed.xml に対する HTTP レスポンスヘッダ生成。
 * Cache-Control / ETag を一元管理する。
 *
 * Issue: #2 — RSS feed のキャッシュ制御を改善
 */

export type FeedHeaders = {
  'Cache-Control': string;
  ETag: string;
  'Content-Type': string;
};

/**
 * feed.xml の最終更新時刻と body 内容から HTTP ヘッダ群を生成する。
 *
 * - Cache-Control: 1時間 max-age + 1日 stale-while-revalidate
 * - ETag: body の SHA-256 を 16進で先頭16文字
 */
export function buildFeedHeaders(body: string): FeedHeaders {
  return {
    'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    ETag: `"${hash16(body)}"`,
    'Content-Type': 'application/rss+xml; charset=utf-8',
  };
}

function hash16(s: string): string {
  // 単純な FNV-1a 32bit。crypto を引っ張りたくない軽量用途
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0').slice(0, 16);
}
