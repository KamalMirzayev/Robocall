'use client';

import { Moon } from 'lucide-react';

// Flips between light and dark and remembers the choice; until then the OS setting wins.
export function ThemeToggle({ className = '', label }: { className?: string; label: string }) {
  const toggle = () => {
    const root = document.documentElement;
    const current =
      root.dataset.theme ||
      (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = current === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Private mode: the choice just isn't remembered.
    }
  };

  return (
    <button type="button" onClick={toggle} aria-label={label} title={label} className={className}>
      <Moon className="h-4 w-4" />
    </button>
  );
}
