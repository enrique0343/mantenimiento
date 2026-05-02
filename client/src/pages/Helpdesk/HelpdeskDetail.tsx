import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ChevronLeft, User, MapPin, Tag, Clock, CheckCircle2,
  MessageSquare, UserCheck, Wrench, AlertTriangle, Send, Lock,
} from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import type { HelpdeskTicket, AuthUser } from '@/types';
import {
  TICKET_STATUS_LABEL, TICKET_STATUS_COLOR, PRIORITY_LABEL, PRIORITY_COLOR,
  WO_STATUS_LABEL, formatDate, formatDateTime, cn,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';

const REQUEST_TYPE_LABEL: Record<string, string> = {
  EQUIPMENT_FAILURE: 'Falla de equipo',
  MAINTENANCE_REQUEST: 'Solicitud de mantenimiento',
  OTHER: 'Otro',
};

const NEXT_STATUSES: Record<string, { value: string; label: string }[]> = {
  OPEN: [{ value: 'IN_PROGRESS', label: 'Poner en progreso' }, { value: 'CLOSED', label: 'Cerrar' }],
  IN_PROGRESS: [{ value: 'ESCALATED', label: 'Escalar' }, { value: 'RESOLVED', label: 'Marcar resuelto' }, { value: 'CLOSED', label: 'Cerrar' }],
  ESCALATED: [{ value: 'IN_PROGRESS', label: 'Volver a progreso' }, { value: 'RESOLVED', label: 'Marcar resuelto' }, { value: 'CLOSED', label: 'Cerrar' }],
  RESOLVED: [{ value: 'CLOSED', label: 'Cerrar caso' }],
  CLOSED: [],
};

function SlaBar({ deadline, status }: { deadline?: string; status: string }) {
  if (!deadline || status === 'RESOLVED' || status === 'CLOSED') return null;
  const total = 24 * 60 * 60 * 1000;
  const msLeft = new Date(deadline).getTime() - Date.now();
  const pct = Math.max(0, Math.min(100, (msLeft / total) * 100));
  const expired = msLeft < 0;
  const urgent = !expired && msLeft < 4 * 60 * 60 * 1000;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-500">SLA — vence {formatDateTime(deadline)}</span>
        {expired
          ? <span className="font-medium text-red-600 flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> Vencido</span>
          : urgent
          ? <span className="font-medium text-amber-600">⚠ {Math.round(msLeft / 3600000)}h restantes</span>
          : <span className="text-slate-400">{Math.round(msLeft / 3600000)}h restantes</span>
        }
      </div>
      <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', expired ? 'bg-red-500 w-full' : urgent ? 'bg-amber-400' : 'bg-green-500')}
          style={{ width: expired ? '100%' : `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function HelpdeskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<HelpdeskTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [technicians, setTechnicians] = useState<AuthUser[]>([]);

  // Comment form
  const [comment, setComment] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);

  // Status change
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [updatingStatus, setUpdatingStatus] = useState(false);

  // Assign dialog
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignUserId, setAssignUserId] = useState('');
  const [assigning, setAssigning] = useState(false);

  // Convert to WO dialog
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [convertTechId, setConvertTechId] = useState('');
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    load();
    api.get('/users').then(({ data }) =>
      setTechnicians(data.filter((u: AuthUser) => ['TECHNICIAN', 'MAINTENANCE_CHIEF'].includes(u.role)))
    ).catch(() => {});
  }, [id]);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/helpdesk/tickets/${id}`);
      setTicket(data);
    } catch {
      toast.error('No se pudo cargar el ticket');
    } finally {
      setLoading(false);
    }
  }

  async function submitComment() {
    if (!comment.trim()) return;
    setSendingComment(true);
    try {
      await api.post(`/helpdesk/tickets/${id}/comments`, { content: comment.trim(), isInternal });
      setComment('');
      await load();
      toast.success('Comentario agregado');
    } catch {
      toast.error('Error al agregar comentario');
    } finally {
      setSendingComment(false);
    }
  }

  async function submitStatusChange() {
    if (!newStatus) return;
    setUpdatingStatus(true);
    try {
      await api.patch(`/helpdesk/tickets/${id}/status`, { status: newStatus, resolutionNotes: resolutionNotes || undefined });
      setShowStatusDialog(false);
      setResolutionNotes('');
      await load();
      toast.success('Estado actualizado');
    } catch {
      toast.error('Error al actualizar estado');
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function submitAssign() {
    if (!assignUserId) return;
    setAssigning(true);
    try {
      await api.post(`/helpdesk/tickets/${id}/assign`, { userId: assignUserId });
      setShowAssignDialog(false);
      setAssignUserId('');
      await load();
      toast.success('Ticket asignado');
    } catch {
      toast.error('Error al asignar ticket');
    } finally {
      setAssigning(false);
    }
  }

  async function submitConvert() {
    setConverting(true);
    try {
      const { data: wo } = await api.post(`/helpdesk/tickets/${id}/convert`, {
        technicianId: convertTechId || undefined,
      });
      setShowConvertDialog(false);
      await load();
      toast.success(`OT ${wo.code} creada correctamente`);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al crear la OT');
    } finally {
      setConverting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-20 text-slate-400">
        <p>Ticket no encontrado</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/helpdesk')}>Volver</Button>
      </div>
    );
  }

  const relatedWO = (ticket as any).workOrders?.[0];
  const nextStatuses = NEXT_STATUSES[ticket.status] ?? [];

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/helpdesk')}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-800 font-mono">{ticket.code}</h1>
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', TICKET_STATUS_COLOR[ticket.status])}>
              {TICKET_STATUS_LABEL[ticket.status]}
            </span>
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', PRIORITY_COLOR[ticket.priority])}>
              {PRIORITY_LABEL[ticket.priority]}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">{REQUEST_TYPE_LABEL[ticket.requestType]}</p>
        </div>
        {/* Action buttons */}
        <div className="flex gap-2 shrink-0">
          {!ticket.assignedToId && (
            <Button size="sm" variant="outline" onClick={() => setShowAssignDialog(true)}>
              <UserCheck className="h-4 w-4" />
              Asignar
            </Button>
          )}
          {ticket.equipmentId && !relatedWO && ticket.status !== 'CLOSED' && ticket.status !== 'RESOLVED' && (
            <Button size="sm" variant="outline" onClick={() => setShowConvertDialog(true)}>
              <Wrench className="h-4 w-4" />
              Crear OT
            </Button>
          )}
          {nextStatuses.length > 0 && (
            <Button size="sm" onClick={() => {
              setNewStatus(nextStatuses[0].value);
              setShowStatusDialog(true);
            }}>
              {nextStatuses[0].label}
            </Button>
          )}
        </div>
      </div>

      {/* SLA bar */}
      {ticket.slaDeadline && (
        <Card>
          <CardContent className="pt-4 pb-3">
            <SlaBar deadline={ticket.slaDeadline} status={ticket.status} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Description */}
          <Card>
            <CardHeader><CardTitle className="text-base">Descripción</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-slate-700 whitespace-pre-line">{ticket.description}</p>
              {ticket.resolutionNotes && (
                <div className="mt-4 rounded-md bg-green-50 border border-green-200 px-3 py-2">
                  <p className="text-xs font-semibold text-green-700 mb-1 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Nota de resolución
                  </p>
                  <p className="text-sm text-green-800">{ticket.resolutionNotes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Related WO */}
          {relatedWO && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="pt-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-blue-500 font-medium">Orden de trabajo asociada</p>
                    <p className="font-mono font-bold text-blue-800">{relatedWO.code}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-blue-600">{WO_STATUS_LABEL[relatedWO.status]}</span>
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/mantenimiento/${relatedWO.id}`}>Ver OT</Link>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Comments */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><MessageSquare className="h-4 w-4" />Historial</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {(!ticket.comments || ticket.comments.length === 0) && (
                <p className="text-sm text-slate-400 text-center py-4">Sin comentarios aún</p>
              )}
              {ticket.comments?.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    'rounded-lg px-3 py-2.5 text-sm',
                    c.isInternal ? 'bg-amber-50 border border-amber-200' : 'bg-slate-50 border'
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-slate-700 text-xs">{c.authorName}</span>
                    {c.isInternal && (
                      <span className="flex items-center gap-0.5 text-xs text-amber-600 font-medium">
                        <Lock className="h-3 w-3" /> Nota interna
                      </span>
                    )}
                    <span className="ml-auto text-xs text-slate-400">{formatDateTime(c.createdAt)}</span>
                  </div>
                  <p className="text-slate-700 whitespace-pre-line">{c.content}</p>
                </div>
              ))}

              {/* Add comment */}
              {ticket.status !== 'CLOSED' && (
                <div className="space-y-2 pt-2 border-t">
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Agregar comentario..."
                    rows={3}
                  />
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isInternal}
                        onChange={(e) => setIsInternal(e.target.checked)}
                        className="rounded"
                      />
                      <Lock className="h-3 w-3" />
                      Nota interna (no visible al solicitante)
                    </label>
                    <Button
                      size="sm"
                      onClick={submitComment}
                      disabled={!comment.trim() || sendingComment}
                      loading={sendingComment}
                    >
                      <Send className="h-3.5 w-3.5" />
                      Enviar
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Requester info */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><User className="h-4 w-4" />Solicitante</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-semibold text-slate-800">{ticket.requesterName}</p>
              <p className="text-slate-500">{ticket.requesterEmail}</p>
              {ticket.requesterPhone && <p className="text-slate-500">{ticket.requesterPhone}</p>}
            </CardContent>
          </Card>

          {/* Location */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><MapPin className="h-4 w-4" />Ubicación</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <p className="font-medium text-slate-800">{(ticket as any).branch?.name ?? '—'}</p>
              <p className="text-slate-500">{ticket.area}</p>
              {ticket.equipment && (
                <div className="mt-2 pt-2 border-t">
                  <p className="text-xs text-slate-400 mb-0.5">Equipo</p>
                  <p className="font-medium text-slate-700">{ticket.equipment.name}</p>
                  <p className="font-mono text-xs text-slate-400">{ticket.equipment.code}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Assignment */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span className="flex items-center gap-2"><UserCheck className="h-4 w-4" />Asignación</span>
                {ticket.assignedToId && ticket.status !== 'CLOSED' && (
                  <button onClick={() => setShowAssignDialog(true)} className="text-xs text-blue-600 hover:underline">Cambiar</button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {ticket.assignedTo
                ? <p className="font-medium text-slate-800">{ticket.assignedTo.name}</p>
                : <p className="text-slate-400">Sin asignar</p>
              }
            </CardContent>
          </Card>

          {/* Dates */}
          <Card>
            <CardHeader><CardTitle className="text-base flex items-center gap-2"><Clock className="h-4 w-4" />Fechas</CardTitle></CardHeader>
            <CardContent className="text-xs space-y-2 text-slate-600">
              <div className="flex justify-between">
                <span className="text-slate-400">Creado</span>
                <span>{formatDate(ticket.createdAt)}</span>
              </div>
              {ticket.resolvedAt && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Resuelto</span>
                  <span className="text-green-700">{formatDate(ticket.resolvedAt)}</span>
                </div>
              )}
              {ticket.closedAt && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Cerrado</span>
                  <span>{formatDate(ticket.closedAt)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Status actions */}
          {nextStatuses.length > 1 && (
            <Card>
              <CardHeader><CardTitle className="text-base flex items-center gap-2"><Tag className="h-4 w-4" />Cambiar estado</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {nextStatuses.map((s) => (
                  <Button
                    key={s.value}
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => { setNewStatus(s.value); setShowStatusDialog(true); }}
                  >
                    {s.label}
                  </Button>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Status change dialog */}
      <Dialog
        open={showStatusDialog}
        onClose={() => setShowStatusDialog(false)}
        title={`Cambiar estado`}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nuevo estado</Label>
            <Select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
              options={(NEXT_STATUSES[ticket.status] ?? []).map((s) => ({ value: s.value, label: s.label }))}
            />
          </div>
          {(newStatus === 'RESOLVED' || newStatus === 'CLOSED') && (
            <div className="space-y-1.5">
              <Label>Nota de resolución</Label>
              <Textarea
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                placeholder="Describa cómo se resolvió el caso..."
                rows={3}
              />
            </div>
          )}
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowStatusDialog(false)}>Cancelar</Button>
            <Button onClick={submitStatusChange} loading={updatingStatus} disabled={!newStatus}>
              Confirmar
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Assign dialog */}
      <Dialog
        open={showAssignDialog}
        onClose={() => setShowAssignDialog(false)}
        title="Asignar ticket"
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Técnico responsable</Label>
            <Select
              value={assignUserId}
              onChange={(e) => setAssignUserId(e.target.value)}
              placeholder="Seleccione un técnico..."
              options={technicians.map((u) => ({ value: u.id, label: u.name }))}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancelar</Button>
            <Button onClick={submitAssign} loading={assigning} disabled={!assignUserId}>
              Asignar
            </Button>
          </div>
        </div>
      </Dialog>

      {/* Convert to WO dialog */}
      <Dialog
        open={showConvertDialog}
        onClose={() => setShowConvertDialog(false)}
        title="Crear orden de trabajo correctiva"
        description={`Se creará una OT correctiva vinculada al ticket ${ticket.code} para el equipo ${ticket.equipment?.name ?? ''}.`}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Técnico asignado (opcional)</Label>
            <Select
              value={convertTechId}
              onChange={(e) => setConvertTechId(e.target.value)}
              placeholder="Sin asignar"
              options={technicians.map((u) => ({ value: u.id, label: u.name }))}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setShowConvertDialog(false)}>Cancelar</Button>
            <Button onClick={submitConvert} loading={converting}>
              <Wrench className="h-4 w-4" />
              Crear OT
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
