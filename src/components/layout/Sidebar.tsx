import type { ReactNode } from "react";

interface SidebarProps {
  children: ReactNode;
}

export function Sidebar({ children }: SidebarProps) {
  return (
    <aside className="hidden lg:block w-72 shrink-0">
      <div className="sticky top-20 space-y-6 divide-y divide-gray-200">
        {children}
      </div>
    </aside>
  );
}
