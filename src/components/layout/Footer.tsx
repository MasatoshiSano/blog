import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
        <span>&copy; {new Date().getFullYear()} Tech Blog. All rights reserved.</span>
        <span aria-hidden="true">·</span>
        <Link
          href="/admin/login"
          className="text-gray-400 transition-colors hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300"
        >
          Admin
        </Link>
      </div>
    </footer>
  );
}
