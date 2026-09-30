"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { apiGet, apiSend } from "@/lib/http";
import {
  Activity,
  ArrowRightLeft,
  Bot,
  DollarSign,
  FileSearch,
  FlaskConical,
  History,
  Layers,
  LayoutDashboard,
  Lightbulb,
  LogOut,
  Menu,
  Package,
  Plug,
  Puzzle,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldCheck,
  TrendingUp,
  X,
} from "lucide-react";

/**
 * Operational console navigation, grouped for fast scanning. Existing working
 * surfaces are preserved; the operational-monitoring sections (Research,
 * Validation, Evidence, Providers, Agent Runs, Audit Logs, System Health)
 * read through the existing owner-scoped read APIs.
 */
const NAV_GROUPS: Array<{ label: string; items: Array<{ title: string; href: string; icon: React.ComponentType<{ className?: string }> }> }> = [
  {
    label: "Operate",
    items: [
      { title: "Dashboard", href: "/", icon: LayoutDashboard },
      { title: "Research", href: "/research", icon: Search },
      { title: "Discovery", href: "/discovery", icon: Lightbulb },
      { title: "Opportunities", href: "/opportunities", icon: Layers },
      { title: "Validation", href: "/validation", icon: ShieldCheck },
      { title: "Handoffs", href: "/handoffs", icon: ArrowRightLeft },
      { title: "Experiments", href: "/experiments", icon: FlaskConical },
      { title: "Evidence", href: "/evidence", icon: FileSearch },
    ],
  },
  {
    label: "System",
    items: [
      { title: "Providers", href: "/providers", icon: Plug },
      { title: "AI Agents", href: "/agents", icon: Bot },
      { title: "Agent Runs", href: "/agent-runs", icon: History },
      { title: "Audit Logs", href: "/audit-logs", icon: ScrollText },
      { title: "System Health", href: "/health", icon: Activity },
      { title: "Platform", href: "/platform", icon: Server },
      { title: "Integrations", href: "/integrations", icon: Puzzle },
    ],
  },
  {
    label: "Business",
    items: [
      { title: "Growth", href: "/growth", icon: TrendingUp },
      { title: "Products", href: "/products", icon: Package },
      { title: "Revenue", href: "/revenue", icon: DollarSign },
      { title: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((group) => group.items);

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-4" aria-label="Primary">
      {NAV_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{group.label}</div>
          <div className="space-y-1">
            {group.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                    active
                      ? "bg-blue-600 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {item.title}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "USER" | "ADMIN";
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<SessionUser | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    apiGet<{ user: SessionUser }>('/api/auth/me')
      .then((data) => {
        if (!cancelled) setUser(data.user);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await apiSend('/api/auth/logout', 'POST');
    } catch {
      // Cookie is cleared by the server regardless; land on the login page.
    }
    router.push('/login');
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <button
            className="rounded-md p-2 text-slate-600 hover:bg-slate-100 md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle navigation"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="font-bold">AI Income Lab</div>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            Phase 6A · SAMPLE DATA
          </span>
          <div className="ml-auto flex items-center gap-3">
            {user ? (
              <>
                <span
                  className="hidden text-xs text-slate-600 sm:inline"
                  title={user.email}
                >
                  {user.name || user.email}
                  {user.role === "ADMIN" ? " · ADMIN" : ""}
                </span>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Log out"
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Log out</span>
                </button>
              </>
            ) : (
              <Link
                href="/login"
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        <aside className="hidden w-60 shrink-0 md:block">
          <div className="sticky top-20 rounded-xl border border-slate-200 bg-white p-3">
            <NavLinks />
          </div>
        </aside>
        {open ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
            <div className="absolute left-0 top-0 h-full w-72 bg-white p-4 shadow-xl">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
          </div>
        ) : null}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
