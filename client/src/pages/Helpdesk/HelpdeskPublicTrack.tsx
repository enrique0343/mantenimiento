import { useParams } from 'react-router-dom';
import { HeadphonesIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function HelpdeskPublicTrack() {
  const { token } = useParams();

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg space-y-4">
        <div className="text-center">
          <HeadphonesIcon className="h-10 w-10 mx-auto text-blue-600 mb-2" />
          <h1 className="text-xl font-bold text-slate-800">Estado de su Solicitud</h1>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Seguimiento de ticket</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-500 text-center py-6">
              Token: <code className="bg-slate-100 px-1 rounded text-xs">{token}</code>
              <br /><br />
              Vista de seguimiento público — Fase 4
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
