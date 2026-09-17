import { Link, useLocation } from 'react-router-dom';
import { NAV } from '../config/nav';
import { LogOut, Plane } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function Sidebar() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();

  return (
    <aside className="w-60 flex-shrink-0 h-screen bg-white border-r border-line flex flex-col">
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-line">
        <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center">
          <Plane className="w-4 h-4 text-white" />
        </div>
        <span className="font-semibold text-sm text-ink">TravelTracker</span>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ path, label, icon: Icon }) => {
          const active = pathname === path || pathname.startsWith(path + '/');
          const isTripsLink = path === '/trips';
          return (
            <Link key={path} to={path}
              onClick={isTripsLink ? () => localStorage.removeItem('tripDetails_tripId') : undefined}
              className={`flex items-center gap-2.5 h-10 px-3 rounded-2xl text-sm font-medium transition-colors
                ${active ? 'bg-brand-50 text-ink' : 'text-ink-muted hover:bg-canvas-soft'}`}>
              <Icon className="w-5 h-5 opacity-70" />{label}
            </Link>
          );
        })}
      </nav>
      {user && (
        <div className="p-3 border-t border-line">
          <div className="flex items-center gap-2.5 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-brand-50 flex items-center justify-center text-brand font-semibold text-xs">
              {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink truncate">{user.name || 'User'}</p>
              <p className="text-xs text-ink-muted truncate">{user.email || ''}</p>
            </div>
            <button onClick={logout} className="p-1.5 rounded-xl hover:bg-err-bg text-ink-muted hover:text-err transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}