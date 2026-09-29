/**
 * 可折叠区块：点击标题展开 / 收起内容。
 * 仅用于界面层级整理，不引入任何 UI 组件库。
 */
import { useState, type ReactNode } from 'react';

interface Props {
  title: string;
  /** 标题旁的计数（如标注数量），可选 */
  count?: number;
  /** 初始是否展开 */
  defaultOpen?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({ title, count, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="collapsible">
      <button
        type="button"
        className="collapsible-head panel-title"
        onClick={() => setOpen((v) => !v)}
        title={open ? '点击收起' : '点击展开'}
      >
        {title}
        {count !== undefined && <span className="collapsible-count">（{count}）</span>}
        <span className={`collapsible-arrow ${open ? 'open' : ''}`}>▾</span>
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </section>
  );
}
