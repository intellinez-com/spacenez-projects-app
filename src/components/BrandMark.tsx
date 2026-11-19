import { cn } from "@/lib/utils";

const ASSETS = {
  full: "/branding/spacenez-logo.png",
  "full-light": "/branding/spacenez-logo-light.png",
  mark: "/branding/spacenez-mark.png",
  "mark-light": "/branding/spacenez-mark-light.png",
} as const;

const SIZES = {
  full: { width: 1446, height: 395 },
  "full-light": { width: 1446, height: 395 },
  mark: { width: 353, height: 395 },
  "mark-light": { width: 353, height: 395 },
} as const;

export function BrandMark({
  variant = "full",
  className,
  alt = "Spacenez — Interior Design & Space Visualisation",
}: {
  variant?: keyof typeof ASSETS;
  className?: string;
  alt?: string;
}) {
  const { width, height } = SIZES[variant];
  return (
    <img
      src={ASSETS[variant]}
      alt={alt}
      width={width}
      height={height}
      draggable={false}
      className={cn("h-auto w-auto select-none object-contain", className)}
    />
  );
}
