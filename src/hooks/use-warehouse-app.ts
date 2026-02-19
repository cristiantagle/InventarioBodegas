import { useMemo, useState } from 'react'
import { initialState } from '@/data/mock'
import { allocateFifo, parseQr, validateMovement } from '@/lib/tauri'
import {
  applyApprovedMovement,
  createMovementId,
  createWorkOrderCode,
  findStock,
  isLotManaged,
  isoNow,
  nextStatusAfterApproval,
  rebuildStockFromKardex,
} from '@/lib/warehouse-engine'
import type {
  KardexMovement,
  MovementLine,
  MovementType,
  Role,
  WarehouseState,
  WorkOrder,
} from '@/types/domain'

export interface MovementDraft {
  movementType: MovementType
  qrRaw: string
  quantity: number
  locationFromId: string
  locationToId?: string
  lotId?: string
  autoFifo: boolean
  allowExpired: boolean
  reason?: string
  notes?: string
  requestedBy: string
  workOrderId?: string
  adjustDirection?: 'INCREMENT' | 'DECREMENT'
}

export interface CycleCountDraft {
  locationId: string
  itemId: string
  lotId: string | null
  countedQty: number
  requestedBy: string
  notes?: string
}

function combineLineKey(line: MovementLine): string {
  return `${line.locationId}|${line.itemId}|${line.lotId ?? 'NONE'}`
}

function parseMovementLotContext(
  state: WarehouseState,
  draft: MovementDraft,
  itemIdFromQr: string,
  lotIdFromQr?: string | null,
): { itemId: string; lotId: string | null } {
  const item = state.items.find((value) => value.id === itemIdFromQr)
  if (!item) {
    throw new Error('Item no encontrado para QR escaneado')
  }

  const lotManaged = isLotManaged(item)

  if (!lotManaged) {
    return { itemId: item.id, lotId: null }
  }

  const lotFromDraft = draft.lotId && draft.lotId !== 'AUTO' ? draft.lotId : null
  const resolvedLotId = lotIdFromQr ?? lotFromDraft

  if (resolvedLotId) {
    const lot = state.lots.find((value) => value.id === resolvedLotId)
    if (!lot || lot.itemId !== item.id) {
      throw new Error('Lote invalido para el item escaneado')
    }
    return { itemId: item.id, lotId: lot.id }
  }

  return { itemId: item.id, lotId: null }
}

function ensureNonNegativeStock(
  currentBalances: WarehouseState['stockBalances'],
  lines: MovementLine[],
): void {
  const deltaMap = new Map<string, number>()

  for (const line of lines) {
    const key = combineLineKey(line)
    const current = deltaMap.get(key) ?? 0
    deltaMap.set(key, current + line.deltaQty)
  }

  for (const [key, delta] of deltaMap) {
    if (delta >= 0) {
      continue
    }

    const [locationId, itemId, lotIdRaw] = key.split('|')
    const lotId = lotIdRaw === 'NONE' ? null : lotIdRaw
    const stock = findStock(currentBalances, locationId, itemId, lotId)

    if (stock + delta < 0) {
      throw new Error(
        `Stock insuficiente en ${locationId} para ${itemId}${lotId ? ` / ${lotId}` : ''}. Disponible: ${stock}`,
      )
    }
  }
}

