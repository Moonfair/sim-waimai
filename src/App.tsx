import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { AddressProvider } from './context/AddressContext';
import { ThemeProvider } from './context/ThemeContext';
import RequireAdmin from './components/RequireAdmin';
import RequireAuth from './components/RequireAuth';
import Home from './pages/Home';
import Restaurant from './pages/Restaurant';
import Cart from './pages/Cart';
import Order from './pages/Order';
import Tracking from './pages/Tracking';
import Done from './pages/Done';
import Login from './pages/Login';
import Register from './pages/Register';
import Profile from './pages/Profile';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Favorites from './pages/Favorites';
import MerchantHome from './pages/MerchantHome';
import MerchantEdit from './pages/MerchantEdit';
import AdminReview from './pages/AdminReview';
import AdminReviewDetail from './pages/AdminReviewDetail';

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ThemeProvider>
        <AuthProvider>
          <AddressProvider>
            <CartProvider>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/restaurant/:id" element={<Restaurant />} />
                <Route path="/cart" element={<Cart />} />
                <Route path="/order" element={<Order />} />
                <Route path="/tracking" element={<Tracking />} />
                <Route path="/done" element={<Done />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/orders" element={<RequireAuth><Orders /></RequireAuth>} />
                <Route path="/orders/:id" element={<RequireAuth><OrderDetail /></RequireAuth>} />
                <Route path="/favorites" element={<RequireAuth><Favorites /></RequireAuth>} />
                <Route path="/merchant" element={<RequireAuth><MerchantHome /></RequireAuth>} />
                <Route path="/merchant/:id" element={<RequireAuth><MerchantEdit /></RequireAuth>} />
                <Route path="/admin/review" element={<RequireAdmin><AdminReview /></RequireAdmin>} />
                <Route
                  path="/admin/review/restaurant/:id"
                  element={
                    <RequireAdmin>
                      <AdminReviewDetail targetType="restaurant" />
                    </RequireAdmin>
                  }
                />
                <Route
                  path="/admin/review/item/:id/:itemId"
                  element={
                    <RequireAdmin>
                      <AdminReviewDetail targetType="menuItem" />
                    </RequireAdmin>
                  }
                />
              </Routes>
            </CartProvider>
          </AddressProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
