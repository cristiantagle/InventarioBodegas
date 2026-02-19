export type Role = 'BODEGUERO' | 'SUPERVISOR' | 'ADMIN' | 'SUPERADMIN'

export type MovementType =
  | 'INITIAL'
  | 'IN'
  | 'OUT_OT'
  | 'TRANSFER'
  | 'ADJUST'
  | 'SCRAP'

export type MovementStatus = 'PENDING' | 'APPROVED' | 'REJECTED'

export type WorkOrderStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED'

export interface Company {
  id: string
  name: string
}

export interface Location {
  id: string
  companyId: string
  code: string
  name: string
  zone?: string
}

export interface Item {
  id: string
  companyId: string
  sku: string
  name: string
  baseUnit: string
  category: string
  hasExpiry: boolean
  byLot: boolean
  qrCode: string
}

export interface Lot {
  id: string
  companyId: string
  itemId: string
  lotCode: string
  qrCode: string
  expiresAt: string
}

export interface StockBalance {
  companyId: string
  locationId: string
  itemId: string
  lotId: string | null
  quantity: number
  updatedAt: string
}

export interface MovementLine {
  locationId: string
  itemId: string
  lotId: string | null
  deltaQty: number
}

export interface KardexMovement {
  id: string
  companyId: string
  movementType: MovementType
  status: MovementStatus
  reason: string | null
  notes: string | null
  requestedByRole: Role
  requestedBy: string
  approvedByRole?: Role | null
  approvedBy?: string | null
  workOrderId?: string | null
  createdAt: string
  lines: MovementLine[]
}

export interface WorkOrder {
  id: string
  companyId: string
  code: string
  responsible: string
  costCenter: string
  status: WorkOrderStatus
  notes: string | null
  createdAt: string
}

export interface QrPayload {
  qrType: 'ITEM' | 'LOT'
  companyId: string
  itemId?: string | null
  lotId?: string | null
}

export interface FifoLotInput {
  lotId: string
  itemId: string
  locationId: string
  expiresAt: string
  availableQty: number
}

export interface FifoAllocation {
  lotId: string
  qty: number
  expiresAt: string
  isExpired: boolean
}

export interface FifoResult {
  allocations: FifoAllocation[]
  fulfilledQty: number
  missingQty: number
  usedExpired: boolean
  warnings: string[]
}

export interface MovementValidationInput {
  movementType: MovementType
  status: MovementStatus
  motive?: string | null
  requestedByRole: Role
  approverRole?: Role | null
  hasWorkOrder?: boolean
  currentStatus?: MovementStatus
  newStatus?: MovementStatus
}

export interface MovementValidationResult {
  valid: boolean
  movementType: MovementType
  status: MovementStatus
  warnings: string[]
}

export interface WarehouseState {
  company: Company
  activeRole: Role
  locations: Location[]
  items: Item[]
  lots: Lot[]
  stockBalances: StockBalance[]
  movements: KardexMovement[]
  workOrders: WorkOrder[]
}

export interface ReportFilter {
  dateFrom?: string
  dateTo?: string
  locationId?: string
  itemId?: string
}
