import { Link2, LogOut, Moon, Sun } from 'lucide-react';
import { Link, NavLink, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-context';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded-lg px-3 py-2 text-sm font-medium',
    isActive
      ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-100'
      : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
  );

export function AppLayout() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur dark:border-slate-800 dark:bg-slate-950/85">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4">
          <Link to="/" className="mr-2 flex items-center gap-2 font-bold">
            <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-white">
              <Link2 className="size-4" aria-hidden />
            </span>
            Snip
          </Link>
          <nav aria-label="Main" className="flex flex-1 items-center gap-1">
            {user && (
              <>
                <NavLink to="/" end className={linkClass}>
                  Links
                </NavLink>
                <NavLink to="/keys" className={linkClass}>
                  API keys
                </NavLink>
              </>
            )}
            <a href="/docs" className={linkClass({ isActive: false })}>
              API docs
            </a>
          </nav>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          {user && (
            <>
              <span className="hidden text-sm font-medium sm:block">{user.name}</span>
              <Button variant="ghost" size="icon" aria-label="Log out" onClick={logout}>
                <LogOut />
              </Button>
            </>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <Outlet />
      </main>
    </div>
  );
}
