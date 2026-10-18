import type { JSX } from 'react';
import './bubble-hud.css';

export interface BubbleProps {
  /** null 或空字符串 → 不渲染 */
  text: string | null;
  /** warn 用琥珀色，用于「卡住」「待确认」 */
  tone?: 'normal' | 'warn';
  /** 点 × 关闭气泡（父层负责持久化，重启后仍然关闭） */
  onClose?: () => void;
}

/**
 * 球体上方的工具提示气泡。
 * 定位：绝对定位，水平居中、整体贴在最近的定位父容器上边缘之上（留 6px 间隙）。
 */
export default function Bubble({ text, tone = 'normal', onClose }: BubbleProps): JSX.Element | null {
  if (!text) return null;

  return (
    <div className={`bubble-wrap bubble-${tone}`}>
      <div className="bubble">
        <span className="bubble-text">{text}</span>
        {onClose && (
          <button
            type="button"
            className="bubble-close"
            aria-label="关闭提示"
            onMouseDown={(e) => {
              // 别让点击变成拖动气泡
              e.stopPropagation();
              e.preventDefault();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            ×
          </button>
        )}
      </div>
      <span className="bubble-arrow" />
    </div>
  );
}
