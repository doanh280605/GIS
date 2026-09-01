import { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Button({ className, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("inline-flex min-h-10 cursor-pointer items-center justify-center rounded-sm bg-[#1a211b] px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:bg-[#2a332b] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#d5a928]/20 disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />;
}
