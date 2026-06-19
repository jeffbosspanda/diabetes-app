import { AlertTriangle } from 'lucide-react';

export default function ConfirmDialog({ title, message, confirmLabel = '確認', cancelLabel = '取消', danger = false, onConfirm, onCancel }) {
  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog-box" onClick={e => e.stopPropagation()}>
        <div className="dialog-icon">
          <AlertTriangle size={22} color={danger ? '#ef4444' : '#f59e0b'} />
        </div>
        {title && <div className="dialog-title">{title}</div>}
        {message && <div className="dialog-message">{message}</div>}
        <div className="dialog-btns">
          <button className="btn-secondary" onClick={onCancel}>{cancelLabel}</button>
          <button className={danger ? 'btn-danger-confirm' : 'btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
