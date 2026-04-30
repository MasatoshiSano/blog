import { randomUUID } from "node:crypto";
import path from "node:path";
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { PresignRequestSchema } from "../schema.js";
import { parseJsonBody } from "../util/parse.js";
import { json, error } from "../util/response.js";
import { presignUpload } from "../s3.js";

interface ImageRouteContext {
  mediaBucket: string;
}

export async function handleImagesPresign(
  event: APIGatewayProxyEvent,
  ctx: ImageRouteContext
): Promise<APIGatewayProxyResult> {
  const body = parseJsonBody(event);
  const parsed = PresignRequestSchema.safeParse(body);
  if (!parsed.success) {
    return error(400, "invalid request", parsed.error.issues);
  }
  const ext = path.extname(parsed.data.filename).toLowerCase().replace(".", "") || "bin";
  const safeExt = /^[a-z0-9]+$/.test(ext) ? ext : "bin";
  const key = `media/uploads/${randomUUID()}.${safeExt}`;
  const url = await presignUpload(ctx.mediaBucket, key, parsed.data.contentType);
  return json({
    uploadUrl: url,
    key,
    publicUrl: `/${key}`,
    expiresInSeconds: 300,
  });
}
