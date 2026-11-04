import * as React from "react";
import { cn } from "./utils";
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(({ className, ...props }, ref) => <textarea ref={ref} className={cn("flex min-h-20 w-full rounded-xl border border-[#dde0e5] bg-white px-3 py-2 text-sm text-[#171a22] outline-none placeholder:text-[#9a9faa] focus:border-[#2367eb] focus:ring-2 focus:ring-[#2367eb]/15", className)} {...props} />);
Textarea.displayName = "Textarea";
