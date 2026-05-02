import { HeadphonesIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export default function HelpdeskPublicForm() {
  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">
        <div className="text-center">
          <HeadphonesIcon className="h-10 w-10 mx-auto text-blue-600 mb-2" />
          <h1 className="text-xl font-bold text-slate-800">Mesa de Ayuda</h1>
          <p className="text-sm text-slate-500">Reporte un problema o solicite mantenimiento</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Nueva Solicitud</CardTitle>
            <CardDescription>Formulario público — Fase 4</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="py-8 text-center text-slate-400 text-sm">
              Formulario completo se implementa en Fase 4
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
