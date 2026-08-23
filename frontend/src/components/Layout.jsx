import { Link, NavLink, useNavigate } from "react-router-dom";
import { Bell, Boxes, LayoutDashboard, LogOut, Search, ShoppingBag, Ticket } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useCart } from "@/context/CartContext";
import { Button } from "@/components/ui/button";

const navItems = (isAdmin) => [
  { to: "/", label: "Katalog", icon: Search, id: "nav-catalog" },
  { to: "/peminjaman", label: "Pesanan", icon: Ticket, id: "nav-bookings" },
  { to: "/notifikasi", label: "Notifikasi", icon: Bell, id: "nav-notifications" },
  ...(isAdmin ? [{ to: "/admin", label: "Admin", icon: LayoutDashboard, id: "nav-admin" }] : []),
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const { totalQty } = useCart();
  const navigate = useNavigate();
  const items = navItems(user?.role === "admin");

  return (
    <div className="min-h-screen bg-[#09090B] text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-zinc-950/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link to="/" data-testid="brand-logo" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#007AFF]">
              <Boxes className="h-5 w-5 text-white" />
            </span>
            <span className="font-heading text-lg font-bold tracking-tight">Gudang Kantor</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {items.map((i) => (
              <NavLink
                key={i.to}
                to={i.to}
                data-testid={i.id}
                className={({ isActive }) =>
                  `rounded-full px-4 py-2 text-sm font-medium transition-colors duration-200 ${
                    isActive ? "bg-white/10 text-white" : "text-zinc-400 hover:text-white"
                  }`
                }
              >
                {i.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/checkout" data-testid="cart-button"
              className="relative rounded-full p-2 text-zinc-400 transition-colors duration-200 hover:text-white">
              <ShoppingBag className="h-5 w-5" />
              {totalQty > 0 && (
                <span data-testid="cart-badge"
                  className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#007AFF] px-1 text-[10px] font-bold text-white">
                  {totalQty}
                </span>
              )}
            </Link>
            <span data-testid="current-user-name" className="hidden text-sm text-zinc-400 sm:block">
              {user?.name}
            </span>
            <Button
              data-testid="logout-button"
              variant="ghost"
              size="icon"
              className="rounded-full text-zinc-400 hover:text-white"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-28 pt-8 md:pb-16">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-zinc-950/90 backdrop-blur-xl md:hidden">
        <div className="flex">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              data-testid={`${i.id}-mobile`}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-3 text-[11px] font-medium ${
                  isActive ? "text-[#007AFF]" : "text-zinc-500"
                }`
              }
            >
              <i.icon className="h-5 w-5" />
              {i.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
