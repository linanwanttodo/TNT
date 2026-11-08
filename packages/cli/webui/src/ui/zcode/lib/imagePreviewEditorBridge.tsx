/*
 * TNT 桥：ZCode image-preview-editor 子系统的最小替身。
 * TNT webui 没有内嵌图片编辑器；预览面退化为静态容器。
 */
export function ImagePreviewSurface(props: Record<string, unknown>) {
  return <div {...props} />;
}
