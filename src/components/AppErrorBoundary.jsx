import React from "react";
import {House, RotateCw, TriangleAlert} from "lucide-react";
import {useLocation, useNavigate} from "react-router-dom";
import AppStatusPage from "./AppStatusPage";

// Atrapa los errores de renderizado de sus hijos y muestra `renderFallback`.
// Solo guarda que falló: nunca el error, para que ni el mensaje ni la pila
// lleguen a la pantalla. El error se registra con console.error y no se envía
// a ningún servicio externo. No atrapa errores de eventos ni de código
// asíncrono (límite de React): esos los maneja cada pantalla.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {failed: false};
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError() {
    return {failed: true};
  }

  componentDidCatch(error, info) {
    console.error("Error de renderizado en la pantalla:", error, info?.componentStack);
  }

  componentDidUpdate(previousProps) {
    // Navegar a otra pantalla limpia el error.
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({failed: false});
    }
  }

  reset() {
    this.setState({failed: false});
  }

  render() {
    if (this.state.failed) return this.props.renderFallback({reset: this.reset});
    return this.props.children;
  }
}

export function renderErrorFallback({homePath, onGoHome, reset, variant}) {
  return (
    <AppStatusPage
      variant={variant}
      role="alert"
      icon={TriangleAlert}
      illustration="error"
      titleId="app-error-title"
      title="Algo salió mal"
      description={variant === "screen"
        ? "Ocurrió un problema inesperado y no pudimos mostrar la aplicación. Puedes intentarlo de nuevo o volver al inicio. Si sigue pasando, avisa a quien administra tu cuenta."
        : "Ocurrió un problema inesperado y no pudimos mostrar esta pantalla. El menú sigue disponible: puedes intentarlo de nuevo o volver al inicio."}
      actions={[
        {label: "Reintentar", icon: RotateCw, onClick: reset},
        {label: "Ir al inicio", icon: House, onClick: () => onGoHome(homePath)},
      ]}
    />
  );
}

// Boundary de rutas: se reinicia al cambiar de ruta y "Ir al inicio" navega
// dentro de la aplicación. Montado alrededor de todas las rutas (variant
// "screen") y alrededor del contenido de cada layout (variant "content", que
// deja el menú y el encabezado funcionando).
export function RouteErrorBoundary({children, homePath = "/", variant = "content"}) {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <ErrorBoundary
      resetKey={location.key}
      renderFallback={({reset}) => renderErrorFallback({
        homePath,
        onGoHome: (path) => navigate(path),
        reset,
        variant,
      })}
    >
      {children}
    </ErrorBoundary>
  );
}

export default RouteErrorBoundary;
