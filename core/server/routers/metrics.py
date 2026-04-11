from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from core.server.database import get_db
from core.server.models import SystemMetric
from core.server.websocket_manager import manager
from core.shared.schemas import SystemMetricsPayload

router = APIRouter()

@router.post("/", status_code=status.HTTP_201_CREATED)
async def report_metrics(payload: SystemMetricsPayload, db: Session = Depends(get_db)):
    db_metric = SystemMetric(
        node_id=payload.node_id,
        cpu_percent=payload.cpu_percent,
        cpu_count=payload.cpu_count,
        load_avg_1m=payload.load_avg_1m,
        load_avg_5m=payload.load_avg_5m,
        load_avg_15m=payload.load_avg_15m,
        ram_used_mb=payload.ram_used_mb,
        ram_total_mb=payload.ram_total_mb,
        ram_percent=payload.ram_percent,
        swap_used_mb=payload.swap_used_mb,
        swap_total_mb=payload.swap_total_mb,
        disk_used_percent=payload.disk_used_percent,
        disk_total_gb=payload.disk_total_gb,
        uptime_seconds=payload.uptime_seconds,
        boot_time_seconds=payload.boot_time_seconds,
        net_tx_bytes=payload.net_tx_bytes,
        net_rx_bytes=payload.net_rx_bytes,
        timestamp=payload.timestamp,
    )
    db.add(db_metric)
    db.commit()

    await manager.broadcast({
        "type": "system_metrics",
        "node_id": payload.node_id,
        "cpu_percent": payload.cpu_percent,
        "cpu_count": payload.cpu_count,
        "load_avg_1m": payload.load_avg_1m,
        "ram_used_mb": payload.ram_used_mb,
        "ram_total_mb": payload.ram_total_mb,
        "ram_percent": payload.ram_percent,
        "disk_used_percent": payload.disk_used_percent,
        "uptime_seconds": payload.uptime_seconds,
        "timestamp": payload.timestamp.isoformat() if hasattr(payload.timestamp, 'isoformat') else str(payload.timestamp),
    })

    return {"message": "Metrics received"}
