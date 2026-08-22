import React, { useCallback, useEffect, useState } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";

import AppLayout from "../layout/AppLayout";
import EnvironmentNotice from "../components/EnvironmentNotice";
import ToastRouteSync from "../components/ToastRouteSync";
import CompanyPage from "../pages/CompanyPage";
import ClientsPage from "../pages/ClientsPage";
import ProvidersPage from "../pages/ProvidersPage";
import AccountPage from "../pages/AccountPage";
import DashboardPage from "../pages/DashboardPage";
import FinancePage from "../pages/FinancePage";
import InventoryPage from "../pages/InventoryPage";
import LoginPage from "../pages/LoginPage";
import MarketReferencesPage from "../pages/MarketReferencesPage";
import NewQuotePage from "../pages/NewQuotePage";
import OnboardingPage from "../pages/OnboardingPage";
import PricingPage from "../pages/PricingPage";
import QuoteHistoryPage from "../pages/QuoteHistoryPage";
import PublicQuoteProposalPage from "../pages/PublicQuoteProposalPage";
import NewPurchaseOrderPage from "../pages/NewPurchaseOrderPage";
import PurchaseOrdersPage from "../pages/PurchaseOrdersPage";
import NewPurchasePage from "../pages/NewPurchasePage";
import PurchasesPage from "../pages/PurchasesPage";
import ReceptionsPage from "../pages/ReceptionsPage";
import NewReceptionPage from "../pages/NewReceptionPage";
import NewSalePage from "../pages/NewSalePage";
import SalesPage from "../pages/SalesPage";
import ReferenceTasksPage from "../pages/ReferenceTasksPage";
import StatisticsPage from "../pages/StatisticsPage";
import BusinessUnavailablePage from "../pages/BusinessUnavailablePage";
import EmployeesPage from "../pages/EmployeesPage";
import WorksPage from "../pages/WorksPage";
import Button from "../components/ui/Button";
import { subscribeToAuth } from "../services/authService";
import {
  getBusinessSession,
  setActiveBusiness,
} from "../services/businessService";

function LoadingScreen() {
  return (
    <div className="auth-screen">
      <p className="muted">Cargando ValoraCloud...</p>
    </div>
  );
}

function BusinessSessionError({ onRetry }) {
  return (
    <main className="onboarding-screen">
      <section className="onboarding-card onboarding-card--message">
        <h1>No pudimos abrir tu espacio de trabajo</h1>
        <p>
          No fue posible comprobar el negocio asociado a tu cuenta. Revisa la
          conexión y vuelve a intentarlo.
        </p>
        <div className="onboarding-message-actions">
          <Button type="button" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      </section>
    </main>
  );
}

