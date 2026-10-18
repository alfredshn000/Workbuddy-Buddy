import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { Settings } from '../settings';
import './Settings.css';

export interface SettingsProps {
  open: boolean;
  value: Settings;
  onChange: (next: Settings) => void;
  onClose: () => void;
  /** 隐藏窗口（保留进程与托盘） */
  onHide?: () => void;
  /** 退出应用 */
  onQuit?: () => void;
  /** 被删除（隐藏）的任务数量 */
  hiddenCount?: number;
  /** 恢复被删除的任务 */
  onRestoreHidden?: () => void;
}

const SCALE_OPTIONS: ReadonlyArray<Settings['scale']> = [1, 2, 3];

/** 秒数输入：空 / 非整数 / 非正数 一律非法 */
function parseSeconds(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

interface SwitchProps {
  checked: boolean;
  label: string;
  onToggle: (next: boolean) => void;
}

function Switch({ checked, label, onToggle }: SwitchProps): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`st-switch${checked ? ' is-on' : ''}`}
      onClick={() => onToggle(!checked)}
    >
      <span className="st-knob" aria-hidden="true" />
    </button>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (next: number) => void;
}

function Slider({ label, value, min, max, step, suffix, onChange }: SliderProps): JSX.Element {
  return (
    <div className="st-row st-row-slider">
      <span className="st-label">{label}</span>
      <div className="st-slider-wrap">
        <input
          className="st-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="st-slider-val">
          {value.toFixed(2)}
          {suffix ?? ''}
        </span>
      </div>
    </div>
  );
}

