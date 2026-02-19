use chrono::{NaiveDate, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum QrType {
  Item,
  Lot,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrPayload {
  pub qr_type: QrType,
  pub company_id: String,
  pub item_id: Option<String>,
  pub lot_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FifoRequest {
  pub company_id: String,
  pub item_id: String,
  pub location_id: String,
  pub requested_qty: f64,
  pub lots: Vec<FifoLot>,
  #[serde(default)]
  pub allow_expired: bool,
  pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FifoLot {
  pub lot_id: String,
  pub item_id: String,
  pub location_id: String,
  pub expires_at: String,
  pub available_qty: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FifoAllocation {
  pub lot_id: String,
  pub qty: f64,
  pub expires_at: String,
  pub is_expired: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FifoResult {
  pub allocations: Vec<FifoAllocation>,
  pub fulfilled_qty: f64,
  pub missing_qty: f64,
  pub used_expired: bool,
  pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovementValidationInput {
  pub movement_type: String,
  pub status: String,
  pub motive: Option<String>,
  pub requested_by_role: String,
  pub approver_role: Option<String>,
  pub has_work_order: Option<bool>,
  pub current_status: Option<String>,
  pub new_status: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MovementValidationResult {
  pub valid: bool,
  pub movement_type: String,
  pub status: String,
  pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileLine {
  pub company_id: String,
  pub location_id: String,
  pub item_id: String,
  pub lot_id: Option<String>,
  pub kardex_qty: f64,
  pub balance_qty: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileStockInput {
  pub lines: Vec<ReconcileLine>,
  #[serde(default = "default_tolerance")]
  pub tolerance: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileMismatch {
  pub company_id: String,
  pub location_id: String,
  pub item_id: String,
  pub lot_id: Option<String>,
  pub kardex_qty: f64,
  pub balance_qty: f64,
  pub delta: f64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReconcileStockResult {
  pub balanced: bool,
  pub checked_lines: usize,
  pub mismatch_count: usize,
  pub mismatches: Vec<ReconcileMismatch>,
}

fn default_tolerance() -> f64 {
  0.000_001
}

fn normalize(value: &str) -> String {
  value.trim().to_ascii_uppercase()
}

fn parse_date(value: &str) -> Result<NaiveDate, String> {
  let candidate = if value.len() >= 10 {
    &value[..10]
  } else {
    value
  };

  NaiveDate::parse_from_str(candidate, "%Y-%m-%d")
    .map_err(|_| format!("Invalid date format: {value}"))
}

#[tauri::command]
pub fn parse_qr(qr: String) -> Result<QrPayload, String> {
  let chunks: Vec<&str> = qr.split(':').collect();

  if chunks.len() != 3 {
    return Err("Invalid QR format. Expected ITEM:<company_id>:<item_id> or LOT:<company_id>:<lot_id>".to_string());
  }

  let qr_type = normalize(chunks[0]);
  let company_id = chunks[1].trim();
  let entity_id = chunks[2].trim();

  if company_id.is_empty() || entity_id.is_empty() {
    return Err("QR contains empty identifiers".to_string());
  }

  match qr_type.as_str() {
    "ITEM" => Ok(QrPayload {
      qr_type: QrType::Item,
      company_id: company_id.to_string(),
      item_id: Some(entity_id.to_string()),
      lot_id: None,
    }),
    "LOT" => Ok(QrPayload {
      qr_type: QrType::Lot,
      company_id: company_id.to_string(),
      item_id: None,
      lot_id: Some(entity_id.to_string()),
    }),
    _ => Err("Unsupported QR prefix. Use ITEM or LOT".to_string()),
  }
}

#[tauri::command]
pub fn allocate_fifo(input: FifoRequest) -> Result<FifoResult, String> {
  if input.requested_qty <= 0.0 {
    return Err("Requested quantity must be greater than zero".to_string());
  }

  let today = Utc::now().date_naive();
  let mut non_expired: Vec<(FifoLot, NaiveDate)> = Vec::new();
  let mut expired: Vec<(FifoLot, NaiveDate)> = Vec::new();

  for lot in input.lots.iter().cloned() {
    if lot.item_id != input.item_id || lot.location_id != input.location_id || lot.available_qty <= 0.0 {
      continue;
    }

    let exp_date = parse_date(&lot.expires_at)?;
    if exp_date < today {
      expired.push((lot, exp_date));
    } else {
      non_expired.push((lot, exp_date));
    }
  }

  non_expired.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.lot_id.cmp(&b.0.lot_id)));
  expired.sort_by(|a, b| a.1.cmp(&b.1).then(a.0.lot_id.cmp(&b.0.lot_id)));

  if non_expired.is_empty() && expired.is_empty() {
    return Err("No stock available for FIFO allocation in selected location".to_string());
  }

  let mut warnings: Vec<String> = Vec::new();
  let mut pool: Vec<(FifoLot, NaiveDate, bool)>;

  if non_expired.is_empty() {
    if !input.allow_expired {
      return Err(
        "All available stock is expired. Enable allow_expired and register motive 'Uso de lote vencido'"
          .to_string(),
      );
    }

    if input.reason.as_deref().map(str::trim).filter(|m| !m.is_empty()).is_none() {
      return Err("Reason is required when using expired lots".to_string());
    }

    warnings.push("Todos los lotes disponibles se encuentran vencidos".to_string());
    pool = expired
      .into_iter()
      .map(|(lot, date)| (lot, date, true))
      .collect();
  } else {
    pool = non_expired
      .into_iter()
      .map(|(lot, date)| (lot, date, false))
      .collect();

    let needs_expired = pool.iter().map(|(lot, _, _)| lot.available_qty).sum::<f64>() < input.requested_qty;
    if needs_expired {
      if expired.is_empty() {
        return Err("Insufficient non-expired stock for requested quantity".to_string());
      }
      if !input.allow_expired {
        return Err(
          "Expired lots are required to complete FIFO allocation. Confirmation is required with motive 'Uso de lote vencido'"
            .to_string(),
        );
      }
      if input.reason.as_deref().map(str::trim).filter(|m| !m.is_empty()).is_none() {
        return Err("Reason is required when using expired lots".to_string());
      }

      warnings.push("Se utilizaron lotes vencidos para completar la salida".to_string());
      pool.extend(expired.into_iter().map(|(lot, date)| (lot, date, true)));
    }
  }

  let mut remaining = input.requested_qty;
  let mut allocations: Vec<FifoAllocation> = Vec::new();

  for (lot, _, is_expired) in pool {
    if remaining <= 0.0 {
      break;
    }

    let take = remaining.min(lot.available_qty);
    if take <= 0.0 {
      continue;
    }

    allocations.push(FifoAllocation {
      lot_id: lot.lot_id,
      qty: take,
      expires_at: lot.expires_at,
      is_expired,
    });

    remaining -= take;
  }

  let fulfilled_qty = input.requested_qty - remaining.max(0.0);
  let missing_qty = remaining.max(0.0);
  let used_expired = allocations.iter().any(|line| line.is_expired);

  Ok(FifoResult {
    allocations,
    fulfilled_qty,
    missing_qty,
    used_expired,
    warnings,
  })
}

#[tauri::command]
pub fn validate_movement(input: MovementValidationInput) -> Result<MovementValidationResult, String> {
  let movement_type = normalize(&input.movement_type);
  let status = normalize(&input.status);
  let requested_by_role = normalize(&input.requested_by_role);

  if !(movement_type == "INITIAL"
    || movement_type == "IN"
    || movement_type == "OUT_OT"
    || movement_type == "TRANSFER"
    || movement_type == "ADJUST"
    || movement_type == "SCRAP")
  {
    return Err("Invalid movement_type".to_string());
  }

  if !(status == "PENDING" || status == "APPROVED" || status == "REJECTED") {
    return Err("Invalid status".to_string());
  }

  if !(requested_by_role == "BODEGUERO"
    || requested_by_role == "SUPERVISOR"
    || requested_by_role == "ADMIN"
    || requested_by_role == "SUPERADMIN")
  {
    return Err("Invalid requested_by_role".to_string());
  }

  if (movement_type == "ADJUST" || movement_type == "SCRAP")
    && input
      .motive
      .as_deref()
      .map(str::trim)
      .filter(|m| !m.is_empty())
      .is_none()
  {
    return Err("Motive is required for ADJUST and SCRAP".to_string());
  }

  if (movement_type == "ADJUST" || movement_type == "SCRAP") && status != "PENDING" {
    return Err("ADJUST and SCRAP must start as PENDING".to_string());
  }

  if movement_type == "OUT_OT" && !input.has_work_order.unwrap_or(false) {
    return Err("OUT_OT requires an associated work order".to_string());
  }

  let mut warnings: Vec<String> = Vec::new();

  if let (Some(current_status), Some(new_status)) = (input.current_status, input.new_status) {
    let current_status = normalize(&current_status);
    let new_status = normalize(&new_status);

    if current_status != "PENDING" {
      return Err("Only PENDING movements can change status".to_string());
    }

    if !(new_status == "APPROVED" || new_status == "REJECTED") {
      return Err("New status must be APPROVED or REJECTED".to_string());
    }

    let approver_role = input
      .approver_role
      .as_deref()
      .map(normalize)
      .ok_or("Approver role is required for PENDING transitions")?;

    if !(approver_role == "SUPERVISOR" || approver_role == "ADMIN" || approver_role == "SUPERADMIN") {
      return Err("Only Supervisor/Admin/SuperAdmin can approve or reject pending movements".to_string());
    }

    if approver_role == "SUPERVISOR" && movement_type == "SCRAP" {
      warnings.push("Supervisor aprobando SCRAP: revisar politica interna de montos".to_string());
    }
  }

  Ok(MovementValidationResult {
    valid: true,
    movement_type,
    status,
    warnings,
  })
}

#[tauri::command]
pub fn reconcile_stock(input: ReconcileStockInput) -> Result<ReconcileStockResult, String> {
  if input.tolerance.is_sign_negative() {
    return Err("Tolerance must be zero or positive".to_string());
  }

  let checked_lines = input.lines.len();
  let mut mismatches: Vec<ReconcileMismatch> = Vec::new();

  for line in input.lines {
    let delta = line.balance_qty - line.kardex_qty;
    if delta.abs() > input.tolerance {
      mismatches.push(ReconcileMismatch {
        company_id: line.company_id,
        location_id: line.location_id,
        item_id: line.item_id,
        lot_id: line.lot_id,
        kardex_qty: line.kardex_qty,
        balance_qty: line.balance_qty,
        delta,
      });
    }
  }

  Ok(ReconcileStockResult {
    balanced: mismatches.is_empty(),
    checked_lines,
    mismatch_count: mismatches.len(),
    mismatches,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parse_item_qr_ok() {
    let parsed = parse_qr("ITEM:COMP-1:ITEM-99".to_string()).expect("valid QR");
    assert!(matches!(parsed.qr_type, QrType::Item));
    assert_eq!(parsed.company_id, "COMP-1");
    assert_eq!(parsed.item_id.as_deref(), Some("ITEM-99"));
    assert!(parsed.lot_id.is_none());
  }

  #[test]
  fn fifo_prioritizes_non_expired() {
    let input = FifoRequest {
      company_id: "COMP-1".to_string(),
      item_id: "ITEM-1".to_string(),
      location_id: "LOC-1".to_string(),
      requested_qty: 12.0,
      allow_expired: true,
      reason: Some("Uso de lote vencido".to_string()),
      lots: vec![
        FifoLot {
          lot_id: "L-OLD".to_string(),
          item_id: "ITEM-1".to_string(),
          location_id: "LOC-1".to_string(),
          expires_at: "2020-01-01".to_string(),
          available_qty: 20.0,
        },
        FifoLot {
          lot_id: "L-NEAR".to_string(),
          item_id: "ITEM-1".to_string(),
          location_id: "LOC-1".to_string(),
          expires_at: "2030-01-01".to_string(),
          available_qty: 8.0,
        },
        FifoLot {
          lot_id: "L-FAR".to_string(),
          item_id: "ITEM-1".to_string(),
          location_id: "LOC-1".to_string(),
          expires_at: "2031-01-01".to_string(),
          available_qty: 10.0,
        },
      ],
    };

    let output = allocate_fifo(input).expect("fifo should allocate");
    assert_eq!(output.allocations[0].lot_id, "L-NEAR");
    assert_eq!(output.allocations[1].lot_id, "L-FAR");
    assert_eq!(output.fulfilled_qty, 12.0);
    assert!(!output.used_expired);
  }

  #[test]
  fn validate_adjust_requires_motive() {
    let input = MovementValidationInput {
      movement_type: "ADJUST".to_string(),
      status: "PENDING".to_string(),
      motive: None,
      requested_by_role: "BODEGUERO".to_string(),
      approver_role: None,
      has_work_order: None,
      current_status: None,
      new_status: None,
    };

    assert!(validate_movement(input).is_err());
  }
}
