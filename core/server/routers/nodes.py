from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from core.server.database import get_db
from core.server.models import Node
from core.shared.schemas import NodeInfo
from datetime import datetime, timezone

router = APIRouter()

@router.post("/register", status_code=status.HTTP_200_OK)
def register_node(node_info: NodeInfo, db: Session = Depends(get_db)):
    db_node = db.query(Node).filter(Node.node_id == node_info.node_id).first()
    if db_node:
        db_node.os_name = node_info.os_name
        db_node.ip_address = node_info.ip_address
        db_node.openclaw_version = node_info.openclaw_version
        db_node.last_seen_at = datetime.now(timezone.utc)
    else:
        db_node = Node(
            node_id=node_info.node_id,
            os_name=node_info.os_name,
            ip_address=node_info.ip_address,
            openclaw_version=node_info.openclaw_version,
            last_seen_at=datetime.now(timezone.utc)
        )
        db.add(db_node)
    db.commit()
    return {"message": "Node registered successfully", "node_id": node_info.node_id}

@router.get("/list")
def list_nodes(db: Session = Depends(get_db)):
    nodes = db.query(Node).order_by(Node.last_seen_at.desc()).all()
    return [
        {
            "node_id": n.node_id,
            "os_name": n.os_name,
            "ip_address": n.ip_address,
            "openclaw_version": n.openclaw_version,
            "last_seen_at": n.last_seen_at.isoformat() if n.last_seen_at else None,
        }
        for n in nodes
    ]
