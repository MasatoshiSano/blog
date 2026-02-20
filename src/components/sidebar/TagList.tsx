import Link from "next/link";

interface TagListProps {
  tags: string[];
}

export function TagList({ tags }: TagListProps) {
  if (tags.length === 0) return null;

  return (
    <div className="pt-4 first:pt-0">
      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">タグ</h3>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <Link
            key={tag}
            href={`/tags/${tag}`}
            className="rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700 dark:border-gray-700 dark:text-gray-400 dark:hover:border-primary-600 dark:hover:bg-primary-900/30 dark:hover:text-primary-300"
          >
            {tag}
          </Link>
        ))}
      </div>
    </div>
  );
}