export default function Settings({
  open,
  value,
  onChange,
  onClose,
  onHide,
  onQuit,
  hiddenCount = 0,
  onRestoreHidden,
}: SettingsProps): JSX.Element | null {
  const [slowDraft, setSlowDraft] = useState(String(value.slowSec));
  const [stuckDraft, setStuckDraft] = useState(String(value.stuckSec));

  // 外部值变化（载入 / 重置）时同步输入框草稿
  useEffect(() => {
    setSlowDraft(String(value.slowSec));
  }, [value.slowSec]);

  useEffect(() => {
    setStuckDraft(String(value.stuckSec));
  }, [value.stuckSec]);

  if (!open) return null;

  const slowNum = parseSeconds(slowDraft);
  const stuckNum = parseSeconds(stuckDraft);
  const effSlow = slowNum ?? value.slowSec;
  const effStuck = stuckNum ?? value.stuckSec;
  const slowInvalid = slowNum === null || slowNum >= effStuck;
  const stuckInvalid = stuckNum === null || stuckNum <= effSlow;

  const patch = (part: Partial<Settings>) => onChange({ ...value, ...part });

  const editSlow = (raw: string) => {
    setSlowDraft(raw);
    const n = parseSeconds(raw);
    // 非法值不写入：保持草稿，等用户改对
    if (n === null || n >= effStuck) return;
    patch({ slowSec: n });
  };

  const editStuck = (raw: string) => {
    setStuckDraft(raw);
    const n = parseSeconds(raw);
    if (n === null || n <= effSlow) return;
    patch({ stuckSec: n });
  };

  return (
    <aside className="st" role="dialog" aria-label="设置" onClick={(e) => e.stopPropagation()}>
      <div className="st-head">
        <span className="st-heading">设置</span>
        <button
          type="button"
          className="st-close"
          aria-label="关闭"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      </div>

      <div className="st-body">
        <section className="st-group">
          <h3 className="st-group-title">外观</h3>
          <div className="st-row">
            <span className="st-label">球体缩放</span>
            <div className="st-seg" role="group" aria-label="球体缩放">
              {SCALE_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`st-seg-btn${value.scale === s ? ' is-on' : ''}`}
                  aria-pressed={value.scale === s}
                  onClick={() => patch({ scale: s })}
                >
                  {s}×
                </button>
              ))}
            </div>
          </div>
          <div className="st-row">
            <span className="st-label">气泡</span>
            <Switch
              checked={value.bubbleEnabled}
              label="气泡"
              onToggle={(v) => patch({ bubbleEnabled: v })}
            />
          </div>
          <Slider
            label="尺寸"
            value={value.size}
            min={0.6}
            max={1.6}
            step={0.05}
            suffix="×"
            onChange={(v) => patch({ size: v })}
          />
          <Slider
            label="亮度"
            value={value.brightness}
            min={0.6}
            max={1.4}
            step={0.05}
            suffix="×"
            onChange={(v) => patch({ brightness: v })}
          />
          <Slider
            label="不透明度"
            value={value.opacity}
            min={0.3}
            max={1}
            step={0.05}
            onChange={(v) => patch({ opacity: v })}
          />
        </section>

        <section className="st-group">
          <h3 className="st-group-title">判定</h3>
          <div className="st-row">
            <label className="st-label" htmlFor="st-slow">
              迟缓阈值
            </label>
            <span className="st-num-wrap">
              <input
                id="st-slow"
                className={`st-num${slowInvalid ? ' is-bad' : ''}`}
                type="number"
                min={10}
                max={600}
                step={5}
                inputMode="numeric"
                aria-invalid={slowInvalid}
                value={slowDraft}
                onChange={(e) => editSlow(e.target.value)}
              />
              <span className="st-unit">秒</span>
            </span>
          </div>
          <div className="st-row">
            <label className="st-label" htmlFor="st-stuck">
              卡住阈值
            </label>
            <span className="st-num-wrap">
              <input
                id="st-stuck"
                className={`st-num${stuckInvalid ? ' is-bad' : ''}`}
                type="number"
                min={10}
                max={600}
                step={5}
                inputMode="numeric"
                aria-invalid={stuckInvalid}
                value={stuckDraft}
                onChange={(e) => editStuck(e.target.value)}
              />
              <span className="st-unit">秒</span>
            </span>
          </div>
        </section>

        <section className="st-group">
          <h3 className="st-group-title">提醒</h3>
          <div className="st-row">
            <span className="st-label">完成提醒</span>
            <Switch checked={value.notifyDone} label="完成提醒" onToggle={(v) => patch({ notifyDone: v })} />
          </div>
          <div className="st-row">
            <span className="st-label">待确认提醒</span>
            <Switch
              checked={value.notifyAttention}
              label="待确认提醒"
              onToggle={(v) => patch({ notifyAttention: v })}
            />
          </div>
        </section>

        <section className="st-group">
          <h3 className="st-group-title">任务</h3>
          <div className="st-row">
            <span className="st-label">已隐藏</span>
            <div className="st-inline">
              <span className="st-inline-val">{hiddenCount} 个</span>
              <button
                type="button"
                className="st-action st-action-sm"
                disabled={hiddenCount === 0 || !onRestoreHidden}
                onClick={(e) => {
                  e.stopPropagation();
                  onRestoreHidden?.();
                }}
              >
                恢复
              </button>
            </div>
          </div>
        </section>

        <section className="st-group">
          <h3 className="st-group-title">系统</h3>
          <div className="st-row">
            <span className="st-label">开机自启</span>
            <Switch
              checked={value.launchAtLogin}
              label="开机自启"
              onToggle={(v) => patch({ launchAtLogin: v })}
            />
          </div>
          <div className="st-row">
            <span className="st-label">全屏时降低存在感</span>
            <Switch
              checked={value.autoHideFullscreen}
              label="全屏时降低存在感"
              onToggle={(v) => patch({ autoHideFullscreen: v })}
            />
          </div>
        </section>
      </div>

      <div className="st-foot">开机自启需桌面端支持，当前仅保存偏好</div>

      <div className="st-footer">
        <button
          type="button"
          className="st-action"
          onClick={(e) => {
            e.stopPropagation();
            onHide?.();
          }}
        >
          隐藏
        </button>
        <button
          type="button"
          className="st-action is-danger"
          onClick={(e) => {
            e.stopPropagation();
            onQuit?.();
          }}
        >
          退出
        </button>
      </div>
    </aside>
  );
}
