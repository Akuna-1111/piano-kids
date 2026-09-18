/** 极简 className 组合工具（不引入 clsx 之类的依赖）。 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
