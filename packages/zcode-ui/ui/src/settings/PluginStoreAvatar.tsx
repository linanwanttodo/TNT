import type { ReactNode } from "react";
import { PluginIcon } from "@/components/PluginIcon.js";
import type { StorePluginItem } from "@/settings/pluginStoreListing.js";

/**
 * 商店条目头像：listing.icon（仅 https）优先，加载失败或缺失时降级为
 * 确定性首字母彩色头像（基于插件 id 稳定 hash 到调色板），让无图插件在
 * 商店列表中有区分度，而不是全部显示同一个灰色占位符。
 * 外层容器仍由 PluginIcon 的 bg-surface rounded-xl 保持形态一致。
 */

/** 一组无障碍友好的头像底色（tailwind 类），色相均匀分布避免相邻撞色。 */
const AVATAR_COLORS = [
  "bg-blue-600",
  "bg-emerald-600",
  "bg-rose-500",
  "bg-amber-500",
  "bg-violet-600",
  "bg-cyan-600",
  "bg-orange-500",
  "bg-teal-600",
] as const;

/** 稳定 hash（djb2），同一插件每次渲染得到同一颜色。 */
function avatarColorIndex(seed: string): number {
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(index)) >>> 0;
  }
  return hash % AVATAR_COLORS.length;
}

/** 首字母 avatar：取插件名第一个字符（字母/数字大写，CJK 原样）。 */
function LetterAvatar({ name, seed }: { name: string; seed: string }) {
  const first = name.trim().charAt(0).toUpperCase() || "?";
  const color = AVATAR_COLORS[avatarColorIndex(seed)];
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-full select-none items-center justify-center rounded-xl",
        color,
      )}
    >
      <span className="text-ui-base font-semibold text-white">{first}</span>
    </span>
  );
}

// cn 从同一路径导入，保持项目惯例。
import { cn } from "@/components/lib/utils.js";

export function PluginStoreAvatar({
  item,
  className,
  iconClassName,
  fallbackIcon,
}: {
  item: Pick<StorePluginItem, "name" | "listing"> & Partial<Pick<StorePluginItem, "id">>;
  className?: string;
  iconClassName?: string;
  fallbackIcon?: ReactNode;
}) {
  // 没有真实 icon URL 时用首字母头像替代灰色占位符。
  const hasIcon = Boolean(item.listing?.icon);
  return (
    <PluginIcon
      src={item.listing?.icon}
      pluginId={item.id}
      className={className}
      iconClassName={iconClassName}
      fallbackIcon={
        fallbackIcon ?? (
          <LetterAvatar name={item.name} seed={item.id ?? item.name} />
        )
      }
    />
  );
}
