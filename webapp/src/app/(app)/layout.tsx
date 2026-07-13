"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/ui";

const MENU = [
  { href: "/", label: "Report Dashboard", icon: "📊" },
  { href: "/koleksi", label: "Koleksi", icon: "🗂️" },
  { href: "/live", label: "Live Management", icon: "🎥" },
  { href: "/extension", label: "Extension", icon: "🧩" },
  { href: "/setting", label: "Setting", icon: "⚙️" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-zinc-800 bg-zinc-925 flex flex-col fixed inset-y-0">
        <div className="p-5 border-b border-zinc-800">
          <Link href="/" className="text-xl font-bold tracking-tight">
            elyasya<span className="text-orange-500">studio</span>
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {MENU.map((m) => {
            const active =
              m.href === "/" ? pathname === "/" : pathname.startsWith(m.href);
            return (
              <Link
                key={m.href}
                href={m.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition ${
                  active
                    ? "bg-orange-600/15 text-orange-400 font-semibold"
                    : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60"
                }`}
              >
                <span>{m.icon}</span>
                {m.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={logout}
          className="m-3 px-3 py-2.5 rounded-lg text-sm text-zinc-400 hover:text-red-400 hover:bg-zinc-800/60 text-left transition"
        >
          ↩︎ Keluar
        </button>
      </aside>
      <main className="flex-1 ml-60 p-8 max-w-[1400px]">{children}</main>
    </div>
  );
}
