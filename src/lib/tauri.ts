import { invoke } from '@tauri-apps/api/core'
import type {
  FifoLotInput,
  FifoResult,
  MovementValidationInput,
  MovementValidationResult,
  QrPayload,
} from '@/types/domain'

const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

function normalize(value: string): string {
  return value.trim().toUpperCase()
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

function fallbackParseQr(qr: string): QrPayload {
  const parts = qr.split(':')
  if (parts.length !== 3) {
    throw new Error('QR invalido. Usa ITEM:<company_id>:<item_id> o LOT:<company_id>:<lot_id>')
  }

  const prefix = normalize(parts[0])
  const companyId = parts[1]
  const id = parts[2]

  if (!companyId || !id) {
    throw new Error('QR con campos vacios')
  }

  if (prefix === 'ITEM') {
    return { qrType: 'ITEM', companyId, itemId: id }
  }

  if (prefix === 'LOT') {
    return { qrType: 'LOT', companyId, lotId: id }
  }

  throw new Error('Prefijo QR no soportado')
}

function fallbackFifo(
  itemId: string,
  locationId: string,
  requestedQty: number,
  lots: FifoLotInput[],
  allowExpired: boolean,
  reason?: string,
): FifoResult {
  if (requestedQty <= 0) {
    throw new Error('Cantidad solicitada debe ser mayor a cero')
  }

  const today = todayIsoDate()
  const source = lots
    .filter((lot) => lot.itemId === itemId && lot.locationId === locationId && lot.availableQty > 0)
    .map((lot) => ({ ...lot, isExpired: lot.expiresAt.slice(0, 10) < today }))
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt) || a.lotId.localeCompare(b.lotId))

  const nonExpired = source.filter((lot) => !lot.isExpired)
  const expired = source.filter((lot) => lot.isExpired)

  if (!source.length) {
    throw new Error('Sin stock disponible para FIFO')
  }

  const selected = [...nonExpired]
  const nonExpiredTotal = selected.reduce((sum, lot) => sum + lot.availableQty, 0)
  const warnings: string[] = []

  if (nonExpiredTotal < requestedQty) {
    if (!expired.length) {
      throw new Error('Stock no vencido insuficiente para la solicitud')
    }

    if (!allowExpired) {
      throw new Error('Se requiere confirmacion para usar lote vencido')
    }

    if (!reason?.trim()) {
      throw new Error('Debe registrar motivo para uso de lote vencido')
    }

    selected.push(...expired)
    warnings.push('Se utilizaron lotes vencidos para completar la salida')
  }

  let pending = requestedQty
  const allocations: FifoResult['allocations'] = []

  for (const lot of selected) {
    if (pending <= 0) {
      break
    }

    const take = Math.min(lot.availableQty, pending)
    if (take <= 0) {
      continue
    }

    allocations.push({
      lotId: lot.lotId,
      qty: take,
      expiresAt: lot.expiresAt,
      isExpired: lot.isExpired,
    })

    pending -= take
  }

  return {
    allocations,
    fulfilledQty: requestedQty - Math.max(0, pending),
    missingQty: Math.max(0, pending),
    usedExpired: allocations.some((line) => line.isExpired),
    warnings,
  }
}

function fallbackValidateMovement(
  payload: MovementValidationInput,
): MovementValidationResult {
  const movementType = normalize(payload.movementType) as MovementValidationResult['movementType']
  const status = normalize(payload.status) as MovementValidationResult['status']

  if ((movementType === 'ADJUST' || movementType === 'SCRAP') && !payload.motive?.trim()) {
    throw new Error('Motivo obligatorio para ajuste y merma')
  }

  if ((movementType === 'ADJUST' || movementType === 'SCRAP') && status !== 'PENDING') {
    throw new Error('ADJUST/SCRAP nacen en estado PENDING')
  }

  if (movementType === 'OUT_OT' && !payload.hasWorkOrder) {
    throw new Error('OUT_OT requiere OT asociada')
  }

  if (payload.currentStatus && payload.newStatus) {
    if (payload.currentStatus !== 'PENDING') {
      throw new Error('Solo movimientos PENDING pueden cambiar de estado')
    }

    if (payload.newStatus !== 'APPROVED' && payload.newStatus !== 'REJECTED') {
      throw new Error('Destino de estado invalido')
    }

    if (
      payload.approverRole !== 'SUPERVISOR' &&
      payload.approverRole !== 'ADMIN' &&
      payload.approverRole !== 'SUPERADMIN'
    ) {
      throw new Error('Solo Supervisor/Admin/SuperAdmin pueden aprobar')
    }
  }

  return {
    valid: true,
    movementType,
    status,
    warnings: [],
  }
}

export async function parseQr(qr: string): Promise<QrPayload> {
  if (isTauriRuntime) {
    return invoke<QrPayload>('parse_qr', { qr })
  }

  return fallbackParseQr(qr)
}

export async function allocateFifo(payload: {
  companyId: string
  itemId: string
  locationId: string
  requestedQty: number
  lots: FifoLotInput[]
  allowExpired: boolean
  reason?: string
}): Promise<FifoResult> {
  if (isTauriRuntime) {
    return invoke<FifoResult>('allocate_fifo', { input: payload })
  }

  return fallbackFifo(
    payload.itemId,
    payload.locationId,
    payload.requestedQty,
    payload.lots,
    payload.allowExpired,
    payload.reason,
  )
}

export async function validateMovement(
  payload: MovementValidationInput,
): Promise<MovementValidationResult> {
  if (isTauriRuntime) {
    return invoke<MovementValidationResult>('validate_movement', { input: payload })
  }

  return fallbackValidateMovement(payload)
}
