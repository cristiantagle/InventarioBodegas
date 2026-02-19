import { addDays, formatISO } from 'date-fns'
import type {
  Item,
  KardexMovement,
  Lot,
  MovementType,
  StockBalance,
  WarehouseState,
  WorkOrder,
} from '@/types/domain'

export function isLotManaged(item: Item): boolean {
  return item.hasExpiry || item.byLot
}

export function getLotById(lots: Lot[], lotId: string | null | undefined): Lot | undefined {
  if (!lotId) {
    return undefined
  }
  return lots.find((lot) => lot.id === lotId)
}

export function movementLabel(type: MovementType): string {
  const labels: Record<MovementType, string> = {
    INITIAL: 'Inventario Inicial',
    IN: 'Entrada',
    OUT_OT: 'Salida OT',
    TRANSFER: 'Traslado',
    ADJUST: 'Ajuste',
    SCRAP: 'Merma',
  }
  return labels[type]
}

export function createMovementId(prefix: MovementType): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 9999)
    .toString()
    .padStart(4, '0')}`
}

export function createWorkOrderCode(sequence: number): string {
  const day = new Date()
  return `OT-${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}-${String(sequence).padStart(3, '0')}`
}

export function applyApprovedMovement(
  stockBalances: StockBalance[],
  movement: KardexMovement,
): StockBalance[] {
  if (movement.status !== 'APPROVED') {
    return stockBalances
  }

  const next = [...stockBalances]

  for (const line of movement.lines) {
    const idx = next.findIndex(
      (candidate) =>
        candidate.companyId === movement.companyId &&
        candidate.locationId === line.locationId &&
        candidate.itemId === line.itemId &&
        candidate.lotId === line.lotId,
    )

    if (idx >= 0) {
      const updated = {
        ...next[idx],
        quantity: Number((next[idx].quantity + line.deltaQty).toFixed(4)),
        updatedAt: movement.createdAt,
      }

      if (updated.quantity <= 0) {
        next.splice(idx, 1)
      } else {
        next[idx] = updated
      }
    } else if (line.deltaQty > 0) {
      next.push({
        companyId: movement.companyId,
        locationId: line.locationId,
        itemId: line.itemId,
        lotId: line.lotId,
        quantity: Number(line.deltaQty.toFixed(4)),
        updatedAt: movement.createdAt,
      })
    }
  }

  return next
}

export function rebuildStockFromKardex(movements: KardexMovement[]): StockBalance[] {
  const approved = movements
    .filter((movement) => movement.status === 'APPROVED')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  let balances: StockBalance[] = []
  for (const movement of approved) {
    balances = applyApprovedMovement(balances, movement)
  }

  return balances
}

export function getItemTotalStock(state: WarehouseState, itemId: string): number {
  return state.stockBalances
    .filter((line) => line.itemId === itemId)
    .reduce((sum, line) => sum + line.quantity, 0)
}

export function listExpiringLots(state: WarehouseState, days: number): Lot[] {
  const limit = addDays(new Date(), days)

  return state.lots.filter((lot) => {
    const date = new Date(lot.expiresAt)
    if (Number.isNaN(date.getTime())) {
      return false
    }

    return date <= limit
  })
}

export function findStock(
  stock: StockBalance[],
  locationId: string,
  itemId: string,
  lotId: string | null,
): number {
  return (
    stock.find(
      (line) => line.locationId === locationId && line.itemId === itemId && line.lotId === lotId,
    )?.quantity ?? 0
  )
}

export function nextStatusAfterApproval(approved: boolean): 'APPROVED' | 'REJECTED' {
  return approved ? 'APPROVED' : 'REJECTED'
}

export function countOpenOt(workOrders: WorkOrder[]): number {
  return workOrders.filter((ot) => ot.status === 'OPEN' || ot.status === 'IN_PROGRESS').length
}

export function isoNow(): string {
  return formatISO(new Date())
}

export function isExpired(expiresAt: string): boolean {
  const value = new Date(expiresAt)
  if (Number.isNaN(value.getTime())) {
    return false
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return value < today
}

export function isNearExpiry(expiresAt: string, days = 30): boolean {
  const value = new Date(expiresAt)
  if (Number.isNaN(value.getTime())) {
    return false
  }

  const limit = addDays(new Date(), days)
  return value <= limit
}
