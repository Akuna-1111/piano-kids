import type { CSSProperties } from 'react';
import { themeToCssVars, type SkinTheme } from './skinThemes';

/**
 * 琴键材质样品（设计规范 §12.1「琴键样品板」）。
 *
 * 装扮页不用「色卡 + 商品卡」表达皮肤，而是直接给出一小段**真实琴键**：
 * 与真键盘共用同一套 `--skin-*` 变量、同一套双层结构
 * （白键层流式 + 黑键层绝对定位，§10.3）。
 *
 * 因此样品就是那块材质本身，而不是对它的描述 ——
 * 孩子看到什么，弹到的就是什么。
 *
 * ⚠️ 注意：这里注入的是**受限的皮肤变量**（themeToCssVars 的输出），
 * 不是任意 CSS 字符串（§11.1、§33）。
 */
export function SkinSample({ theme }: { theme: SkinTheme }) {
  return (
    <span
      className="skin-sample"
      style={themeToCssVars(theme) as CSSProperties}
      aria-hidden
    >
      <span className="skin-sample__whites">
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className="skin-sample__white" />
        ))}
      </span>
      <span className="skin-sample__blacks">
        {/* 黑键落点与真键盘一致：白键分界线上 */}
        <span className="skin-sample__black" style={{ left: '17.5%' }} />
        <span className="skin-sample__black" style={{ left: '42.5%' }} />
      </span>
    </span>
  );
}
