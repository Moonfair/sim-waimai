import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { AddressProvider } from './context/AddressContext';
import { ThemeProvider } from './context/ThemeContext';
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
                <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
              </Routes>
            </CartProvider>
          </AddressProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
