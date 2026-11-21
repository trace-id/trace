'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { X } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/* ---------- Dialog ---------- */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ title, description, children, className }: { title: string; description?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] [animation:fade-in_.15s_ease-out]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-6 shadow-pop [animation:pop-in_.18s_ease-out]',
          className,
        )}
      >
        <DialogPrimitive.Title className="text-base font-semibold tracking-tight text-ink">{title}</DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="mt-1.5 text-[13px] text-ink-3">{description}</DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
        )}
        <div className="mt-4">{children}</div>
        <DialogPrimitive.Close aria-label="Close" className="absolute right-4 top-4 grid size-7 cursor-pointer place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink">
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** Side panel for record detail. */
export function Sheet({ open, onOpenChange, title, children, width = 'max-w-xl' }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; width?: string }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 [animation:fade-in_.15s_ease-out]" />
        <DialogPrimitive.Content
          className={cn('fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-line bg-surface shadow-pop [animation:slide-in_.2s_ease-out]', width)}
        >
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          <DialogPrimitive.Close aria-label="Close" className="absolute right-4 top-4 z-10 grid size-8 cursor-pointer place-items-center rounded-lg text-ink-3 hover:bg-surface-3 hover:text-ink">
            <X className="size-4" />
          </DialogPrimitive.Close>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/* ---------- Tabs ---------- */

export const Tabs = TabsPrimitive.Root;
export const TabsContent = ({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content className={cn('mt-5 focus-visible:outline-none [animation:fade-in_.15s_ease-out]', className)} {...props} />
);
/**
 * Tabs are a contained segmented control: a tinted track with the active tab lifted onto a white card. They scroll
 * sideways on a narrow screen instead of wrapping. Put an icon and a TabCount inside a trigger for the usual look.
 */
export const TabsList = ({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn('scrollbar-none inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[14px] border border-line bg-surface-2 p-1', className)}
    {...props}
  />
);
export const TabsTrigger = ({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    className={cn(
      'group inline-flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-[10px] px-3.5 py-1.5 text-[13px] font-medium text-ink-3 transition-[background-color,color,box-shadow] duration-150',
      'hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal',
      'data-[state=active]:bg-surface data-[state=active]:text-ink data-[state=active]:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_1px_var(--line)]',
      '[&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:opacity-70 data-[state=active]:[&>svg]:text-signal data-[state=active]:[&>svg]:opacity-100',
      className,
    )}
    {...props}
  />
);

/** A small count chip for the end of a tab label. */
export function TabCount({ children, tone }: { children: ReactNode; tone?: 'bad' | 'warn' }) {
  return (
    <span
      className={cn(
        'tnum rounded-full px-1.5 py-px text-[11px] font-semibold leading-4 transition-colors',
        tone === 'bad' ? 'bg-bad-soft text-bad' : tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-surface-3 text-ink-2 group-data-[state=active]:bg-signal-soft group-data-[state=active]:text-signal-ink',
      )}
    >
      {children}
    </span>
  );
}

/* ---------- Tooltip ---------- */

export function Tip({ label, children, side = 'top' }: { label: ReactNode; children: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className="z-[60] max-w-xs rounded-lg bg-ink px-2.5 py-1.5 text-xs text-bg shadow-pop [animation:pop-in_.12s_ease-out]"
          >
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/* ---------- Dropdown ---------- */

export const Dropdown = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;

export function DropdownContent({ className, align = 'end', ...props }: ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn('z-50 min-w-48 rounded-xl border border-line bg-surface p-1 shadow-pop [animation:pop-in_.14s_ease-out]', className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  );
}

export function DropdownItem({ className, danger, ...props }: ComponentProps<typeof DropdownPrimitive.Item> & { danger?: boolean }) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] outline-none data-[highlighted]:bg-surface-3',
        danger ? 'text-bad' : 'text-ink',
        className,
      )}
      {...props}
    />
  );
}

export const DropdownLabel = ({ className, ...props }: ComponentProps<typeof DropdownPrimitive.Label>) => (
  <DropdownPrimitive.Label className={cn('px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-3', className)} {...props} />
);
export const DropdownSeparator = ({ className, ...props }: ComponentProps<typeof DropdownPrimitive.Separator>) => (
  <DropdownPrimitive.Separator className={cn('my-1 h-px bg-line', className)} {...props} />
);
