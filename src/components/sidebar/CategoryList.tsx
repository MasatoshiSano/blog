import Link from "next/link";
import type { CategoryCount } from "@/types/post";

interface CategoryListProps {
  categories: CategoryCount[];
}

export function CategoryList({ categories }: CategoryListProps) {
  if (categories.length === 0) return null;

  return (
    <div className="pt-4 first:pt-0">
      <h3 className="mb-3 text-sm font-semibold text-gray-900">カテゴリ</h3>
      <ul className="space-y-1.5">
        {categories.map((cat) => (
          <li key={cat.name}>
            <Link
              href={`/categories/${cat.name}`}
              className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
            >
              <span>{cat.name}</span>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {cat.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
