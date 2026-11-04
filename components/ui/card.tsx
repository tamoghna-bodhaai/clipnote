import * as React from "react";
import { cn } from "./utils";
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("rounded-[22px] border border-[#e7e8eb] bg-white shadow-[0_1px_0_rgba(16,19,28,.03)]", className)} {...props} />; }
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn("p-6", className)} {...props} />; }
