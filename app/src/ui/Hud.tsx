import type { JSX } from 'react';
import { fmtCredit } from '../buddy/states';
import './bubble-hud.css';

export interface HudProps {
  /** 累计积分 */
  total: number;
  /** 今日积分 */
  today: number;
  /** 每分钟消耗（燃速） */
  burnPerMin: number;
  /** 任务数 */
  tasks: number;
}

/** 底部统计条：累计 / 今日 / 燃速 / 任务 */
export default function Hud({ total, today, burnPerMin, tasks }: HudProps): JSX.Element {
  return (
    <div className="bhud">
      <div className="bhud-item">
        <span className="bhud-label">累计</span>
        <span className="bhud-value">{fmtCredit(total)}</span>
      </div>
      <div className="bhud-item">
        <span className="bhud-label">今日</span>
        <span className="bhud-value">{fmtCredit(today)}</span>
      </div>
      <div className="bhud-item">
        <span className="bhud-label">燃速</span>
        <span className="bhud-value">
          {fmtCredit(burnPerMin)}
          <span className="bhud-unit">/分</span>
        </span>
      </div>
      <div className="bhud-item">
        <span className="bhud-label">任务</span>
        <span className="bhud-value">{Math.round(tasks)}</span>
      </div>
    </div>
  );
}
