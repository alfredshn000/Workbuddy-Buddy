import { useState } from 'react';
import type { JSX } from 'react';
import { STATE_COLOR } from '../buddy/states';
import type { TaskSnapshot, TaskState } from '../events';
import './TaskPanel.css';

export interface TaskPanelProps {
  tasks: TaskSnapshot[];
  open: boolean;
  onClose: () => void;
  onSelect?: (id: string) => void;
  /** 打开设置面板（面板头部的小按钮） */
  onOpenSettings?: () => void;
  /** 从面板里删除这条任务（不再显示卫星与通知） */
  onDelete?: (id: string) => void;
}

/** 分组顺序：待确认 → 卡住 → 进行中 → 已完成 */
const GROUP_ORDER: TaskState[] = ['attention', 'stalled', 'working', 'completed'];

const STATE_LABEL: Record<TaskState, string> = {
  working: '进行中',
  attention: '待确认',
  stalled: '卡住',
  completed: '已完成',
};

export default function TaskPanel({ tasks, open, onClose, onSelect, onOpenSettings, onDelete }: TaskPanelProps): JSX.Element | null {
  const [doneOpen, setDoneOpen] = useState(false);

  if (!open) return null;

  const groups = GROUP_ORDER.map((state) => ({
    state,
    label: STATE_LABEL[state],
    color: STATE_COLOR[state],
    items: tasks.filter((t) => t.state === state),
  })).filter((g) => g.items.length > 0);

  const total = tasks.length;

  return (
    <aside className="tp" aria-label="任务列表">
      <div className="tp-head">
        <span className="tp-heading">任务</span>
        {total > 0 && <span className="tp-total">{total}</span>}
        {onOpenSettings && (
          <button
            type="button"
            className="tp-gear"
            aria-label="设置"
            onClick={(e) => {
              e.stopPropagation();
              onOpenSettings();
            }}
          >
            ⚙
          </button>
        )}
        <button type="button" className="tp-close" onClick={onClose} aria-label="关闭">
          ×
        </button>
      </div>

      {total === 0 ? (
        <div className="tp-empty">当前没有任务</div>
      ) : (
        <div className="tp-body">
          {groups.map((g) => {
            const isDone = g.state === 'completed';
            const collapsed = isDone && !doneOpen;

            return (
              <section className="tp-group" key={g.state}>
                {isDone ? (
                  <button
                    type="button"
                    className={`tp-group-head tp-group-head--toggle${doneOpen ? ' is-open' : ''}`}
                    onClick={() => setDoneOpen((v) => !v)}
                    aria-expanded={doneOpen}
                  >
                    <span className="tp-dot" style={{ background: g.color, boxShadow: `0 0 6px ${g.color}` }} />
                    <span className="tp-group-label" style={{ color: g.color }}>
                      已完成 {g.items.length} 项
                    </span>
                    <span className="tp-caret" aria-hidden="true" />
                  </button>
                ) : (
                  <div className="tp-group-head">
                    <span className="tp-dot" style={{ background: g.color, boxShadow: `0 0 6px ${g.color}` }} />
                    <span className="tp-group-label" style={{ color: g.color }}>
                      {g.label}
                    </span>
                    <span className="tp-group-count">{g.items.length}</span>
                  </div>
                )}

                {!collapsed && (
                  <ul className="tp-list">
                    {g.items.map((t) => (
                      <li key={t.id} className="tp-row">
                        <button
                          type="button"
                          className={`tp-item${onSelect ? ' is-clickable' : ''}`}
                          onClick={onSelect ? () => onSelect(t.id) : undefined}
                        >
                          <span className="tp-bar" style={{ background: g.color }} />
                          <span className="tp-text">
                            <span className="tp-name">{t.title}</span>
                            <span className="tp-meta">
                              {t.tool ? `${t.tool} · ${g.label}` : g.label}
                            </span>
                          </span>
                        </button>
                        {onDelete && (
                          <button
                            type="button"
                            className="tp-del"
                            aria-label={`删除任务 ${t.title}`}
                            title="删除（不再显示卫星与通知）"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(t.id);
                            }}
                          >
                            ×
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </aside>
  );
}
