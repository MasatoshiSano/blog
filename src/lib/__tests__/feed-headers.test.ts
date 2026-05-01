import { describe, it, expect } from 'vitest';
import { buildFeedHeaders } from '../feed-headers';

describe('buildFeedHeaders', () => {
  it('Cache-Control に max-age と stale-while-revalidate を含む', () => {
    const h = buildFeedHeaders('<rss />');
    expect(h['Cache-Control']).toMatch(/max-age=3600/);
    expect(h['Cache-Control']).toMatch(/stale-while-revalidate=86400/);
  });

  it('Content-Type が RSS 用', () => {
    const h = buildFeedHeaders('<rss />');
    expect(h['Content-Type']).toBe('application/rss+xml; charset=utf-8');
  });

  it('ETag は body 依存で安定（同じ body なら同じ値）', () => {
    const a = buildFeedHeaders('<rss>same</rss>');
    const b = buildFeedHeaders('<rss>same</rss>');
    expect(a.ETag).toBe(b.ETag);
  });

  it('ETag は body が違えば異なる', () => {
    const a = buildFeedHeaders('<rss>v1</rss>');
    const b = buildFeedHeaders('<rss>v2</rss>');
    expect(a.ETag).not.toBe(b.ETag);
  });
});
