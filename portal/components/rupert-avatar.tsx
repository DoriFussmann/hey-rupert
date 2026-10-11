import Image from "next/image";

export function RupertAvatar({
  size = 40,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Image
      src="/rupert.png"
      alt="Rupert"
      width={size}
      height={size}
      className={`shrink-0 rounded-full border border-border object-cover ${className}`}
    />
  );
}
