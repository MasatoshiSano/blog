"use client";

import { useState, useRef, type ChangeEvent, type FormEvent } from "react";
import Link from "next/link";
import {
  Upload,
  FileText,
  Image as ImageIcon,
  Eye,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  X,
  Loader2,
} from "lucide-react";
import {
  previewPost,
  publishPost,
  getUploadUrl,
  uploadImageToS3,
  type PreviewResponse,
} from "@/lib/admin-api";

type Step = "select" | "preview" | "done";

const MAX_MD_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_IMG_SIZE = 10 * 1024 * 1024; // 10MB

export default function UploadPage() {
  const [step, setStep] = useState<Step>("select");

  // ファイル選択
  const [mdFile, setMdFile] = useState<File | null>(null);
  const [imgFile, setImgFile] = useState<File | null>(null);
  const [mdError, setMdError] = useState<string | null>(null);
  const [imgError, setImgError] = useState<string | null>(null);
  const mdInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);

  // プレビュー
  const [previewing, setPreviewing] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // 編集フォーム (プレビュー段階)
  const [editedMarkdown, setEditedMarkdown] = useState("");
  const [editedFrontmatter, setEditedFrontmatter] = useState<Record<string, unknown>>({});
  const [slug, setSlug] = useState("");

  // 公開
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<{ slug: string; deployingAt: string } | null>(
    null
  );

  function handleMdChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setMdError(null);
    if (!file) { setMdFile(null); return; }
    if (!file.name.endsWith(".md")) {
      setMdError(".md ファイルを選択してください");
      setMdFile(null);
      return;
    }
    if (file.size > MAX_MD_SIZE) {
      setMdError("ファイルサイズは 5MB 以下にしてください");
      setMdFile(null);
      return;
    }
    setMdFile(file);
    // slug をファイル名から推測
    setSlug(file.name.replace(/\.md$/, "").replace(/[^a-zA-Z0-9_-]/g, "-"));
  }

  function handleImgChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImgError(null);
    if (!file) { setImgFile(null); return; }
    if (!file.type.startsWith("image/")) {
      setImgError("画像ファイルを選択してください");
      setImgFile(null);
      return;
    }
    if (file.size > MAX_IMG_SIZE) {
      setImgError("画像は 10MB 以下にしてください");
      setImgFile(null);
      return;
    }
    setImgFile(file);
  }

  async function handlePreview(e: FormEvent) {
    e.preventDefault();
    if (!mdFile) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const markdown = await mdFile.text();
      const imageMeta = imgFile
        ? { filename: imgFile.name, contentType: imgFile.type }
        : undefined;
      const data = await previewPost(markdown, imageMeta);
      setPreviewData(data);
      setEditedMarkdown(data.correctedMarkdown);
      setEditedFrontmatter(data.frontmatter);
      setStep("preview");
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "プレビューの取得に失敗しました");
    } finally {
      setPreviewing(false);
    }
  }

  async function handlePublish() {
    if (!previewData) return;
    setPublishing(true);
    setPublishError(null);
    try {
      let frontmatter = { ...editedFrontmatter };

      // 画像がある場合は先にアップロードして coverImage を設定
      if (imgFile) {
        const { uploadUrl, publicUrl } = await getUploadUrl(imgFile.name, imgFile.type);
        await uploadImageToS3(uploadUrl, imgFile);
        frontmatter = { ...frontmatter, coverImage: publicUrl };
      }

      const result = await publishPost({
        slug,
        markdown: editedMarkdown,
        frontmatter,
      });
      setPublishResult({ slug: result.slug, deployingAt: result.deployingAt });
      setStep("done");
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "公開に失敗しました");
    } finally {
      setPublishing(false);
    }
  }

  function handleReset() {
    setStep("select");
    setMdFile(null);
    setImgFile(null);
    setMdError(null);
    setImgError(null);
    setPreviewData(null);
    setPreviewError(null);
    setEditedMarkdown("");
    setEditedFrontmatter({});
    setSlug("");
    setPublishResult(null);
    setPublishError(null);
    if (mdInputRef.current) mdInputRef.current.value = "";
    if (imgInputRef.current) imgInputRef.current.value = "";
  }

  // ---- 完了画面 ----
  if (step === "done" && publishResult) {
    return (
      <div className="mx-auto max-w-xl">
        <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center dark:border-green-800 dark:bg-green-900/20">
          <CheckCircle size={48} className="mx-auto mb-4 text-green-500" />
          <h1 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">公開しました</h1>
          <p className="mb-1 text-sm text-gray-600 dark:text-gray-400">
            記事 <code className="rounded bg-green-100 px-1 dark:bg-green-900/40">{publishResult.slug}</code> を S3 に保存しました。
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            GitHub Actions でのビルドが完了すると 1〜3 分後に公開されます。
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/admin/posts"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              記事一覧へ
            </Link>
            <button
              onClick={handleReset}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 dark:bg-primary-500 dark:hover:bg-primary-600"
            >
              別の記事を投稿する
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- プレビュー画面 ----
  if (step === "preview" && previewData) {
    return (
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-center gap-3">
          <button
            onClick={() => setStep("select")}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="ファイル選択に戻る"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">プレビュー・確認</h1>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              AI が補正した内容を確認・編集してから公開してください
            </p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Frontmatter 編集 */}
          <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">フロントマター</h2>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">slug</label>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
              </div>

              {Object.entries(editedFrontmatter).map(([key, value]) => (
                <div key={key}>
                  <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">{key}</label>
                  {typeof value === "boolean" ? (
                    <button
                      onClick={() =>
                        setEditedFrontmatter((prev) => ({ ...prev, [key]: !value }))
                      }
                      className={`rounded-full px-3 py-0.5 text-xs font-medium transition ${
                        value
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                      }`}
                    >
                      {value ? "true" : "false"}
                    </button>
                  ) : typeof value === "number" ? (
                    <input
                      type="number"
                      value={value}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setEditedFrontmatter((prev) => ({
                          ...prev,
                          [key]: raw === "" ? "" : Number(raw),
                        }));
                      }}
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  ) : Array.isArray(value) ? (
                    <input
                      type="text"
                      value={(value as string[]).join(", ")}
                      onChange={(e) =>
                        setEditedFrontmatter((prev) => ({
                          ...prev,
                          [key]: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                        }))
                      }
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                      placeholder="カンマ区切りで入力"
                    />
                  ) : (
                    <input
                      type="text"
                      value={String(value ?? "")}
                      onChange={(e) =>
                        setEditedFrontmatter((prev) => ({ ...prev, [key]: e.target.value }))
                      }
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                    />
                  )}
                </div>
              ))}
            </div>

            {/* Unsplash プレビュー */}
            {previewData.unsplashPreviewUrl && !editedFrontmatter.coverImage && (
              <div className="mt-4">
                <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
                  サムネ未指定のため Unsplash から自動選択されます
                </p>
                <div className="overflow-hidden rounded-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewData.unsplashPreviewUrl}
                    alt="Unsplash プレビュー"
                    className="aspect-video w-full object-cover"
                  />
                  {previewData.unsplashPhotographer && (
                    <p className="mt-1 text-right text-xs text-gray-400">
                      {previewData.unsplashPhotographer} / Unsplash
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>

          {/* Markdown 編集 */}
          <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-4 text-sm font-semibold text-gray-700 dark:text-gray-300">
              Markdown 本文 (AI 補正済み)
            </h2>
            <textarea
              value={editedMarkdown}
              onChange={(e) => setEditedMarkdown(e.target.value)}
              rows={20}
              className="w-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 font-mono text-xs text-gray-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
          </section>
        </div>

        {publishError && (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {publishError}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={() => setStep("select")}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
          >
            やり直す
          </button>
          <button
            onClick={handlePublish}
            disabled={publishing || !slug}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-500 dark:hover:bg-primary-600"
          >
            {publishing ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <CheckCircle size={16} />
            )}
            {publishing ? "公開中..." : "公開する"}
          </button>
        </div>
      </div>
    );
  }

  // ---- ファイル選択画面 ----
  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">記事をアップロード</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            .md ファイルを選択すると AI がフロントマターを補完します
          </p>
        </div>
        <Link
          href="/admin/posts"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <ArrowLeft size={14} />
          記事一覧
        </Link>
      </div>

      <form onSubmit={handlePreview} className="space-y-5">
        {/* Markdown ファイル */}
        <div
          className="cursor-pointer rounded-xl border-2 border-dashed border-gray-300 p-6 text-center transition hover:border-primary-400 dark:border-gray-700 dark:hover:border-primary-600"
          onClick={() => mdInputRef.current?.click()}
        >
          <input
            ref={mdInputRef}
            type="file"
            accept=".md"
            onChange={handleMdChange}
            className="hidden"
          />
          {mdFile ? (
            <div className="flex items-center justify-center gap-3">
              <FileText size={24} className="text-primary-500" />
              <div className="text-left">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{mdFile.name}</p>
                <p className="text-xs text-gray-400">{(mdFile.size / 1024).toFixed(1)} KB</p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMdFile(null);
                  if (mdInputRef.current) mdInputRef.current.value = "";
                }}
                className="ml-auto rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div>
              <Upload size={32} className="mx-auto mb-2 text-gray-300 dark:text-gray-600" />
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Markdown ファイルを選択
              </p>
              <p className="mt-1 text-xs text-gray-400">クリックして選択（最大 5MB）</p>
            </div>
          )}
        </div>
        {mdError && (
          <p className="flex items-center gap-1.5 text-sm text-red-500">
            <AlertCircle size={14} />
            {mdError}
          </p>
        )}

        {/* 画像ファイル (任意) */}
        <div
          className="cursor-pointer rounded-xl border-2 border-dashed border-gray-200 p-5 text-center transition hover:border-primary-400 dark:border-gray-800 dark:hover:border-primary-600"
          onClick={() => imgInputRef.current?.click()}
        >
          <input
            ref={imgInputRef}
            type="file"
            accept="image/*"
            onChange={handleImgChange}
            className="hidden"
          />
          {imgFile ? (
            <div className="flex items-center justify-center gap-3">
              <ImageIcon size={24} className="text-primary-500" />
              <div className="text-left">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{imgFile.name}</p>
                <p className="text-xs text-gray-400">{(imgFile.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setImgFile(null);
                  if (imgInputRef.current) imgInputRef.current.value = "";
                }}
                className="ml-auto rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
              >
                <X size={14} />
              </button>
            </div>
          ) : (
            <div>
              <ImageIcon size={28} className="mx-auto mb-2 text-gray-200 dark:text-gray-700" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                サムネ画像（任意）― 未選択時は Unsplash から自動選択
              </p>
              <p className="mt-1 text-xs text-gray-400">最大 10MB</p>
            </div>
          )}
        </div>
        {imgError && (
          <p className="flex items-center gap-1.5 text-sm text-red-500">
            <AlertCircle size={14} />
            {imgError}
          </p>
        )}

        {previewError && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {previewError}
          </div>
        )}

        <button
          type="submit"
          disabled={!mdFile || previewing}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 py-3 text-sm font-medium text-white transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-primary-500 dark:hover:bg-primary-600"
        >
          {previewing ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Eye size={16} />
          )}
          {previewing ? "AI が補正中..." : "プレビューを確認する"}
        </button>
      </form>
    </div>
  );
}
