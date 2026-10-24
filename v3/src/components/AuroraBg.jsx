/* Aurora 流动渐变背景层（MASTER §4）：固定在页面最底，内容之上不出焦点 */
export default function AuroraBg() {
  return <div className="aurora fixed inset-0 -z-10" aria-hidden="true" />
}
