import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ChevronLeft, Play, CheckCircle2, Circle, AlertTriangle,
  ClipboardList, Image, Pen, Package, X, Plus, FileText, Truck,
} from 'lucide-react';
import api from '@/lib/api';
import type { WorkOrder, SparePart, ChecklistItem } from '@/types';
import {
  WO_STATUS_LABEL, WO_STATUS_COLOR, WO_TYPE_LABEL, PRIORITY_LABEL,
  PRIORITY_COLOR, formatDate, formatDateTime, cn,
} from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Dialog } from '@/components/ui/dialog';
import ImageUploadGrid from '@/components/images/ImageUploadGrid';
import SignaturePad from '@/components/signature/SignaturePad';
import { WorkOrderPDF } from '@/components/pdf/WorkOrderPDF';

const TYPE_COLOR: Record<string, string> = {
  PREVENTIVE: 'bg-green-100 text-green-800',
  CORRECTIVE: 'bg-red-100 text-red-800',
  PREDICTIVE: 'bg-purple-100 text-purple-800',
};

export default function WorkOrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [wo, setWo] = useState<WorkOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');

  // Repuestos
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [spareSearch, setSpareSearch] = useState('');
  const [spareQty, setSpareQty] = useState('1');
  const [selectedPart, setSelectedPart] = useState<SparePart | null>(null);
  const [spareResults, setSpareResults] = useState<SparePart[]>([]);

  // Firma receptor
  const [signerDialog, setSignerDialog] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState('');

  // Proveedor por fuerza mayor
  const [providerDialog, setProviderDialog] = useState(false);
  const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [providerNotes, setProviderNotes] = useState('');

  // Imágenes uploading state
  const [uploadingBefore, setUploadingBefore] = useState(false);
  const [uploadingAfter, setUploadingAfter] = useState(false);

  const fetchWO = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await api.get(`/work-orders/${id}`);
      setWo(data);
    } catch {
      toast.error('Error al cargar la OT');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchWO(); }, [fetchWO]);

  useEffect(() => {
    api.get('/providers').then(({ data }) => setProviders(Array.isArray(data) ? data : data.data ?? [])).catch(() => {});
  }, []);

  // Buscar repuestos
  useEffect(() => {
    if (!spareSearch || spareSearch.length < 2 || selectedPart) { setSpareResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await api.get(`/spare-parts?search=${encodeURIComponent(spareSearch)}&limit=6`);
      setSpareResults(Array.isArray(data) ? data : data.data ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [spareSearch, selectedPart]);

  // ─── Acciones ──────────────────────────────────────────────────────────────

  async function startWO() {
    setActionLoading('start');
    try {
      const { data } = await api.post(`/work-orders/${id}/start`);
      setWo(data);
      toast.success('OT iniciada — ahora puede subir fotos y registrar el trabajo');
    } catch (err: any) { toast.error(err.response?.data?.message ?? 'Error al iniciar la OT'); }
    finally { setActionLoading(''); }
  }

  async function assignProvider() {
    setActionLoading('provider');
    try {
      const { data } = await api.post(`/work-orders/${id}/assign-provider`, {
        providerId: selectedProviderId || null,
        notes: providerNotes || undefined,
      });
      setWo(data);
      setProviderDialog(false);
      toast.success('Proveedor asignado');
    } catch { toast.error('Error al asignar proveedor'); }
    finally { setActionLoading(''); }
  }

  async function closeWO() {
    setActionLoading('close');
    try {
      const { data } = await api.post(`/work-orders/${id}/close`);
      setWo(data);
      toast.success('OT cerrada correctamente');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al cerrar la OT');
    } finally { setActionLoading(''); }
  }

  async function downloadPDF() {
    setActionLoading('pdf');
    try {
      const { data } = await api.get(`/work-orders/${id}/pdf`);
      const { pdf: genPdf } = await import('@react-pdf/renderer');
      const blob = await genPdf(<WorkOrderPDF workOrder={data.workOrder} company={data.company} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${data.workOrder.code}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Error al generar el PDF');
    } finally { setActionLoading(''); }
  }

  async function uploadImage(file: File, type: 'before' | 'after') {
    const setUploading = type === 'before' ? setUploadingBefore : setUploadingAfter;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('type', type);
      const { data } = await api.post(`/work-orders/${id}/images`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setWo((prev) => prev ? { ...prev, beforeImages: data.beforeImages, afterImages: data.afterImages } : prev);
      toast.success('Imagen guardada');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al subir imagen');
    } finally { setUploading(false); }
  }

  async function saveSignature(dataUrl: string, type: 'tech' | 'client') {
    try {
      const body: Record<string, string> = { type, dataUrl };
      if (type === 'client') { body.signerName = signerName; body.signerRole = signerRole; }
      const { data } = await api.post(`/work-orders/${id}/signatures`, body);
      setWo(data);
      if (type === 'client') setSignerDialog(false);
      toast.success('Firma guardada');
    } catch { toast.error('Error al guardar la firma'); }
  }

  async function updateChecklistItem(itemId: string, status: 'OK' | 'FAIL' | 'NA', notes?: string) {
    if (!wo?.checklist) return;
    const updated = (wo.checklist as ChecklistItem[]).map((item) =>
      item.id === itemId ? { ...item, status, notes: notes ?? item.notes } : item
    );
    try {
      await api.patch(`/work-orders/${id}/checklist`, { checklist: updated });
      setWo((prev) => prev ? { ...prev, checklist: updated } : prev);
    } catch { toast.error('Error al actualizar checklist'); }
  }

  async function addSparePart() {
    if (!selectedPart || !spareQty) return;
    setActionLoading('spare');
    try {
      const { data } = await api.post(`/work-orders/${id}/spare-parts`, {
        sparePartId: selectedPart.id,
        quantity: parseInt(spareQty),
      });
      setWo(data);
      setSelectedPart(null);
      setSpareSearch('');
      setSpareQty('1');
      toast.success('Repuesto registrado');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Error al registrar repuesto');
    } finally { setActionLoading(''); }
  }

  async function removeSparePart(sparePartId: string) {
    try {
      const { data } = await api.delete(`/work-orders/${id}/spare-parts/${sparePartId}`);
      setWo(data);
    } catch { toast.error('Error al eliminar repuesto'); }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!wo) return <div className="text-center py-24 text-slate-400">OT no encontrada</div>;

  const checklist = (wo.checklist ?? []) as ChecklistItem[];
  const checkedCount = checklist.filter((i) => i.status).length;
  const isActive = ['OPEN', 'IN_PROGRESS'].includes(wo.status);
  const inProgress = wo.status === 'IN_PROGRESS';
  const isClosed = ['COMPLETED', 'VERIFIED', 'CLOSED'].includes(wo.status);

  const canClose = inProgress
    && wo.beforeImages.length >= 1
    && wo.afterImages.length >= 1
    && !!wo.techSignature
    && !!wo.clientSignature;

  return (
    <div className="space-y-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/mantenimiento')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold font-mono text-slate-800">{wo.code}</h1>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', TYPE_COLOR[wo.type])}>
                {WO_TYPE_LABEL[wo.type]}
              </span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', PRIORITY_COLOR[wo.priority])}>
                {PRIORITY_LABEL[wo.priority]}
              </span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', WO_STATUS_COLOR[wo.status])}>
                {WO_STATUS_LABEL[wo.status]}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {(wo as any).equipment?.name ?? (wo as any).locationDescription ?? 'Trabajo general'}
            </p>
          </div>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          {isActive && (
            <Button size="sm" variant="outline" onClick={() => setProviderDialog(true)}>
              <Truck className="h-4 w-4" />
              {(wo as any).provider ? 'Cambiar proveedor' : 'Asignar proveedor'}
            </Button>
          )}
          {wo.status === 'OPEN' && (
            <Button size="sm" onClick={startWO} loading={actionLoading === 'start'}>
              <Play className="h-4 w-4" />
              Iniciar OT
            </Button>
          )}
          {inProgress && (
            <Button size="sm" onClick={closeWO} disabled={!canClose} loading={actionLoading === 'close'}>
              <CheckCircle2 className="h-4 w-4" />
              Cerrar OT
            </Button>
          )}
          {isClosed && (
            <Button size="sm" variant="outline" onClick={downloadPDF} loading={actionLoading === 'pdf'}>
              <FileText className="h-4 w-4" />
              PDF
            </Button>
          )}
        </div>
      </div>

      {/* Info básica */}
      <Card>
        <CardContent className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-slate-400 text-xs">{(wo as any).equipment ? 'Equipo' : 'Ubicación'}</p>
            <p className="font-medium">{(wo as any).equipment?.name ?? (wo as any).locationDescription ?? '—'}</p>
            {(wo as any).equipment?.code && <p className="text-xs font-mono text-slate-400">{(wo as any).equipment.code}</p>}
          </div>
          <div>
            <p className="text-slate-400 text-xs">Técnico</p>
            <p className="font-medium">{(wo as any).technician?.name ?? (wo as any).provider?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-slate-400 text-xs">Programada</p>
            <p className="font-medium">{formatDate(wo.scheduledDate)}</p>
          </div>
          <div>
            <p className="text-slate-400 text-xs">Inicio real</p>
            <p className="font-medium">{wo.startedAt ? formatDateTime(wo.startedAt) : '—'}</p>
          </div>
        </CardContent>
      </Card>

      {/* INICIAR banner */}
      {wo.status === 'OPEN' && (
        <div className="rounded-lg border-2 border-blue-200 bg-blue-50 p-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-blue-800">Esta OT aún no ha sido iniciada</p>
            <p className="text-sm text-blue-600">Presione <strong>Iniciar OT</strong> para registrar la hora de inicio y habilitar el registro de fotos, checklist y firmas.</p>
          </div>
          <Button onClick={startWO} loading={actionLoading === 'start'}>
            <Play className="h-4 w-4" />
            Iniciar OT
          </Button>
        </div>
      )}

      {/* Proveedor asignado */}
      {(wo as any).provider && (
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Truck className="h-4 w-4 text-orange-500 shrink-0" />
            <div>
              <p className="text-xs text-slate-400">Proveedor externo asignado (fuerza mayor)</p>
              <p className="text-sm font-medium">{(wo as any).provider.name}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {wo.notes && (
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-slate-400 mb-1">Descripción / Falla reportada</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{wo.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* No activo: mostrar resumen */}
      {isClosed && (
        <Card>
          <CardContent className="p-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-slate-400 text-xs">Cierre</p>
              <p className="font-medium">{formatDateTime(wo.completedAt)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Horas de trabajo</p>
              <p className="font-medium">{wo.laborHours ?? '—'} h</p>
            </div>
            {wo.signerName && (
              <div>
                <p className="text-slate-400 text-xs">Recibido por</p>
                <p className="font-medium">{wo.signerName}</p>
                <p className="text-xs text-slate-400">{wo.signerRole}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Secciones de ejecución ─────────────────────────────────────────── */}

      {/* 1. Imágenes ANTES */}
      <SectionCard
        icon={<Image className="h-4 w-4" />}
        title="Imágenes ANTES"
        complete={wo.beforeImages.length >= 1}
        summary={`${wo.beforeImages.length}/5`}
      >
        {wo.status === 'OPEN' && (
          <p className="text-xs text-amber-600 mb-2">Inicie la OT primero para subir fotos</p>
        )}
        <ImageUploadGrid
          images={wo.beforeImages}
          maxImages={5}
          onUpload={(file) => uploadImage(file, 'before')}
          label="Fotografías antes de intervenir (mín. 1)"
          required
          disabled={isClosed || wo.status === 'OPEN'}
          uploading={uploadingBefore}
        />
      </SectionCard>

      {/* 2. Checklist */}
      <SectionCard
        icon={<ClipboardList className="h-4 w-4" />}
        title="Checklist"
        complete={checklist.length > 0 && checklist.every((i) => i.status)}
        summary={checklist.length ? `${checkedCount}/${checklist.length}` : 'Vacío'}
      >
        {checklist.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">Sin checklist para esta OT</p>
        ) : (
          <div className="space-y-2">
            {checklist.map((item) => (
              <div key={item.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm flex-1">
                    {item.required && <span className="text-red-500 mr-1">*</span>}
                    {item.item}
                  </p>
                  {!isClosed && (
                    <div className="flex gap-1 shrink-0">
                      {(['OK', 'FAIL', 'NA'] as const).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => updateChecklistItem(item.id, s)}
                          className={cn(
                            'px-2 py-1 rounded text-xs font-medium border transition-colors',
                            item.status === s
                              ? s === 'OK' ? 'bg-green-500 text-white border-green-500'
                                : s === 'FAIL' ? 'bg-red-500 text-white border-red-500'
                                : 'bg-slate-400 text-white border-slate-400'
                              : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                          )}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                  {isClosed && item.status && (
                    <span className={cn(
                      'px-2 py-0.5 rounded text-xs font-medium',
                      item.status === 'OK' ? 'bg-green-100 text-green-800'
                        : item.status === 'FAIL' ? 'bg-red-100 text-red-800'
                        : 'bg-slate-100 text-slate-600'
                    )}>{item.status}</span>
                  )}
                </div>
                {item.notes && (
                  <p className="text-xs text-slate-500 italic">{item.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 3. Repuestos */}
      <SectionCard
        icon={<Package className="h-4 w-4" />}
        title="Repuestos utilizados"
        complete={(wo as any).spareParts?.length > 0}
        summary={(wo as any).spareParts?.length ? `${(wo as any).spareParts.length} ítem(s)` : 'Ninguno'}
        optional
      >
        {/* Lista de repuestos registrados */}
        {(wo as any).spareParts?.length > 0 && (
          <div className="mb-3 divide-y border rounded-md">
            {(wo as any).spareParts.map((entry: any) => (
              <div key={entry.sparePartId} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <p className="font-medium">{entry.sparePart?.name}</p>
                  <p className="text-xs text-slate-400 font-mono">{entry.sparePart?.code}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-slate-600">{entry.quantity} {entry.sparePart?.unit}</span>
                  {!isClosed && (
                    <button onClick={() => removeSparePart(entry.sparePartId)} className="text-slate-400 hover:text-red-500">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Agregar repuesto */}
        {!isClosed && (
          <div className="space-y-2">
            <div className="relative">
              <Input
                placeholder="Buscar repuesto por nombre o código..."
                value={spareSearch}
                onChange={(e) => { setSpareSearch(e.target.value); setSelectedPart(null); }}
                disabled={!!selectedPart}
              />
              {selectedPart && (
                <button
                  type="button"
                  onClick={() => { setSelectedPart(null); setSpareSearch(''); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-red-500 px-1"
                >
                  ×
                </button>
              )}
            </div>
            {spareResults.length > 0 && !selectedPart && (
              <div className="border rounded-md divide-y max-h-36 overflow-y-auto bg-white shadow-sm">
                {spareResults.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { setSelectedPart(p); setSpareSearch(p.name); setSpareResults([]); }}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 flex justify-between"
                  >
                    <span>{p.name}</span>
                    <span className="text-xs text-slate-400 font-mono">{p.code}</span>
                  </button>
                ))}
              </div>
            )}
            {selectedPart && (
              <div className="flex gap-2">
                <Input
                  type="number"
                  value={spareQty}
                  onChange={(e) => setSpareQty(e.target.value)}
                  min={1}
                  className="w-24"
                  placeholder="Cant."
                />
                <span className="flex items-center text-sm text-slate-500">{selectedPart.unit}</span>
                <Button
                  type="button"
                  size="sm"
                  onClick={addSparePart}
                  loading={actionLoading === 'spare'}
                  disabled={!spareQty || parseInt(spareQty) < 1}
                >
                  <Plus className="h-4 w-4" />
                  Agregar
                </Button>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* 4. Imágenes DESPUÉS */}
      <SectionCard
        icon={<Image className="h-4 w-4" />}
        title="Imágenes DESPUÉS"
        complete={wo.afterImages.length >= 1}
        summary={`${wo.afterImages.length}/5`}
      >
        <ImageUploadGrid
          images={wo.afterImages}
          maxImages={5}
          onUpload={(file) => uploadImage(file, 'after')}
          label="Fotografías después de intervenir (mín. 1)"
          required
          disabled={isClosed || wo.status === 'OPEN'}
          uploading={uploadingAfter}
        />
      </SectionCard>

      {/* 5. Firma del técnico */}
      <SectionCard
        icon={<Pen className="h-4 w-4" />}
        title="Firma del Técnico"
        complete={!!wo.techSignature}
        summary={wo.techSignature ? 'Firmado' : 'Pendiente'}
      >
        <SignaturePad
          onSave={(dataUrl) => saveSignature(dataUrl, 'tech')}
          savedUrl={wo.techSignature}
          label="Firma del técnico que realizó el trabajo"
          disabled={isClosed && !wo.techSignature}
        />
      </SectionCard>

      {/* 6. Firma de quien recibe */}
      <SectionCard
        icon={<Pen className="h-4 w-4" />}
        title="Firma de quien recibe"
        complete={!!wo.clientSignature}
        summary={wo.clientSignature ? (wo.signerName ?? 'Firmado') : 'Pendiente'}
      >
        {wo.clientSignature ? (
          <div className="space-y-2">
            <img src={wo.clientSignature} alt="Firma receptor" className="max-h-24 rounded border" />
            {wo.signerName && (
              <div className="text-sm text-slate-600">
                <p className="font-medium">{wo.signerName}</p>
                <p className="text-xs text-slate-400">{wo.signerRole}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {!isClosed && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setSignerDialog(true)}
              >
                <Pen className="h-4 w-4" />
                Capturar firma del receptor
              </Button>
            )}
          </div>
        )}
      </SectionCard>

      {/* Barra de cierre */}
      {inProgress && (
        <div className={cn(
          'rounded-lg border-2 p-4 flex items-center justify-between gap-4',
          canClose ? 'border-green-200 bg-green-50' : 'border-slate-200 bg-slate-50'
        )}>
          <div className="text-sm">
            {canClose ? (
              <p className="font-medium text-green-700">Todo listo para cerrar la OT</p>
            ) : (
              <div className="space-y-1 text-slate-500">
                <p className="font-medium">Requisitos pendientes:</p>
                {wo.beforeImages.length < 1 && <p className="text-xs">• Al menos 1 foto del antes</p>}
                {wo.afterImages.length < 1 && <p className="text-xs">• Al menos 1 foto del después</p>}
                {!wo.techSignature && <p className="text-xs">• Firma del técnico</p>}
                {!wo.clientSignature && <p className="text-xs">• Firma del receptor</p>}
              </div>
            )}
          </div>
          <Button
            onClick={closeWO}
            disabled={!canClose}
            loading={actionLoading === 'close'}
          >
            <CheckCircle2 className="h-4 w-4" />
            Cerrar OT
          </Button>
        </div>
      )}

      {/* Dialog asignar proveedor */}
      <Dialog
        open={providerDialog}
        onClose={() => setProviderDialog(false)}
        title="Asignar proveedor externo"
        description="Por fuerza mayor — quedará registrado en la trazabilidad de la OT"
      >
        <div className="space-y-4 p-1">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Proveedor</label>
            <select
              value={selectedProviderId}
              onChange={e => setSelectedProviderId(e.target.value)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Sin proveedor</option>
              {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Motivo</label>
            <Input
              value={providerNotes}
              onChange={e => setProviderNotes(e.target.value)}
              placeholder="Razón de derivación a proveedor externo..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setProviderDialog(false)}>Cancelar</Button>
            <Button onClick={assignProvider} loading={actionLoading === 'provider'}>Asignar</Button>
          </div>
        </div>
      </Dialog>

      {/* Dialog firma receptor */}
      <Dialog
        open={signerDialog}
        onClose={() => setSignerDialog(false)}
        title="Firma del receptor"
        description="Nombre y cargo de quien recibe el trabajo"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nombre *</label>
              <Input
                value={signerName}
                onChange={(e) => setSignerName(e.target.value)}
                placeholder="Nombre completo"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Cargo</label>
              <Input
                value={signerRole}
                onChange={(e) => setSignerRole(e.target.value)}
                placeholder="Supervisor, Jefe de área..."
              />
            </div>
          </div>
          {signerName && (
            <SignaturePad
              onSave={(dataUrl) => saveSignature(dataUrl, 'client')}
              label="Firma"
              sublabel="Firme en el área de abajo"
            />
          )}
          {!signerName && (
            <p className="text-xs text-amber-600">Ingrese el nombre antes de firmar</p>
          )}
        </div>
      </Dialog>
    </div>
  );
}

// ─── SectionCard ─────────────────────────────────────────────────────────────

function SectionCard({
  icon, title, complete, summary, optional, children,
}: {
  icon: React.ReactNode;
  title: string;
  complete: boolean;
  summary?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            {complete
              ? <CheckCircle2 className="h-4 w-4 text-green-500" />
              : <Circle className="h-4 w-4 text-slate-300" />}
            {icon}
            {title}
            {optional && <span className="text-xs font-normal text-slate-400">(opcional)</span>}
          </span>
          {summary && (
            <span className={cn('text-xs font-normal', complete ? 'text-green-600' : 'text-slate-400')}>
              {summary}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
