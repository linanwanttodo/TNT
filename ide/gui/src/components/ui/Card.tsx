import { cn } from "../../util/cn";

interface CardProps extends React.ComponentProps<"div"> {
  children: React.ReactNode;
}

export function Card({ children, className = "", ...props }: CardProps) {
  return (
    <div
      {...props}
      className={cn(
        "bg-editor rounded-default border-border border px-4 py-3.5",
        className,
      )}
    >
      {children}
    </div>
  );
}
