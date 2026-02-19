import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { format } from 'date-fns'
import * as XLSX from 'xlsx'
import type { Item, KardexMovement, Location, Lot, StockBalance, WorkOrder } from '@/types/domain'

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportStockExcel(payload: {
  stock: StockBalance[]
  items: Item[]
  locations: Location[]
  lots: Lot[]
}): void {
  const rows = payload.stock.map((row) => {
    const item = payload.items.find((value) => value.id === row.itemId)
    const location = payload.locations.find((value) => value.id === row.locationId)
    const lot = payload.lots.find((value) => value.id === row.lotId)

    return {
      ubicacion: location?.code ?? row.locationId,
      item_sku: item?.sku ?? row.itemId,
      item_nombre: item?.name ?? row.itemId,
      lote: lot?.lotCode ?? 'N/A',
      vence: lot?.expiresAt ?? 'N/A',
      cantidad: row.quantity,
      unidad: item?.baseUnit ?? '-',
      actualizado: row.updatedAt,
    }
  })

  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, sheet, 'stock')
  XLSX.writeFile(workbook, `stock_por_ubicacion_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`)
}

export function exportKardexCsv(movements: KardexMovement[]): void {
  const headers = [
    'movement_id',
    'tipo',
    'estado',
    'fecha',
    'ubicacion',
    'item',
    'lote',
    'delta_qty',
    'ot',
    'motivo',
  ]

  const rows = movements.flatMap((movement) =>
    movement.lines.map((line) =>
      [
        movement.id,
        movement.movementType,
        movement.status,
        movement.createdAt,
        line.locationId,
        line.itemId,
        line.lotId ?? '',
        line.deltaQty,
        movement.workOrderId ?? '',
        movement.reason ?? '',
      ].join(','),
    ),
  )

  const csv = `${headers.join(',')}\n${rows.join('\n')}`
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `kardex_${Date.now()}.csv`)
}

export function exportOtConsumptionExcel(payload: {
  workOrders: WorkOrder[]
  movements: KardexMovement[]
}): void {
  const rows = payload.workOrders.flatMap((ot) => {
    const lines = payload.movements
      .filter((movement) => movement.movementType === 'OUT_OT' && movement.workOrderId === ot.id)
      .flatMap((movement) =>
        movement.lines.map((line) => ({
          ot: ot.code,
          responsable: ot.responsible,
          centro_costo: ot.costCenter,
          fecha: movement.createdAt,
          item_id: line.itemId,
          lote_id: line.lotId ?? '',
          cantidad: Math.abs(line.deltaQty),
        })),
      )

    return lines
  })

  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, sheet, 'consumo_ot')
  XLSX.writeFile(workbook, `consumo_ot_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`)
}

export function exportExpiryExcel(payload: {
  stock: StockBalance[]
  lots: Lot[]
  items: Item[]
  windowDays: 30 | 60 | 90
}): void {
  const now = new Date()
  const maxDate = new Date(now)
  maxDate.setDate(maxDate.getDate() + payload.windowDays)

  const rows = payload.stock
    .filter((line) => line.lotId)
    .map((line) => {
      const lot = payload.lots.find((value) => value.id === line.lotId)
      const item = payload.items.find((value) => value.id === line.itemId)
      if (!lot || !item) {
        return null
      }

      const expiry = new Date(lot.expiresAt)
      if (Number.isNaN(expiry.getTime())) {
        return null
      }

      if (expiry > maxDate) {
        return null
      }

      return {
        item: item.name,
        sku: item.sku,
        lote: lot.lotCode,
        vence: lot.expiresAt,
        dias_restantes: Math.floor((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
        cantidad: line.quantity,
      }
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))

  const workbook = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, sheet, `vencimientos_${payload.windowDays}`)
  XLSX.writeFile(workbook, `vencimientos_${payload.windowDays}d_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`)
}

export function exportLabelsPdf(payload: { items: Item[]; lots: Lot[] }): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  doc.setFontSize(14)
  doc.text('Etiquetas ITEM QR', 12, 12)

  autoTable(doc, {
    startY: 16,
    head: [['SKU', 'ITEM', 'QR']],
    body: payload.items.map((item) => [item.sku, item.name, item.qrCode]),
    styles: { fontSize: 9 },
  })

  doc.addPage()
  doc.setFontSize(14)
  doc.text('Etiquetas LOT QR', 12, 12)

  autoTable(doc, {
    startY: 16,
    head: [['Lote', 'ItemId', 'Vence', 'QR']],
    body: payload.lots.map((lot) => [lot.lotCode, lot.itemId, lot.expiresAt, lot.qrCode]),
    styles: { fontSize: 9 },
  })

  doc.save(`etiquetas_qr_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`)
}

export function exportBasicSummaryPdf(payload: {
  stockCount: number
  pendingApprovals: number
  openOt: number
}): void {
  const doc = new jsPDF()
  doc.setFontSize(18)
  doc.text('Resumen Operacional de Bodega', 14, 20)
  doc.setFontSize(12)
  doc.text(`Registros de stock: ${payload.stockCount}`, 14, 34)
  doc.text(`Aprobaciones pendientes: ${payload.pendingApprovals}`, 14, 42)
  doc.text(`OT abiertas/en curso: ${payload.openOt}`, 14, 50)
  doc.text(`Emitido: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`, 14, 66)

  doc.save(`resumen_bodega_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`)
}
