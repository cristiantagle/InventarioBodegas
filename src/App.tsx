import { useMemo, useState } from 'react'
import { Box, ClipboardCheck, FileDown, QrCode, RefreshCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Toaster } from '@/components/ui/sonner'
import { useWarehouseApp } from '@/hooks/use-warehouse-app'
import { countOpenOt, isExpired, listExpiringLots, movementLabel } from '@/lib/warehouse-engine'
import {
  exportBasicSummaryPdf,
  exportExpiryExcel,
  exportKardexCsv,
  exportLabelsPdf,
  exportOtConsumptionExcel,
  exportStockExcel,
} from '@/lib/exports'
import type { MovementType, Role } from '@/types/domain'

const roles: Role[] = ['BODEGUERO', 'SUPERVISOR', 'ADMIN', 'SUPERADMIN']
const movementTypes: MovementType[] = ['IN', 'OUT_OT', 'TRANSFER', 'ADJUST', 'SCRAP']

function canApprove(role: Role) {
  return role === 'SUPERVISOR' || role === 'ADMIN' || role === 'SUPERADMIN'
}

function App() {
  const {
    state,
    pendingApprovals,
    changeActiveRole,
    submitMovement,
    approveMovement,
    submitCycleCount,
    createWorkOrder,
    reconcileStock,
  } = useWarehouseApp()

  const [tab, setTab] = useState('resumen')
  const [qrRaw, setQrRaw] = useState('')
  const [movementType, setMovementType] = useState<MovementType>('OUT_OT')
  const [qty, setQty] = useState('1')
  const [fromLocation, setFromLocation] = useState(state.locations[0]?.id ?? '')
  const [toLocation, setToLocation] = useState(state.locations[1]?.id ?? '')
  const [lotId, setLotId] = useState('AUTO')
  const [workOrderId, setWorkOrderId] = useState(state.workOrders[0]?.id ?? '')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [autoFifo, setAutoFifo] = useState(true)
  const [allowExpired, setAllowExpired] = useState(false)

  const [countItemId, setCountItemId] = useState(state.items[0]?.id ?? '')
  const [countLotId, setCountLotId] = useState('NONE')
  const [countedQty, setCountedQty] = useState('0')

  const [otResponsible, setOtResponsible] = useState('')
  const [otCostCenter, setOtCostCenter] = useState('')

  const [reconcileSummary, setReconcileSummary] = useState('')

  const expiring = useMemo(() => listExpiringLots(state, 30), [state])

  async function onSubmitMovement() {
    try {
      const movement = await submitMovement({
        movementType,
        qrRaw,
        quantity: Number(qty),
        locationFromId: fromLocation,
        locationToId: toLocation,
        lotId: lotId === 'AUTO' || lotId === 'NONE' ? undefined : lotId,
        autoFifo,
        allowExpired,
        reason,
        notes,
        requestedBy: 'usuario.mobile',
        workOrderId: workOrderId || undefined,
        adjustDirection: 'DECREMENT',
      })
      setQrRaw('')
      setReason('')
      setNotes('')
      toast.success(`Movimiento ${movement.id} (${movement.status})`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar movimiento')
    }
  }

  async function onSubmitCount() {
    try {
      const movement = await submitCycleCount({
        locationId: fromLocation,
        itemId: countItemId,
        lotId: countLotId === 'NONE' ? null : countLotId,
        countedQty: Number(countedQty),
        requestedBy: 'conteo.mobile',
      })
      toast.message(movement ? `Ajuste pendiente ${movement.id}` : 'Sin diferencia de conteo')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo registrar conteo')
    }
  }

  async function onApproval(id: string, approved: boolean) {
    try {
      await approveMovement(id, approved, state.activeRole, 'aprobador.mobile')
      toast.success(approved ? 'Aprobado' : 'Rechazado')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No autorizado para aprobar')
    }
  }

  function onCreateOt() {
    try {
      const ot = createWorkOrder({ responsible: otResponsible, costCenter: otCostCenter })
      setOtResponsible('')
      setOtCostCenter('')
      toast.success(`OT creada: ${ot.code}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear OT')
    }
  }

  function onReconcile() {
    const result = reconcileStock()
    setReconcileSummary(result.balanced ? 'BALANCED' : `MISMATCH (${result.mismatches.length})`)
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-5xl px-3 pb-20 pt-4">
      <header className="mb-4 rounded-2xl border bg-card/80 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Bodega con Kardex + OT</p>
            <h1 className="text-2xl font-semibold">{state.company.name}</h1>
          </div>
          <Select value={state.activeRole} onValueChange={(value) => changeActiveRole(value as Role)}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>{roles.map((role) => <SelectItem key={role} value={role}>{role}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsContent value="resumen" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Card><CardHeader className="pb-2"><CardDescription>Stock rows</CardDescription><CardTitle>{state.stockBalances.length}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>Pendientes</CardDescription><CardTitle>{pendingApprovals.length}</CardTitle></CardHeader></Card>
            <Card><CardHeader className="pb-2"><CardDescription>OT abiertas</CardDescription><CardTitle>{countOpenOt(state.workOrders)}</CardTitle></CardHeader></Card>
          </div>

          <Card>
            <CardHeader><CardTitle>Vencimientos 30 dias</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {!expiring.length && <p className="text-sm text-muted-foreground">Sin alertas.</p>}
              {expiring.map((lot) => (
                <Alert key={lot.id} variant={isExpired(lot.expiresAt) ? 'destructive' : 'default'}>
                  <AlertTitle>{lot.lotCode}</AlertTitle>
                  <AlertDescription>{lot.qrCode} | vence {lot.expiresAt}</AlertDescription>
                </Alert>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="operar" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Scan + Movimientos</CardTitle>
              <CardDescription>ITEM QR: Auto-FIFO opcional. LOT QR: opera directo al lote.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Select value={movementType} onValueChange={(value) => setMovementType(value as MovementType)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{movementTypes.map((type) => <SelectItem key={type} value={type}>{movementLabel(type)}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="number" step="0.01" min="0" value={qty} onChange={(event) => setQty(event.target.value)} />
              </div>

              <Input placeholder="ITEM:company:item o LOT:company:lot" value={qrRaw} onChange={(event) => setQrRaw(event.target.value)} />

              <div className="grid gap-3 sm:grid-cols-2">
                <Select value={fromLocation} onValueChange={setFromLocation}>
                  <SelectTrigger><SelectValue placeholder="Origen" /></SelectTrigger>
                  <SelectContent>{state.locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.code}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={toLocation} onValueChange={setToLocation}>
                  <SelectTrigger><SelectValue placeholder="Destino" /></SelectTrigger>
                  <SelectContent>{state.locations.map((location) => <SelectItem key={location.id} value={location.id}>{location.code}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select value={lotId} onValueChange={setLotId}>
                  <SelectTrigger><SelectValue placeholder="Lote" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUTO">Auto-FIFO</SelectItem>
                    <SelectItem value="NONE">Sin lote</SelectItem>
                    {state.lots.map((lot) => <SelectItem key={lot.id} value={lot.id}>{lot.lotCode} ({lot.expiresAt})</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={workOrderId} onValueChange={setWorkOrderId}>
                  <SelectTrigger><SelectValue placeholder="OT" /></SelectTrigger>
                  <SelectContent>{state.workOrders.map((ot) => <SelectItem key={ot.id} value={ot.id}>{ot.code}</SelectItem>)}</SelectContent>
                </Select>
              </div>

              <Input placeholder="Motivo (obligatorio ADJUST/SCRAP)" value={reason} onChange={(event) => setReason(event.target.value)} />
              <Textarea placeholder="Notas" value={notes} onChange={(event) => setNotes(event.target.value)} />

              <div className="flex flex-wrap gap-4 rounded-lg border p-3">
                <div className="flex items-center gap-2"><Switch checked={autoFifo} onCheckedChange={setAutoFifo} /><Label>Auto-FIFO</Label></div>
                <div className="flex items-center gap-2"><Switch checked={allowExpired} onCheckedChange={setAllowExpired} /><Label>Permitir vencido</Label></div>
              </div>

              <Button className="w-full" onClick={onSubmitMovement}>Registrar movimiento</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Conteo ciclico rapido</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Select value={countItemId} onValueChange={setCountItemId}>
                <SelectTrigger><SelectValue placeholder="Item" /></SelectTrigger>
                <SelectContent>{state.items.map((item) => <SelectItem key={item.id} value={item.id}>{item.sku} - {item.name}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={countLotId} onValueChange={setCountLotId}>
                <SelectTrigger><SelectValue placeholder="Lote" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Sin lote</SelectItem>
                  {state.lots.map((lot) => <SelectItem key={lot.id} value={lot.id}>{lot.lotCode}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input type="number" step="0.01" value={countedQty} onChange={(event) => setCountedQty(event.target.value)} />
              <Button variant="secondary" className="w-full" onClick={onSubmitCount}>Crear ajuste por conteo</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>OT</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input placeholder="Responsable" value={otResponsible} onChange={(event) => setOtResponsible(event.target.value)} />
                <Input placeholder="Centro de costo" value={otCostCenter} onChange={(event) => setOtCostCenter(event.target.value)} />
              </div>
              <Button variant="secondary" onClick={onCreateOt}>Crear OT</Button>
              <div className="space-y-2 text-sm text-muted-foreground">
                {state.workOrders.map((ot) => <p key={ot.id}>{ot.code} | {ot.responsible} | {ot.status}</p>)}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aprobar" className="space-y-4">
          <Alert>
            <ClipboardCheck className="h-4 w-4" />
            <AlertTitle>Aprobaciones de ADJUST/SCRAP</AlertTitle>
            <AlertDescription>Rol actual: {state.activeRole}. {canApprove(state.activeRole) ? 'Puede aprobar.' : 'No autorizado.'}</AlertDescription>
          </Alert>

          <Card>
            <CardContent className="space-y-3 pt-6">
              {!pendingApprovals.length && <p className="text-sm text-muted-foreground">No hay pendientes.</p>}
              {pendingApprovals.map((movement) => (
                <div key={movement.id} className="rounded-lg border p-3">
                  <p className="text-sm font-semibold">{movement.id} | {movement.movementType}</p>
                  <p className="text-xs text-muted-foreground">Motivo: {movement.reason ?? 'N/A'}</p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button disabled={!canApprove(state.activeRole)} onClick={() => onApproval(movement.id, true)}>Aprobar</Button>
                    <Button disabled={!canApprove(state.activeRole)} variant="destructive" onClick={() => onApproval(movement.id, false)}>Rechazar</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reportes" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Exportables</CardTitle></CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              <Button variant="secondary" onClick={() => exportStockExcel({ stock: state.stockBalances, items: state.items, locations: state.locations, lots: state.lots })}><FileDown className="mr-2 h-4 w-4" />Stock Excel</Button>
              <Button variant="secondary" onClick={() => exportKardexCsv(state.movements)}><FileDown className="mr-2 h-4 w-4" />Kardex CSV</Button>
              <Button variant="secondary" onClick={() => exportOtConsumptionExcel({ workOrders: state.workOrders, movements: state.movements })}><FileDown className="mr-2 h-4 w-4" />Consumo OT Excel</Button>
              <Button variant="secondary" onClick={() => exportExpiryExcel({ stock: state.stockBalances, lots: state.lots, items: state.items, windowDays: 30 })}><FileDown className="mr-2 h-4 w-4" />Vencimientos 30d</Button>
              <Button variant="secondary" onClick={() => exportLabelsPdf({ items: state.items, lots: state.lots })}><FileDown className="mr-2 h-4 w-4" />Etiquetas PDF</Button>
              <Button variant="secondary" onClick={() => exportBasicSummaryPdf({ stockCount: state.stockBalances.length, pendingApprovals: pendingApprovals.length, openOt: countOpenOt(state.workOrders) })}><FileDown className="mr-2 h-4 w-4" />Resumen PDF</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Reconciliacion</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Button onClick={onReconcile}><RefreshCcw className="mr-2 h-4 w-4" />Reconciliar stock_balances</Button>
              {reconcileSummary && <Badge variant={reconcileSummary.startsWith('BALANCED') ? 'default' : 'destructive'}>{reconcileSummary}</Badge>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsList className="fixed bottom-2 left-1/2 grid w-[min(96vw,840px)] -translate-x-1/2 grid-cols-4 rounded-2xl border bg-background/95 p-1 shadow-lg">
          <TabsTrigger value="resumen"><Box className="mr-1 h-3.5 w-3.5" />Resumen</TabsTrigger>
          <TabsTrigger value="operar"><QrCode className="mr-1 h-3.5 w-3.5" />Operar</TabsTrigger>
          <TabsTrigger value="aprobar"><ClipboardCheck className="mr-1 h-3.5 w-3.5" />Aprobar</TabsTrigger>
          <TabsTrigger value="reportes"><FileDown className="mr-1 h-3.5 w-3.5" />Reportes</TabsTrigger>
        </TabsList>
      </Tabs>

      <section className="mt-6 rounded-2xl border bg-card/70 p-4 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Regla QR</p>
        <Separator className="my-2" />
        <p>`ITEM:&lt;company_id&gt;:&lt;item_id&gt;` | `LOT:&lt;company_id&gt;:&lt;lot_id&gt;`</p>
        <p className="mt-1">Si el item usa lote: LOT QR directo o ITEM QR + lote/Auto-FIFO.</p>
      </section>

      <Toaster richColors closeButton position="top-center" />
    </div>
  )
}

export default App
