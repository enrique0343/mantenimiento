import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import { QrCode, X, Camera } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

export default function QrScannerButton() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const containerId = 'qr-scanner-container';

  useEffect(() => {
    if (!open) return;
    setError('');
    const scanner = new Html5Qrcode(containerId);
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decodedText) => {
          handleResult(decodedText, scanner);
        },
        () => {}
      )
      .then(() => setScanning(true))
      .catch(() => {
        setError('No se pudo acceder a la cámara. Verifique los permisos.');
        setScanning(false);
      });

    return () => {
      scanner.isScanning && scanner.stop().catch(() => {});
    };
  }, [open]);

  function handleResult(text: string, scanner: Html5Qrcode) {
    scanner.stop().catch(() => {});
    setOpen(false);
    setScanning(false);

    // Try to extract equipment code from URL like /equipo/:code/acceso
    const match = text.match(/\/equipo\/([^/]+)\/acceso/);
    if (match) {
      navigate(`/equipo/${match[1]}/acceso`);
      return;
    }
    // If it's a full URL, try to navigate to the path
    try {
      const url = new URL(text);
      navigate(url.pathname + url.search);
    } catch {
      toast.error('QR no reconocido. Código: ' + text.slice(0, 40));
    }
  }

  function handleClose() {
    if (scannerRef.current?.isScanning) {
      scannerRef.current.stop().catch(() => {});
    }
    setOpen(false);
    setScanning(false);
    setError('');
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setOpen(true)}
        title="Escanear código QR"
      >
        <QrCode className="h-5 w-5 text-slate-500" />
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 flex flex-col items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-sm overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-slate-800">Escanear equipo</h2>
              </div>
              <button
                onClick={handleClose}
                className="rounded-md p-1 hover:bg-slate-100 text-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scanner area */}
            <div className="relative bg-black" style={{ minHeight: 280 }}>
              <div id={containerId} className="w-full" />
              {!scanning && !error && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="h-6 w-6 animate-spin rounded-full border-2 border-white border-t-transparent" />
                </div>
              )}
              {scanning && (
                <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  <div className="border-2 border-white rounded-lg opacity-60" style={{ width: 240, height: 240 }} />
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-3 text-center">
              {error ? (
                <p className="text-sm text-red-600">{error}</p>
              ) : (
                <p className="text-xs text-slate-500">
                  {scanning ? 'Apunte la cámara al código QR del equipo' : 'Iniciando cámara...'}
                </p>
              )}
              <Button variant="outline" size="sm" className="mt-2 w-full" onClick={handleClose}>
                Cancelar
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
