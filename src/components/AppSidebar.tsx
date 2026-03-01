import { Link, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  ShoppingCart,
  ScrollText,
  Settings,
  Zap,
  ChevronLeft,
  ChevronRight,
  BoxesIcon,
  Sun,
  Moon,
  Book,
  Bot,
  Search,
} from "lucide-react";
import { useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { StoreSwitcher } from "@/components/StoreSwitcher";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/products", label: "Produkte", icon: BoxesIcon },
  { path: "/listings", label: "Listings", icon: Package },
  { path: "/orders", label: "Orders", icon: ShoppingCart },
  { path: "/autopilot", label: "Autopilot", icon: Bot },
  { path: "/discovery", label: "Discovery", icon: Search },
  { path: "/logs", label: "Logs", icon: ScrollText },
  { path: "/settings", label: "Settings", icon: Settings },
  { path: "/api-docs", label: "API Docs", icon: Book },
];

export function AppSidebar() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const { theme, toggleTheme } = useTheme();

  return (
    <aside
      className={`fixed left-0 top-0 h-screen bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300 ease-in-out z-50 ${
        collapsed ? "w-[68px]" : "w-[240px]"
      }`}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-16">
        <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center flex-shrink-0 shadow-apple-sm">
          <Zap className="w-[18px] h-[18px] text-primary-foreground" />
        </div>
        {!collapsed && (
          <span className="font-semibold text-foreground text-[15px] tracking-tight">
            SellerPilot
          </span>
        )}
      </div>

      {/* Store Switcher */}
      <div className="px-3 pb-2 border-b border-sidebar-border mb-1">
        <StoreSwitcher collapsed={collapsed} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-2 px-3 space-y-0.5">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`nav-item ${isActive ? "nav-item-active" : "nav-item-inactive"}`}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="w-[18px] h-[18px] flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Theme toggle & Collapse */}
      <div className="p-3 border-t border-sidebar-border space-y-0.5">
        <button
          onClick={toggleTheme}
          className="nav-item nav-item-inactive w-full"
          title={collapsed ? (theme === "dark" ? "Light Mode" : "Dark Mode") : undefined}
        >
          {theme === "dark" ? <Sun className="w-4 h-4 flex-shrink-0" /> : <Moon className="w-4 h-4 flex-shrink-0" />}
          {!collapsed && <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>}
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="nav-item nav-item-inactive w-full justify-center"
        >
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}
