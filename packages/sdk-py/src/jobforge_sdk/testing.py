"""
JobForge Python SDK Testing Utilities and Mock Client.
Enables offline unit testing for applications consuming JobForge.
"""

from typing import Dict, Any, List, Optional
import uuid
import datetime

class MockJobForgeClient:
    """In-memory mock client for unit testing."""
    
    def __init__(self, tenant_id: str = "test-tenant"):
        self.tenant_id = tenant_id
        self.jobs: Dict[str, Dict[str, Any]] = {}
        self.results: Dict[str, Dict[str, Any]] = {}

    def enqueue(self, job_type: str, payload: Dict[str, Any], priority: int = 0) -> Dict[str, Any]:
        job_id = f"mock-job-{uuid.uuid4()}"
        job = {
            "id": job_id,
            "tenant_id": self.tenant_id,
            "type": job_type,
            "payload": payload,
            "priority": priority,
            "status": "queued",
            "attempts": 0,
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        self.jobs[job_id] = job
        return {"job_id": job_id, "status": "queued"}

    def enqueue_batch(self, jobs: List[Dict[str, Any]]) -> List[str]:
        job_ids = []
        for j in jobs:
            res = self.enqueue(j["type"], j.get("payload", {}), j.get("priority", 0))
            job_ids.append(res["job_id"])
        return job_ids

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        return self.jobs.get(job_id)

    def complete(self, job_id: str, result: Dict[str, Any]) -> bool:
        if job_id not in self.jobs:
            return False
        self.jobs[job_id]["status"] = "succeeded"
        self.results[job_id] = result
        return True

    def reset(self):
        self.jobs.clear()
        self.results.clear()
