import Link from "next/link";
import { SearchModal } from "@/components/ui/SearchModal";
import { getSearchIndex } from "@/lib/posts";

export function Header() {
  const searchIndex = getSearchIndex();

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
        <Link href="/" className="text-2xl font-bold text-gray-900 hover:text-primary-600 transition-colors">
          Tech Blog
        </Link>
        <div className="flex items-center gap-4">
          <SearchModal searchIndex={searchIndex} />
          <nav className="hidden sm:flex gap-4 text-sm">
            <Link href="/" className="text-gray-600 hover:text-gray-900 transition-colors">
              Home
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}
