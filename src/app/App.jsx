import React, { useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

import AppLayout from "../layout/AppLayout";
import CompanyPage from "../pages/CompanyPage";
import DashboardPage from "../pages/DashboardPage";
import InventoryPage from "../pages/InventoryPage";
import LoginPage from "../pages/LoginPage";
import MarketReferencesPage from "../pages/MarketReferencesPage";
import NewQuotePage from "../pages/NewQuotePage";
import PricingPage from "../pages/PricingPage";
import QuoteHistoryPage from "../pages/QuoteHistoryPage";
import { subscribeToAuth } from "../services/authService";

function LoadingScreen() {
  return (
    <div className="auth-screen">
      <p className="muted">Cargando ValoraCloud...</p>
    </div>
  );
}

function RequireAuth({ usuario, children }) {
  const location = useLocation();

  if (!usuario) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

function AppRoutes({ usuario }) {
  return (
    <Routes>
      <Route
        path="/login"
        element={usuario ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        element={
          <RequireAuth usuario={usuario}>
            <AppLayout usuario={usuario} />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<DashboardPage usuario={usuario} />} />
        <Route path="/empresa" element={<CompanyPage userId={usuario?.uid} />} />
        <Route
          path="/inventario"
          element={<InventoryPage userId={usuario?.uid} />}
        />
        <Route path="/referencias" element={<MarketReferencesPage />} />
        <Route
          path="/valorizacion"
          element={<PricingPage userId={usuario?.uid} />}
        />
        <Route path="/cotizaciones" element={<QuoteHistoryPage />} />
        <Route
          path="/cotizaciones/nueva"
          element={<NewQuotePage userId={usuario?.uid} />}
        />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToAuth((user) => {
      setUsuario(user);
      setCargando(false);
    });

    return () => unsubscribe();
  }, []);

  if (cargando) return <LoadingScreen />;

  return (
    <BrowserRouter>
      <AppRoutes usuario={usuario} />
    </BrowserRouter>
  );
}

export default App;
