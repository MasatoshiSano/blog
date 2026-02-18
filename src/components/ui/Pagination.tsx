import Link from "next/link";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  basePath: string;
}

export function Pagination({
  currentPage,
  totalPages,
  basePath,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <nav
      className="mt-8 flex items-center justify-center gap-2"
      aria-label="ページナビゲーション"
    >
      {currentPage > 1 && (
        <Link
          href={
            currentPage === 2
              ? basePath || "/"
              : `${basePath}/page/${currentPage - 1}`
          }
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50"
        >
          前へ
        </Link>
      )}

      {pages.map((page) => (
        <Link
          key={page}
          href={page === 1 ? basePath || "/" : `${basePath}/page/${page}`}
          className={`rounded-lg px-3 py-2 text-sm transition-colors ${
            page === currentPage
              ? "bg-primary-500 text-white"
              : "border border-gray-200 text-gray-600 hover:bg-gray-50"
          }`}
        >
          {page}
        </Link>
      ))}

      {currentPage < totalPages && (
        <Link
          href={`${basePath}/page/${currentPage + 1}`}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50"
        >
          次へ
        </Link>
      )}
    </nav>
  );
}
