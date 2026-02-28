import Link from "next/link";

export default function NotFound() {
  return (
    <div className="animate-fade-in-up flex flex-col items-center justify-center py-24">
      <p className="text-7xl font-bold text-primary-500 sm:text-9xl">404</p>
      <h1 className="mt-4 text-2xl font-bold text-gray-800 dark:text-gray-200">
        ページが見つかりません
      </h1>
      <p className="mt-2 text-gray-500 dark:text-gray-400">
        お探しのページは存在しないか、移動した可能性があります。
      </p>
      <Link
        href="/"
        className="mt-8 rounded-lg bg-primary-500 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-600"
      >
        トップページへ戻る
      </Link>
    </div>
  );
}
