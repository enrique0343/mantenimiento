import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { HeadphonesIcon, Clock, CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import type { HelpdeskTicket } from '@/types';
import { TICKET_STATUS_LABEL, TICKET_STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR, formatDateTime, cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const REQUEST_TYPE_LABEL: Record<string, string> = {
  EQUIPMENT_FAILURE: 'Falla de equipo',
  MAINTENANCE_REQUEST: 'Solicitud de mantenimiento',
  OTHER: 'Otro',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  OPEN: <Clock className="h-4 w-4" />,
  IN_PROGRESS: <Loader2 className="h-4 w-4 animate-spin" />,
  ESCALATED: <AlertTriangle className="h-4 w-4" />,
  RESOLVED: <CheckCircle2 className="h-4 w-4" />,
  CLOSED: <XCircle className="h-4 w-4" />,
};

export default function HelpdeskPublicTrack() {
  const { token } = useParams<{ token: string }>();
  const [ticket, setTicket] = useState<HelpdeskTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.get(`/helpdesk/track/${token}`)
      .then(({ data }) => setTicket(data))
      .catch((err) => {
        if (err.response?.status === 404) setNotFound(true);
      })
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="min-h-screen bg-slate-100 flex items-start justify-center p-4 py-8">
      <div className="w-full max-w-lg space-y-5">
        {/* Header */}
        <div className="text-center">
          <div className="rounded-full bg-blue-100 p-3 inline-flex mb-3">
            <HeadphonesIcon className="h-8 w-8 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Estado de su Solicitud</h1>
        </div>

        {loading && (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">Cargando información...</p>
            </CardContent>
          </Card>
        )}

        {notFound && (
          <Card>
            <CardContent className="py-12 text-center">
              <XCircle className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="font-medium text-slate-600">Ticket no encontrado</p>
              <p className="text-slate-400 text-sm mt-1">Verifique el enlace de seguimiento en su correo.</p>
            </CardContent>
          </Card>
        )}

        {ticket && (
          <>
            {/* Estado principal */}
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs text-slate-400 font-mono mb-1">{ticket.code}</p>
                    <h2 className="font-semibold text-slate-800 text-lg">{REQUEST_TYPE_LABEL[ticket.requestType]}</h2>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {(ticket as any).branch?.name} · {ticket.area}
                    </p>
                  </div>
                  <span className={cn('rounded-full px-3 py-1 text-sm font-medium flex items-center gap-1.5', TICKET_STATUS_COLOR[ticket.status])}>
                    {STATUS_ICON[ticket.status]}
                    {TICKET_STATUS_LABEL[ticket.status]}
                  </span>
                </div>

                <div className="mt-4 pt-4 border-t grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-400">Prioridad</p>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium inline-block mt-0.5', PRIORITY_COLOR[ticket.priority])}>
                      {PRIORITY_LABEL[ticket.priority]}
                    </span>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Creado</p>
                    <p className="font-medium text-slate-700">{formatDateTime(ticket.createdAt)}</p>
                  </div>
                  {ticket.slaDeadline && (
                    <div>
                      <p className="text-xs text-slate-400">Tiempo límite de atención</p>
                      <p className="font-medium text-slate-700">{formatDateTime(ticket.slaDeadline)}</p>
                    </div>
                  )}
                  {ticket.resolvedAt && (
                    <div>
                      <p className="text-xs text-slate-400">Resuelto</p>
                      <p className="font-medium text-green-700">{formatDateTime(ticket.resolvedAt)}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Descripción */}
            <Card>
              <CardHeader><CardTitle className="text-base">Descripción</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm text-slate-600 whitespace-pre-line">{ticket.description}</p>
                {ticket.equipment && (
                  <div className="mt-3 rounded-md bg-slate-50 border px-3 py-2 text-xs text-slate-500">
                    Equipo: <span className="font-medium text-slate-700">{ticket.equipment.name}</span>
                    <span className="ml-2 font-mono">{ticket.equipment.code}</span>
                  </div>
                )}
                {ticket.resolutionNotes && (
                  <div className="mt-3 rounded-md bg-green-50 border border-green-200 px-3 py-2">
                    <p className="text-xs font-medium text-green-700 mb-1">Resolución</p>
                    <p className="text-sm text-green-800">{ticket.resolutionNotes}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Timeline de comentarios */}
            {ticket.comments && ticket.comments.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-base">Historial de actualizaciones</CardTitle></CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {ticket.comments.map((c) => (
                      <div key={c.id} className="flex gap-3">
                        <div className="mt-1 h-2 w-2 rounded-full bg-blue-400 shrink-0" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 text-xs text-slate-400 mb-0.5">
                            <span className="font-medium text-slate-600">{c.authorName}</span>
                            <span>·</span>
                            <span>{formatDateTime(c.createdAt)}</span>
                          </div>
                          <p className="text-sm text-slate-700">{c.content}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <p className="text-center text-xs text-slate-400 pb-4">
              ¿Necesita más ayuda? Contacte a su área de mantenimiento con el número de ticket{' '}
              <span className="font-mono font-bold">{ticket.code}</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
