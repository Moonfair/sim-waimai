import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { CartProvider } from './context/CartContext';
import { AddressProvider } from './context/AddressContext';
import Home from './pages/Home';
import Restaurant from './pages/Restaurant';
import Cart from './pages/Cart';
import Order from './pages/Order';
import Tracking from './pages/Tracking';
import Done from './pages/Done';

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AddressProvider>
        <CartProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/restaurant/:id" element={<Restaurant />} />
            <Route path="/cart" element={<Cart />} />
            <Route path="/order" element={<Order />} />
            <Route path="/tracking" element={<Tracking />} />
            <Route path="/done" element={<Done />} />
          </Routes>
        </CartProvider>
      </AddressProvider>
    </BrowserRouter>
  );
}
