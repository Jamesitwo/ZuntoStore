import { useEffect, useState, type ReactNode } from "react";

/** Modal generico (sustituye a alert/confirm/prompt del navegador). */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? " wide" : ""}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="modal-x" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/**
 * Confirmacion modal, con campo de texto opcional (ej. motivo de cancelacion).
 * Reemplaza a window.confirm / window.prompt.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  inputLabel,
  inputPlaceholder,
  confirmLabel = "Confirmar",
  danger,
  loading,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  inputLabel?: string;
  inputPlaceholder?: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  const needsInput = Boolean(inputLabel);
  const canConfirm = !needsInput || value.trim().length > 0;

  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn ghost" onClick={onCancel} disabled={loading}>
            Volver
          </button>
          <button
            className={`btn ${danger ? "danger" : "primary"}`}
            onClick={() => onConfirm(value)}
            disabled={!canConfirm || loading}
          >
            {loading ? "Procesando..." : confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ marginTop: 0 }}>{message}</p>
      {needsInput && (
        <div className="field">
          <label>{inputLabel}</label>
          <input
            autoFocus
            placeholder={inputPlaceholder}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canConfirm) onConfirm(value);
            }}
          />
        </div>
      )}
    </Modal>
  );
}
