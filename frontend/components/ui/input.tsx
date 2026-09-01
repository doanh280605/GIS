import { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("h-11 w-full rounded-sm border border-[#cfcec5] bg-white px-3.5 text-sm text-[#171814] outline-none transition placeholder:text-[#92958e] hover:border-[#aaa99f] focus:border-[#9a7717] focus:ring-4 focus:ring-[#d5a928]/10", className)} {...props} />;
}
