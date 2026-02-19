import type {
  KardexMovement,
  Location,
  Lot,
  StockBalance,
  WarehouseState,
  WorkOrder,
  Item,
} from '@/types/domain'

const now = new Date().toISOString()

const company = {
  id: 'COMP-BOG-001',
  name: 'Bodega Central',
}

const locations: Location[] = [
  { id: 'LOC-R1-A1', companyId: company.id, code: 'R1-A1', name: 'Rack 1 Estante A1', zone: 'Recepcion' },
  { id: 'LOC-R1-B2', companyId: company.id, code: 'R1-B2', name: 'Rack 1 Estante B2', zone: 'Produccion' },
  { id: 'LOC-MERMA', companyId: company.id, code: 'MERMA', name: 'Zona de Merma', zone: 'Control' },
]

const items: Item[] = [
  {
    id: 'ITEM-RES-001',
    companyId: company.id,
    sku: 'RES-25KG',
    name: 'Resina Epoxica 25kg',
    baseUnit: 'kg',
    category: 'Quimicos',
    hasExpiry: true,
    byLot: true,
    qrCode: 'ITEM:COMP-BOG-001:ITEM-RES-001',
  },
  {
    id: 'ITEM-GUA-001',
    companyId: company.id,
    sku: 'GUA-NIT-M',
    name: 'Guante Nitrilo M',
    baseUnit: 'par',
    category: 'EPP',
    hasExpiry: false,
    byLot: false,
    qrCode: 'ITEM:COMP-BOG-001:ITEM-GUA-001',
  },
  {
    id: 'ITEM-SOL-002',
    companyId: company.id,
    sku: 'SOL-500ML',
    name: 'Solvente 500ml',
    baseUnit: 'unidad',
    category: 'Quimicos',
    hasExpiry: true,
    byLot: true,
    qrCode: 'ITEM:COMP-BOG-001:ITEM-SOL-002',
  },
]

const lots: Lot[] = [
  {
    id: 'LOT-RES-2401',
    companyId: company.id,
    itemId: 'ITEM-RES-001',
    lotCode: 'RES-2401',
    qrCode: 'LOT:COMP-BOG-001:LOT-RES-2401',
    expiresAt: '2026-05-12',
  },
  {
    id: 'LOT-RES-2402',
    companyId: company.id,
    itemId: 'ITEM-RES-001',
    lotCode: 'RES-2402',
    qrCode: 'LOT:COMP-BOG-001:LOT-RES-2402',
    expiresAt: '2026-10-30',
  },
  {
    id: 'LOT-SOL-2407',
    companyId: company.id,
    itemId: 'ITEM-SOL-002',
    lotCode: 'SOL-2407',
    qrCode: 'LOT:COMP-BOG-001:LOT-SOL-2407',
    expiresAt: '2026-03-10',
  },
  {
    id: 'LOT-SOL-2301',
    companyId: company.id,
    itemId: 'ITEM-SOL-002',
    lotCode: 'SOL-2301',
    qrCode: 'LOT:COMP-BOG-001:LOT-SOL-2301',
    expiresAt: '2025-12-01',
  },
]

const stockBalances: StockBalance[] = [
  {
    companyId: company.id,
    locationId: 'LOC-R1-A1',
    itemId: 'ITEM-RES-001',
    lotId: 'LOT-RES-2401',
    quantity: 120,
    updatedAt: now,
  },
  {
    companyId: company.id,
    locationId: 'LOC-R1-A1',
    itemId: 'ITEM-RES-001',
    lotId: 'LOT-RES-2402',
    quantity: 90,
    updatedAt: now,
  },
  {
    companyId: company.id,
    locationId: 'LOC-R1-B2',
    itemId: 'ITEM-GUA-001',
    lotId: null,
    quantity: 300,
    updatedAt: now,
  },
  {
    companyId: company.id,
    locationId: 'LOC-R1-A1',
    itemId: 'ITEM-SOL-002',
    lotId: 'LOT-SOL-2407',
    quantity: 45,
    updatedAt: now,
  },
  {
    companyId: company.id,
    locationId: 'LOC-R1-A1',
    itemId: 'ITEM-SOL-002',
    lotId: 'LOT-SOL-2301',
    quantity: 12,
    updatedAt: now,
  },
]

const workOrders: WorkOrder[] = [
  {
    id: 'OT-20260219-001',
    companyId: company.id,
    code: 'OT-20260219-001',
    responsible: 'Paula Rojas',
    costCenter: 'CC-PINTURA',
    status: 'IN_PROGRESS',
    notes: 'Lote piloto P-778',
    createdAt: now,
  },
]

const movements: KardexMovement[] = [
  {
    id: 'MOV-INIT-001',
    companyId: company.id,
    movementType: 'INITIAL',
    status: 'APPROVED',
    reason: 'Inventario inicial',
    notes: null,
    requestedByRole: 'ADMIN',
    requestedBy: 'setup.seed',
    approvedByRole: 'ADMIN',
    approvedBy: 'setup.seed',
    createdAt: now,
    lines: [
      {
        locationId: 'LOC-R1-A1',
        itemId: 'ITEM-RES-001',
        lotId: 'LOT-RES-2401',
        deltaQty: 120,
      },
      {
        locationId: 'LOC-R1-A1',
        itemId: 'ITEM-RES-001',
        lotId: 'LOT-RES-2402',
        deltaQty: 90,
      },
      {
        locationId: 'LOC-R1-B2',
        itemId: 'ITEM-GUA-001',
        lotId: null,
        deltaQty: 300,
      },
      {
        locationId: 'LOC-R1-A1',
        itemId: 'ITEM-SOL-002',
        lotId: 'LOT-SOL-2407',
        deltaQty: 45,
      },
      {
        locationId: 'LOC-R1-A1',
        itemId: 'ITEM-SOL-002',
        lotId: 'LOT-SOL-2301',
        deltaQty: 12,
      },
    ],
  },
]

export const initialState: WarehouseState = {
  company,
  activeRole: 'BODEGUERO',
  locations,
  items,
  lots,
  stockBalances,
  movements,
  workOrders,
}
