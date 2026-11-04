"use client";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "./utils";
export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;
export function TabsList({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) { return <TabsPrimitive.List className={cn("inline-flex rounded-xl bg-[#f1f2f4] p-1", className)} {...props} />; }
export function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) { return <TabsPrimitive.Trigger className={cn("rounded-lg px-4 py-2 text-sm font-medium text-[#747986] transition-colors data-[state=active]:bg-[#10131c] data-[state=active]:text-white data-[state=active]:shadow-sm", className)} {...props} />; }
