import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Evita la "pantalla en blanco": si algo revienta al renderizar, en vez de
 * desmontar toda la app React muestra este cartel con el error real y la
 * opcion de recargar / reintentar.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("ErrorBoundary:", error, info.componentStack ?? "");
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="card" style={{ margin: 20, maxWidth: 720 }}>
        <div className="card-title">Esta pantalla fallo al cargarse</div>
        <p className="muted">
          La aplicacion evito quedarse en blanco. Puedes reintentar; si vuelve a
          fallar, recarga la pagina o copia el error de abajo.
        </p>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontSize: 12,
            background: "rgba(0,0,0,.05)",
            padding: 10,
            borderRadius: 8,
            maxHeight: 240,
            overflow: "auto",
          }}
        >
          {String(error?.stack || error?.message || error)}
        </pre>
        <div className="row gap" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Recargar pagina
          </button>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }
}
