import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let _client: S3Client | null = null;
function client(): S3Client {
  if (!_client) _client = new S3Client({});
  return _client;
}

export function __setS3ClientForTest(c: S3Client | null): void {
  _client = c;
}

export async function putMarkdown(
  bucket: string,
  slug: string,
  markdown: string
): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: `posts/${slug}.md`,
      Body: markdown,
      ContentType: "text/markdown; charset=utf-8",
    })
  );
}

export async function getMarkdown(
  bucket: string,
  slug: string
): Promise<string | null> {
  try {
    const res = await client().send(
      new GetObjectCommand({ Bucket: bucket, Key: `posts/${slug}.md` })
    );
    if (!res.Body) return null;
    return await res.Body.transformToString("utf-8");
  } catch (err) {
    if ((err as { name?: string }).name === "NoSuchKey") return null;
    throw err;
  }
}

export async function deleteMarkdown(
  bucket: string,
  slug: string
): Promise<void> {
  await client().send(
    new DeleteObjectCommand({ Bucket: bucket, Key: `posts/${slug}.md` })
  );
}

export async function listPostKeys(bucket: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await client().send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "posts/",
        ContinuationToken: token,
      })
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.Key.endsWith(".md")) out.push(obj.Key);
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

// Pre-signed PUT URL。5 分有効。
export async function presignUpload(
  bucket: string,
  key: string,
  contentType: string,
  expiresInSeconds = 300
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return await getSignedUrl(client(), cmd, { expiresIn: expiresInSeconds });
}
