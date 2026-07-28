import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { AddressProvider } from './context/AddressContext';
import { ThemeProvider } from './context/ThemeContext';
import { RiderHallProvider } from './context/RiderHallContext';
import GrabOrderBubble from './components/GrabOrderBubble';
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
import Search from './pages/Search';
import MerchantHome from './pages/MerchantHome';
import MerchantEdit from './pages/MerchantEdit';
import MerchantReviews from './pages/MerchantReviews';
import AdminReview from './pages/AdminReview';
import AdminReviewDetail from './pages/AdminReviewDetail';
import AdminStats from './pages/AdminStats';
import AdminShops from './pages/AdminShops';
import AdminReports from './pages/AdminReports';
import AdminUsers from './pages/AdminUsers';
import RiderStats from './pages/RiderStats';
import RiderTracking from './pages/RiderTracking';
import RiderDone from './pages/RiderDone';

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ThemeProvider>
        <AuthProvider>
          <AddressProvider>
            <CartProvider>
              <RiderHallProvider>
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
                  <Route path="/rider-stats" element={<RequireAuth><RiderStats /></RequireAuth>} />
                  <Route path="/rider-tracking" element={<RequireAuth><RiderTracking /></RequireAuth>} />
                  <Route path="/rider-done" element={<RequireAuth><RiderDone /></RequireAuth>} />
                  <Route path="/search" element={<Search />} />
                  <Route path="/merchant" element={<RequireAuth><MerchantHome /></RequireAuth>} />
                  <Route path="/merchant/:id" element={<RequireAuth><MerchantEdit /></RequireAuth>} />
                  <Route path="/merchant/:id/reviews" element={<RequireAuth><MerchantReviews /></RequireAuth>} />
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
                  <Route
                    path="/admin/review/user-review/:id"
                    element={
                      <RequireAdmin>
                        <AdminReviewDetail targetType="review" />
                      </RequireAdmin>
                    }
                  />
                  <Route path="/admin/stats" element={<RequireAdmin><AdminStats /></RequireAdmin>} />
                  <Route path="/admin/shops" element={<RequireAdmin><AdminShops /></RequireAdmin>} />
                  <Route path="/admin/reports" element={<RequireAdmin><AdminReports /></RequireAdmin>} />
                  <Route path="/admin/users" element={<RequireAdmin><AdminUsers /></RequireAdmin>} />
                </Routes>
                <GrabOrderBubble />
              </RiderHallProvider>
            </CartProvider>
          </AddressProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
