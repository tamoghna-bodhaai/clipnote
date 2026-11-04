import * as React from "react";
import { cn } from "./utils";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: "default" | "outline" | "ghost"; size?: "default" | "sm" }
export function Button({ className, variant = "default", size = "default", ...props }: ButtonProps) {
  return <button className={cn("inline-flex items-center justify-center rounded-xl font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2367eb] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50", variant === "default" && "bg-[#10131c] text-white shadow-[0_2px_0_rgba(0,0,0,.18)] hover:bg-[#252a36]", variant === "outline" && "border border-[#e5e7eb] bg-white text-[#383d49] hover:border-[#cfd4dc] hover:bg-[#fafafa]", variant === "ghost" && "text-[#5f6571] hover:bg-[#f1f3f6]", size === "default" && "h-11 px-4 text-sm", size === "sm" && "h-9 px-3 text-xs", className)} {...props} />;
}
