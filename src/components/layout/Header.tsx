import Link from "next/link";
import { SearchModal } from "@/components/ui/SearchModal";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { getSearchIndex } from "@/lib/posts";

export function Header() {
  const searchIndex = getSearchIndex();

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/80 backdrop-blur-lg dark:border-gray-800 dark:bg-gray-950/80">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 transition-colors hover:opacity-80">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500 font-mono text-sm font-bold text-white">
            {"</>"}
          </span>
          <span className="font-mono text-xl font-bold tracking-tight text-gray-900 dark:text-white">
            TECH BLOG
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <nav className="hidden items-center gap-1 sm:flex">
            <Link
              href="/"
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            >
              Home
            </Link>
          </nav>
          <SearchModal searchIndex={searchIndex} />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