export function useWarehouseApp() {
  const [state, setState] = useState<WarehouseState>(initialState)

  const pendingApprovals = useMemo(
    () =>
      state.movements.filter(
        (movement) =>
          movement.status === 'PENDING' &&
          (movement.movementType === 'ADJUST' || movement.movementType === 'SCRAP'),
      ),
    [state.movements],
  )

  async function submitMovement(draft: MovementDraft): Promise<KardexMovement> {
    if (!draft.qrRaw.trim()) {
      throw new Error('Debe escanear un QR ITEM o LOT')
    }

    if (draft.quantity <= 0) {
      throw new Error('Cantidad invalida')
    }

    const qr = await parseQr(draft.qrRaw)
    if (qr.companyId !== state.company.id) {
      throw new Error('QR pertenece a otra empresa')
    }

    let scannedItemId: string
    let scannedLotId: string | null | undefined

    if (qr.qrType === 'LOT') {
      const lot = state.lots.find((value) => value.id === qr.lotId)
      if (!lot) {
        throw new Error('Lote escaneado no existe')
      }
      scannedItemId = lot.itemId
      scannedLotId = lot.id
    } else {
      if (!qr.itemId) {
        throw new Error('QR de item sin item_id')
      }
      scannedItemId = qr.itemId
      scannedLotId = null
    }

    const context = parseMovementLotContext(state, draft, scannedItemId, scannedLotId)
    const item = state.items.find((value) => value.id === context.itemId)
    if (!item) {
      throw new Error('Item no encontrado')
    }

    const movementType = draft.movementType
    const createdAt = isoNow()
    let lines: MovementLine[] = []

    if (
      qr.qrType === 'ITEM' &&
      isLotManaged(item) &&
      !context.lotId &&
      (movementType === 'OUT_OT' || movementType === 'TRANSFER' || movementType === 'SCRAP')
    ) {
      if (!draft.autoFifo) {
        throw new Error('Item con lotes: seleccione lote o active Auto-FIFO')
      }

      const fifoInput = state.stockBalances
        .filter((line) => line.locationId === draft.locationFromId && line.itemId === item.id && line.lotId)
        .map((line) => {
          const lot = state.lots.find((value) => value.id === line.lotId)
          if (!lot) {
            return null
          }

          return {
            lotId: lot.id,
            itemId: item.id,
            locationId: line.locationId,
            expiresAt: lot.expiresAt,
            availableQty: line.quantity,
          }
        })
        .filter((value): value is NonNullable<typeof value> => Boolean(value))

      const fifo = await allocateFifo({
        companyId: state.company.id,
        itemId: item.id,
        locationId: draft.locationFromId,
        requestedQty: draft.quantity,
        lots: fifoInput,
        allowExpired: draft.allowExpired,
        reason: draft.reason,
      })

      if (fifo.missingQty > 0) {
        throw new Error(`Stock insuficiente. Faltante: ${fifo.missingQty}`)
      }

      const outboundLines = fifo.allocations.map((allocation) => ({
        locationId: draft.locationFromId,
        itemId: item.id,
        lotId: allocation.lotId,
        deltaQty: -allocation.qty,
      }))

      if (movementType === 'TRANSFER') {
        const inboundMirror = fifo.allocations.map((allocation) => ({
          locationId: draft.locationToId ?? '',
          itemId: item.id,
          lotId: allocation.lotId,
          deltaQty: allocation.qty,
        }))
        lines = [...outboundLines, ...inboundMirror]
      } else {
        lines = outboundLines
      }
    } else {
      const lotId = context.lotId

      if (isLotManaged(item) && !lotId) {
        throw new Error('Este item requiere lote. Escanee LOT QR o seleccione lote manualmente')
      }

      if (movementType === 'IN' || movementType === 'INITIAL') {
        lines = [
          {
            locationId: draft.locationFromId,
            itemId: item.id,
            lotId,
            deltaQty: draft.quantity,
          },
        ]
      }

      if (movementType === 'OUT_OT' || movementType === 'SCRAP') {
        lines = [
          {
            locationId: draft.locationFromId,
            itemId: item.id,
            lotId,
            deltaQty: -draft.quantity,
          },
        ]
      }

      if (movementType === 'TRANSFER') {
        if (!draft.locationToId) {
          throw new Error('Traslado requiere ubicacion destino')
        }

        lines = [
          {
            locationId: draft.locationFromId,
            itemId: item.id,
            lotId,
            deltaQty: -draft.quantity,
          },
          {
            locationId: draft.locationToId,
            itemId: item.id,
            lotId,
            deltaQty: draft.quantity,
          },
        ]
      }

      if (movementType === 'ADJUST') {
        const sign = draft.adjustDirection === 'DECREMENT' ? -1 : 1
        lines = [
          {
            locationId: draft.locationFromId,
            itemId: item.id,
            lotId,
            deltaQty: sign * draft.quantity,
          },
        ]
      }
    }

    const status = movementType === 'ADJUST' || movementType === 'SCRAP' ? 'PENDING' : 'APPROVED'

    await validateMovement({
      movementType,
      status,
      motive: draft.reason,
      requestedByRole: state.activeRole,
      hasWorkOrder: movementType === 'OUT_OT' ? Boolean(draft.workOrderId) : undefined,
    })

    ensureNonNegativeStock(state.stockBalances, lines)

    const movement: KardexMovement = {
      id: createMovementId(movementType),
      companyId: state.company.id,
      movementType,
      status,
      reason: draft.reason?.trim() || null,
      notes: draft.notes?.trim() || null,
      requestedByRole: state.activeRole,
      requestedBy: draft.requestedBy,
      workOrderId: draft.workOrderId ?? null,
      createdAt,
      lines,
    }

    setState((current) => {
      const movements = [movement, ...current.movements]
      const stockBalances =
        movement.status === 'APPROVED'
          ? applyApprovedMovement(current.stockBalances, movement)
          : current.stockBalances

      return {
        ...current,
        movements,
        stockBalances,
      }
    })

    return movement
  }

  async function approveMovement(
    movementId: string,
    approved: boolean,
    approverRole: Role,
    approverName: string,
    reason?: string,
  ): Promise<void> {
    const movement = state.movements.find((value) => value.id === movementId)

    if (!movement) {
      throw new Error('Movimiento no encontrado')
    }

    if (movement.status !== 'PENDING') {
      throw new Error('Solo se pueden decidir movimientos pendientes')
    }

    const newStatus = nextStatusAfterApproval(approved)

    await validateMovement({
      movementType: movement.movementType,
      status: movement.status,
      motive: movement.reason,
      requestedByRole: movement.requestedByRole,
      approverRole,
      currentStatus: movement.status,
      newStatus,
    })

    if (approved) {
      ensureNonNegativeStock(state.stockBalances, movement.lines)
    }

    setState((current) => {
      const updatedMovements = current.movements.map((value) => {
        if (value.id !== movementId) {
          return value
        }

        return {
          ...value,
          status: newStatus,
          approvedByRole: approverRole,
          approvedBy: approverName,
          notes: [value.notes, reason].filter(Boolean).join(' | '),
        }
      })

      const stockBalances = approved
        ? applyApprovedMovement(current.stockBalances, {
            ...movement,
            status: 'APPROVED',
            approvedByRole: approverRole,
            approvedBy: approverName,
          })
        : current.stockBalances

      return {
        ...current,
        movements: updatedMovements,
        stockBalances,
      }
    })
  }

  async function submitCycleCount(draft: CycleCountDraft): Promise<KardexMovement | null> {
    const systemQty = findStock(state.stockBalances, draft.locationId, draft.itemId, draft.lotId)
    const delta = Number((draft.countedQty - systemQty).toFixed(4))

    if (delta === 0) {
      return null
    }

    const movementType: MovementType = 'ADJUST'

    const reason = `Conteo ciclico (${systemQty} -> ${draft.countedQty})`

    await validateMovement({
      movementType,
      status: 'PENDING',
      motive: reason,
      requestedByRole: state.activeRole,
    })

    const movement: KardexMovement = {
      id: createMovementId(movementType),
      companyId: state.company.id,
      movementType,
      status: 'PENDING',
      reason,
      notes: draft.notes ?? null,
      requestedByRole: state.activeRole,
      requestedBy: draft.requestedBy,
      createdAt: isoNow(),
      lines: [
        {
          locationId: draft.locationId,
          itemId: draft.itemId,
          lotId: draft.lotId,
          deltaQty: delta,
        },
      ],
    }

    setState((current) => ({
      ...current,
      movements: [movement, ...current.movements],
    }))

    return movement
  }

  function createWorkOrder(input: {
    responsible: string
    costCenter: string
    notes?: string
  }): WorkOrder {
    if (!input.responsible.trim() || !input.costCenter.trim()) {
      throw new Error('Responsable y centro de costo son obligatorios')
    }

    const sequence =
      state.workOrders.filter((ot) => ot.code.startsWith(createWorkOrderCode(0).slice(0, 11))).length + 1

    const workOrder: WorkOrder = {
      id: `WO-${Date.now()}`,
      companyId: state.company.id,
      code: createWorkOrderCode(sequence),
      responsible: input.responsible,
      costCenter: input.costCenter,
      status: 'OPEN',
      notes: input.notes?.trim() || null,
      createdAt: isoNow(),
    }

    setState((current) => ({
      ...current,
      workOrders: [workOrder, ...current.workOrders],
    }))

    return workOrder
  }

  function changeActiveRole(role: Role): void {
    setState((current) => ({
      ...current,
      activeRole: role,
    }))
  }

  function reconcileStock() {
    const rebuilt = rebuildStockFromKardex(state.movements)
    const currentMap = new Map<string, number>()
    const rebuiltMap = new Map<string, number>()

    for (const line of state.stockBalances) {
      currentMap.set(`${line.locationId}|${line.itemId}|${line.lotId ?? 'NONE'}`, line.quantity)
    }

    for (const line of rebuilt) {
      rebuiltMap.set(`${line.locationId}|${line.itemId}|${line.lotId ?? 'NONE'}`, line.quantity)
    }

    const keys = new Set<string>([...currentMap.keys(), ...rebuiltMap.keys()])
    const mismatches = [...keys]
      .map((key) => {
        const balance = currentMap.get(key) ?? 0
        const kardex = rebuiltMap.get(key) ?? 0
        const delta = Number((balance - kardex).toFixed(4))
        return { key, balance, kardex, delta }
      })
      .filter((line) => line.delta !== 0)

    return {
      balanced: mismatches.length === 0,
      mismatches,
      rebuilt,
    }
  }

  return {
    state,
    pendingApprovals,
    changeActiveRole,
    submitMovement,
    approveMovement,
    submitCycleCount,
    createWorkOrder,
    reconcileStock,
  }
}
