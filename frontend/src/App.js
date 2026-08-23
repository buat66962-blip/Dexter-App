import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { CartProvider } from "@/context/CartContext";
import Layout from "@/components/Layout";
import Login from "@/pages/Login";
import Catalog from "@/pages/Catalog";
import Templates from "@/pages/Templates";
import Checkout from "@/pages/Checkout";
import ItemDetail from "@/pages/ItemDetail";
import MyBookings from "@/pages/MyBookings";
import BookingDetail from "@/pages/BookingDetail";
import Notifications from "@/pages/Notifications";
import Admin from "@/pages/Admin";
import "@/App.css";

function Protected({ children, adminOnly }) {
  const { user } = useAuth();
  if (user === null) return <div className="flex min-h-screen items-center justify-center bg-[#09090B] text-zinc-500">Memuat…</div>;
  if (user === false) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

function Shell() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<Protected><Catalog /></Protected>} />
      <Route path="/checkout" element={<Protected><Checkout /></Protected>} />
      <Route path="/paket" element={<Protected><Templates /></Protected>} />
      <Route path="/barang/:id" element={<Protected><ItemDetail /></Protected>} />
      <Route path="/peminjaman" element={<Protected><MyBookings /></Protected>} />
      <Route path="/peminjaman/:id" element={<Protected><BookingDetail /></Protected>} />
      <Route path="/notifikasi" element={<Protected><Notifications /></Protected>} />
      <Route path="/admin" element={<Protected adminOnly><Admin /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <Shell />
          <Toaster theme="dark" position="top-center" />
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