function AppRoutes({
  usuario,
  loading,
  businessError,
  businessChanging,
  businessSession,
  onBusinessChanged,
  onBusinessCreated,
  onRetry,
}) {
  const location = useLocation();
  if (/^\/propuesta\/[^/]+\/?$/.test(location.pathname)) {
    return (
      <Routes>
        <Route path="/propuesta/:token" element={<PublicQuoteProposalPage />} />
        <Route path="*" element={<PublicQuoteProposalPage />} />
      </Routes>
    );
  }

  if (loading) return <LoadingScreen />;

  if (usuario && businessError) {
    return <BusinessSessionError onRetry={onRetry} />;
  }

  if (!usuario) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (businessSession?.accessState === "unavailable") {
    return (
      <Routes>
        <Route
          path="*"
          element={
            <BusinessUnavailablePage
              usuario={usuario}
              onRetry={onBusinessCreated}
            />
          }
        />
      </Routes>
    );
  }

  if (businessSession?.needsOnboarding) {
    return (
      <Routes>
        <Route
          path="/onboarding"
          element={
            <OnboardingPage
              usuario={usuario}
              onBusinessCreated={onBusinessCreated}
            />
          }
        />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

  const activeBusiness = businessSession?.activeBusiness;
  const businessId = activeBusiness?.id;
  const canWriteQuotes = ["OWNER", "ADMIN"].includes(
   String(activeBusiness?.role || "").toUpperCase()
  );
  return (
    <Routes>
      <Route
        path="/login"
        element={<Navigate to="/dashboard" replace />}
      />
      <Route path="/onboarding" element={<Navigate to="/dashboard" replace />} />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        element={
          <AppLayout
            usuario={usuario}
            businessChanging={businessChanging}
            businessSession={businessSession}
            negocioActivo={activeBusiness}
            onBusinessChanged={onBusinessChanged}
            onBusinessCreated={onBusinessCreated}
          />
        }
      >
        <Route
          path="/dashboard"
          element={
            <DashboardPage
              key={businessId}
              usuario={usuario}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route path="/resumen" element={<Navigate to="/dashboard" replace />} />
        <Route
          path="/finanzas"
          element={
            <FinancePage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/reportes"
          element={
            <StatisticsPage key={businessId} businessId={businessId} />
          }
        />
        <Route path="/estadisticas" element={<Navigate to="/reportes" replace />} />
        <Route
          path="/empresa"
          element={
            <CompanyPage
              key={businessId}
              userId={businessId}
              role={activeBusiness?.role}
              onBusinessUpdated={onBusinessCreated}
            />
          }
        />
        <Route
          path="/empleados"
          element={
            <EmployeesPage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/trabajos"
          element={
            <WorksPage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/cuenta"
          element={<AccountPage key={usuario?.uid} usuario={usuario} />}
        />
        <Route
          path="/inventario"
          element={
            <InventoryPage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/referencias"
          element={
            <MarketReferencesPage key={businessId} userId={businessId} role={activeBusiness?.role}
        />
          }
        />
        <Route
          path="/tareas-referencias"
          element={
            <ReferenceTasksPage key={businessId} userId={businessId} role={activeBusiness?.role}
        />
          }
        />
        <Route
          path="/valorizacion"
          element={<PricingPage key={businessId} userId={businessId} />}
        />
        <Route
          path="/clientes"
          element={
            <ClientsPage
              key={businessId}
              businessId={businessId}
              countryCode={activeBusiness?.paisCodigo}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/proveedores"
          element={
            <ProvidersPage
              key={businessId}
              businessId={businessId}
              countryCode={activeBusiness?.paisCodigo}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/cotizaciones"
          element={
            <QuoteHistoryPage
              key={businessId}
              userId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
  path="/cotizaciones/nueva"
  element={
    canWriteQuotes ? (
      <NewQuotePage key={businessId} userId={businessId} />
    ) : (
      <Navigate to="/cotizaciones" replace />
    )
  }
/>

<Route
  path="/cotizaciones/:quoteId/editar"
  element={
    canWriteQuotes ? (
      <NewQuotePage key={businessId} userId={businessId} />
    ) : (
      <Navigate to="/cotizaciones" replace />
    )
  }
/>
        <Route
          path="/ordenes-compra"
          element={
            <PurchaseOrdersPage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/ordenes-compra/nueva"
          element={
            <NewPurchaseOrderPage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/ordenes-compra/:ordenCompraId/editar"
          element={
            <NewPurchaseOrderPage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/ordenes-compra/:ordenCompraId"
          element={
            <NewPurchaseOrderPage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/recepciones"
          element={
            <ReceptionsPage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/recepciones/:recepcionId/editar"
          element={
            <NewReceptionPage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/recepciones/:recepcionId"
          element={
            <NewReceptionPage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/compras"
          element={
            <PurchasesPage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/compras/nueva"
          element={
            <NewPurchasePage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/compras/:compraId/editar"
          element={
            <NewPurchasePage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/compras/:compraId"
          element={
            <NewPurchasePage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/ventas"
          element={
            <SalesPage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/ventas/nueva"
          element={
            <NewSalePage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/ventas/:ventaId/editar"
          element={
            <NewSalePage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
        <Route
          path="/ventas/:ventaId"
          element={
            <NewSalePage
              key={businessId}
              businessId={businessId}
              role={activeBusiness?.role}
            />
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function App() {
  const [usuario, setUsuario] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [businessState, setBusinessState] = useState({
    loading: false,
    data: null,
    error: null,
  });
  const [businessChanging, setBusinessChanging] = useState(false);

  const refreshBusinessSession = useCallback(async () => {
    setBusinessState((current) => ({ ...current, loading: true, error: null }));
    try {
      const data = await getBusinessSession();
      setBusinessState({ loading: false, data, error: null });
      return data;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error(
          "Error obteniendo la sesión de negocio:",
          error?.code,
          error?.message
        );
      }
      setBusinessState((current) =>
        current.data
          ? { loading: false, data: current.data, error: null }
          : { loading: false, data: null, error }
      );
      throw error;
    }
  }, []);

  const changeActiveBusiness = useCallback(async (businessId) => {
    setBusinessChanging(true);
    try {
      await setActiveBusiness(businessId);
      const data = await getBusinessSession();
      setBusinessState({ loading: false, data, error: null });
      return data;
    } finally {
      setBusinessChanging(false);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToAuth((user) => {
      setUsuario(user);
      setCargando(false);
      setBusinessState({
        loading: Boolean(user),
        data: null,
        error: null,
      });
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!usuario?.uid) return;
    let active = true;

    setBusinessState({ loading: true, data: null, error: null });
    getBusinessSession()
      .then((data) => {
        if (active) setBusinessState({ loading: false, data, error: null });
      })
      .catch((error) => {
        if (import.meta.env.DEV) {
          console.error(
            "Error obteniendo la sesión de negocio:",
            error?.code,
            error?.message
          );
        }
        if (active) setBusinessState({ loading: false, data: null, error });
      });

    return () => {
      active = false;
    };
  }, [usuario?.uid]);

  return (
    <BrowserRouter>
      <ToastRouteSync />
      <EnvironmentNotice />
      <AppRoutes
        usuario={usuario}
        loading={Boolean(
          cargando || (usuario && !businessState.data && !businessState.error)
        )}
        businessError={businessState.error}
        businessChanging={businessChanging}
        businessSession={businessState.data}
        onBusinessChanged={changeActiveBusiness}
        onBusinessCreated={refreshBusinessSession}
        onRetry={() => refreshBusinessSession().catch(() => {})}
      />
    </BrowserRouter>
  );
}

export default App;
