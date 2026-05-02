import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, description, children, className }: DialogProps) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50 animate-in fade-in" onClick={onClose} />
      <div
        className={cn(
          'relative z-50 w-full max-w-lg rounded-lg bg-white shadow-xl',
          'max-h-[90vh] overflow-y-auto',
          className
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between border-b p-5">
            <div>
              {title && <h2 className="text-lg font-semibold text-slate-800">{title}</h2>}
              {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
            </div>
            <button
              onClick={onClose}
              className="ml-4 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
