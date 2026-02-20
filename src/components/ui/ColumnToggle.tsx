"use client";

interface ColumnToggleProps {
  columns: number;
  onChange: (columns: number) => void;
}

const options = [1, 2, 3] as const;

export function ColumnToggle({ columns, onChange }: ColumnToggleProps) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-1 dark:border-gray-700">
      {options.map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          className={`flex items-center justify-center rounded px-2 py-1 text-xs transition-colors ${
            columns === n
              ? "bg-primary-500 text-white"
              : "text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          }`}
          aria-label={`${n}列表示`}
        >
          <ColumnIcon count={n} />
        </button>
      ))}
    </div>
  );
}

function ColumnIcon({ count }: { count: number }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        const w = (14 - (count - 1) * 2) / count;
        const x = 1 + i * (w + 2);
        return (
          <rect
            key={i}
            x={x}
            y="2"
            width={w}
            height="12"
            rx="1"
            fill="currentColor"
          />
        );
      })}
    </svg>
  );
}
