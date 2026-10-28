import { ReactNode } from 'react';
import { LogOut, MessageSquare } from 'lucide-react';

export interface WorkspaceNavItem {
  id: string;
  label: string;
  shortLabel?: string;
  icon: ReactNode;
}

interface WorkspaceShellProps {
  title: string;
  subtitle: string;
  items: WorkspaceNavItem[];
  activeItem: string;
  onNavigate: (id: string) => void;
  onLogout: () => void;
  children: ReactNode;
}

function WorkspaceShell({
  title,
  subtitle,
  items,
  activeItem,
  onNavigate,
  onLogout,
  children,
}: WorkspaceShellProps) {
  const renderItem = (item: WorkspaceNavItem, mobile = false) => (
    <button
      key={item.id}
      type="button"
      onClick={() => onNavigate(item.id)}
      aria-current={activeItem === item.id ? 'page' : undefined}
      className={`flex shrink-0 items-center gap-3 rounded-xl text-sm font-medium transition ${
        mobile
          ? `min-w-[68px] flex-col justify-center gap-1 px-3 py-2 text-xs ${
            activeItem === item.id ? 'text-primary-700' : 'text-gray-500'
          }`
          : `w-full px-3 py-3 text-left ${
            activeItem === item.id
              ? 'bg-primary-50 text-primary-700'
              : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
          }`
      }`}
    >
      <span className="shrink-0">{item.icon}</span>
      <span className={mobile ? 'whitespace-nowrap' : ''}>{mobile ? item.shortLabel || item.label : item.label}</span>
    </button>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-gray-200 bg-white md:flex">
        <div className="flex h-20 items-center gap-3 border-b px-6">
          <span className="rounded-xl bg-primary-50 p-2 text-primary-700">
            <MessageSquare className="h-6 w-6" />
          </span>
          <div>
            <p className="font-bold text-gray-900">Whafeisty</p>
            <p className="text-xs text-gray-500">{title}</p>
          </div>
        </div>
        <nav aria-label="Workspace navigation" className="flex-1 space-y-1 overflow-y-auto p-4">
          {items.map((item) => renderItem(item))}
        </nav>
        <div className="border-t p-4">
          <button
            type="button"
            onClick={onLogout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-red-600"
          >
            <LogOut className="h-5 w-5" />
            Keluar
          </button>
        </div>
      </aside>

      <main className="min-h-screen pb-24 md:pl-64 md:pb-0">
        <header className="sticky top-0 z-20 border-b bg-white/95 px-4 py-4 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900 md:text-xl">{title}</h1>
              <p className="hidden text-sm text-gray-500 sm:block">{subtitle}</p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              aria-label="Keluar"
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-red-600 md:hidden"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>
        <div className="mx-auto max-w-7xl p-4 md:p-8">{children}</div>
      </main>

      <nav
        aria-label="Navigasi seluler"
        className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t bg-white px-2 pb-[max(env(safe-area-inset-bottom),0.25rem)] pt-2 shadow-[0_-4px_18px_rgba(15,23,42,0.08)] md:hidden"
      >
        {items.map((item) => renderItem(item, true))}
      </nav>
    </div>
  );
}

export default WorkspaceShell;
