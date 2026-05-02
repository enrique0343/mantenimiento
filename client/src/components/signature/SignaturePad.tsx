import { useRef, useEffect, useState } from 'react';
import SignaturePadLib from 'signature_pad';
import { Eraser, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  onSave: (dataUrl: string) => void;
  savedUrl?: string;
  label?: string;
  sublabel?: string;
  disabled?: boolean;
}

export default function SignaturePad({ onSave, savedUrl, label, sublabel, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const [empty, setEmpty] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || disabled) return;

    const canvas = canvasRef.current;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    canvas.getContext('2d')?.scale(ratio, ratio);

    padRef.current = new SignaturePadLib(canvas, {
      backgroundColor: 'rgb(255,255,255)',
      penColor: 'rgb(15,23,42)',
      minWidth: 1,
      maxWidth: 3,
    });

    padRef.current.addEventListener('endStroke', () => {
      setEmpty(padRef.current?.isEmpty() ?? true);
    });

    return () => padRef.current?.off();
  }, [disabled]);

  function handleClear() {
    padRef.current?.clear();
    setEmpty(true);
  }

  async function handleSave() {
    if (!padRef.current || padRef.current.isEmpty()) return;
    setSaving(true);
    try {
      const dataUrl = padRef.current.toDataURL('image/png');
      await onSave(dataUrl);
    } finally {
      setSaving(false);
    }
  }

  if (savedUrl) {
    return (
      <div className="space-y-2">
        {label && <p className="text-sm font-medium text-slate-700">{label}</p>}
        <div className="rounded-lg border bg-white p-3 space-y-2">
          <div className="flex items-center gap-2 text-green-600 text-sm font-medium">
            <Check className="h-4 w-4" />
            Firma guardada
          </div>
          <img
            src={savedUrl}
            alt="Firma"
            className="max-h-24 rounded border border-slate-200 bg-white"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {label && (
        <div>
          <p className="text-sm font-medium text-slate-700">{label}</p>
          {sublabel && <p className="text-xs text-slate-500">{sublabel}</p>}
        </div>
      )}
      <div
        className={cn(
          'rounded-lg border-2 border-dashed bg-white overflow-hidden',
          disabled ? 'opacity-50 pointer-events-none' : 'border-slate-300 hover:border-blue-400'
        )}
      >
        <canvas
          ref={canvasRef}
          className="w-full touch-none cursor-crosshair"
          style={{ height: 160 }}
        />
      </div>
      <p className="text-xs text-slate-400 text-center">
        {disabled ? 'Bloqueada' : 'Firme en el área de arriba'}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClear}
          disabled={disabled || empty}
          className="flex-1"
        >
          <Eraser className="h-3.5 w-3.5" />
          Limpiar
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={disabled || empty || saving}
          loading={saving}
          className="flex-1"
        >
          <Check className="h-3.5 w-3.5" />
          Guardar firma
        </Button>
      </div>
    </div>
  );
}
