import type { JSX } from 'react';
import { STATE_COLOR } from '../buddy/states';
import './Toast.css';

export type ToastKind = 'done' | 'attention' | 'stalled' | 'credit';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  desc?: string;
}

export interface ToastProps {
  /** 生命周期由父层维护（含自动消失），本组件只负责渲染 */
  items: ToastItem[];
  onDismiss: (id: string) => void;
  /** 点击正文（非关闭按钮） */
  onActivate?: (item: ToastItem) => void;
}

const KIND_COLOR: Record<ToastKind, string> = {
  done: STATE_COLOR.completed,
  attention: STATE_COLOR.attention,
  stalled: STATE_COLOR.stalled,
  credit: '#3FC8E8',
};

/** 最多同时显示 4 条，超出时保留最新的（数组末尾） */
const MAX_VISIBLE = 4;

export default function Toast({ items, onDismiss, onActivate }: ToastProps): JSX.Element | null {
  if (items.length === 0) return null;

  return (
    <div className="toast-stack" role="region" aria-label="通知" aria-live="polite">
      {items.slice(-MAX_VISIBLE).map((item) => (
        <div
          key={item.id}
          className={`toast${onActivate ? ' is-clickable' : ''}`}
          onClick={onActivate ? () => onActivate(item) : undefined}
        >
          <span className="toast-bar" style={{ background: KIND_COLOR[item.kind] }} aria-hidden="true" />
          <div className="toast-main">
            <div className="toast-title">{item.title}</div>
            {item.desc && <div className="toast-desc">{item.desc}</div>}
          </div>
          <button
            type="button"
            className="toast-close"
            aria-label="关闭"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss(item.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
