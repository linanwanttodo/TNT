import { clsx, type ClassValue } from "clsx";

// ZCode 原版（components/lib/utils.ts）是 clsx + extendTailwindMerge。
// TNT 的 webui 尚未安装 tailwind-merge（依赖 tailwindcss），先把 tailwind-merge
// 那半边去掉，只保留 clsx 合并行为；装好 tailwind 后按原版恢复。
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
