import { useRef } from 'react';
import { ImagePlus, X, ZoomIn } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  images: string[];
  maxImages?: number;
  onUpload: (file: File) => Promise<void>;
  onRemove?: (url: string) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  uploading?: boolean;
}

export default function ImageUploadGrid({
  images,
  maxImages = 2,
  onUpload,
  onRemove,
  label,
  required,
  disabled,
  uploading,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await onUpload(file);
  }

  const canAdd = images.length < maxImages && !disabled;

  return (
    <div className="space-y-2">
      {label && (
        <p className="text-sm font-medium text-slate-700">
          {label}{' '}
          {required && (
            <span className="text-xs text-slate-400">
              ({images.length}/{maxImages} requeridas)
            </span>
          )}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        {/* Imágenes existentes */}
        {images.map((url, i) => (
          <div
            key={url}
            className="relative aspect-square rounded-lg overflow-hidden border bg-slate-100 group"
          >
            <img src={url} alt={`Imagen ${i + 1}`} className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="rounded-full bg-white p-1.5 text-slate-700 hover:bg-slate-100"
              >
                <ZoomIn className="h-4 w-4" />
              </a>
              {onRemove && !disabled && (
                <button
                  onClick={() => onRemove(url)}
                  className="rounded-full bg-white p-1.5 text-red-500 hover:bg-red-50"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}

        {/* Slots vacíos */}
        {Array.from({ length: Math.max(0, maxImages - images.length) }).map((_, i) => (
          <button
            key={`empty-${i}`}
            type="button"
            onClick={() => canAdd && inputRef.current?.click()}
            disabled={!canAdd || uploading}
            className={cn(
              'aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1',
              'text-slate-400 transition-colors',
              canAdd && !uploading
                ? 'hover:border-blue-400 hover:text-blue-500 cursor-pointer'
                : 'opacity-50 cursor-not-allowed',
              uploading && i === 0 && 'border-blue-300 bg-blue-50'
            )}
          >
            {uploading && i === 0 ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-blue-400 border-t-transparent" />
            ) : (
              <>
                <ImagePlus className="h-6 w-6" />
                <span className="text-xs">Agregar foto</span>
              </>
            )}
          </button>
        ))}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFile}
      />

      {required && images.length < maxImages && (
        <p className="text-xs text-amber-600">
          Se requieren {maxImages - images.length} imagen(es) más
        </p>
      )}
    </div>
  );
}
