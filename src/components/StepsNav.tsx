/**
 * 顶部 5 步流程导航（纯展示组件）。
 * 只根据当前状态高亮对应步骤，帮助用户理解流程，不改变任何业务逻辑。
 */

const STEPS = [
  { no: 1, name: '上传作品' },
  { no: 2, name: '标记信息' },
  { no: 3, name: '设置传播场景' },
  { no: 4, name: '查看风险' },
  { no: 5, name: '修改后验证' },
];

interface Props {
  /** 当前步骤（1～5），由 App 按简单规则推导 */
  currentStep: number;
}

export function StepsNav({ currentStep }: Props) {
  return (
    <nav className="steps-nav" aria-label="使用流程">
      {STEPS.map((step, i) => (
        <div
          key={step.no}
          className={`step-item ${currentStep === step.no ? 'active' : ''} ${
            currentStep > step.no ? 'done' : ''
          }`}
        >
          <span className="step-no">{step.no}</span>
          <span className="step-name">{step.name}</span>
          {i < STEPS.length - 1 && <span className="step-arrow">→</span>}
        </div>
      ))}
    </nav>
  );
}
