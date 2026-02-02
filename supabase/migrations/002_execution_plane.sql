-- JobForge Execution Plane Schema
-- Extensions for runnerless autopilot modules
-- Version: 0.2.0
-- Depends: 001_jobforge_core.sql

-- ============================================================================
-- TABLE: jobforge_events
-- Standard Event Envelope storage for runnerless modules
-- ============================================================================
CREATE TABLE jobforge_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID, -- Optional project scoping within tenant
  
  -- Event envelope fields
  event_version TEXT NOT NULL DEFAULT '1.0',
  event_type TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trace_id TEXT NOT NULL,
  actor_id TEXT, -- Optional actor identifier
  
  -- Source tracking
  source_app TEXT NOT NULL CHECK (source_app IN ('settler', 'aias', 'keys', 'readylayer', 'jobforge', 'external')),
  source_module TEXT CHECK (source_module IN ('ops', 'support', 'growth', 'finops', 'core')),
  
  -- Subject references (optional entity refs)
  subject_type TEXT,
  subject_id TEXT,
  
  -- Payload (schema depends on event_type)
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  
  -- Privacy and redaction
  contains_pii BOOLEAN NOT NULL DEFAULT false,
  redaction_hints JSONB,
  
  -- Processing state
  processed BOOLEAN NOT NULL DEFAULT false,
  processed_at TIMESTAMPTZ,
  processing_job_id UUID REFERENCES jobforge_jobs(id) ON DELETE SET NULL,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Indexes
  CONSTRAINT jobforge_events_trace_unique UNIQUE (trace_id, event_type, occurred_at)
);

-- Indexes for efficient querying
CREATE INDEX idx_jobforge_events_tenant_project ON jobforge_events (tenant_id, project_id, created_at DESC);
CREATE INDEX idx_jobforge_events_type_time ON jobforge_events (event_type, occurred_at DESC);
CREATE INDEX idx_jobforge_events_trace ON jobforge_events (trace_id);
CREATE INDEX idx_jobforge_events_source ON jobforge_events (source_app, source_module);
CREATE INDEX idx_jobforge_events_unprocessed ON jobforge_events (processed) WHERE processed = false;
CREATE INDEX idx_jobforge_events_subject ON jobforge_events (subject_type, subject_id) WHERE subject_type IS NOT NULL;

-- ============================================================================
-- TABLE: jobforge_artifact_manifests
-- Canonical manifest for job run outputs
-- ============================================================================
CREATE TABLE jobforge_artifact_manifests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL UNIQUE REFERENCES jobforge_jobs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  project_id UUID,
  
  -- Manifest metadata
  manifest_version TEXT NOT NULL DEFAULT '1.0',
  job_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Input/output references
  inputs_snapshot_ref TEXT, -- Reference to stored inputs
  logs_ref TEXT, -- Reference to logs storage
  
  -- Outputs array (structured)
  outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Format: [{"name": "string", "type": "string", "ref": "string", "size": number, "checksum": "string"}]
  
  -- Metrics
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Format: {"duration_ms": number, "cpu_ms": number, "memory_mb": number, "cost_estimate": number}
  
  -- Environment fingerprint
  env_fingerprint JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Format: {"os": "string", "arch": "string", "node_version": "string", "tool_versions": {}}
  
  -- Tool versions used
  tool_versions JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Format: {"jobforge": "0.2.0", "connectors": {"http": "1.0.0"}}
  
  -- Manifest status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete', 'failed')),
  error JSONB
);

-- Indexes
CREATE INDEX idx_jobforge_manifests_tenant ON jobforge_artifact_manifests (tenant_id, created_at DESC);
CREATE INDEX idx_jobforge_manifests_job_type ON jobforge_artifact_manifests (job_type);
CREATE INDEX idx_jobforge_manifests_project ON jobforge_artifact_manifests (project_id) WHERE project_id IS NOT NULL;

-- ============================================================================
-- TABLE: jobforge_job_templates
-- Registry for autopilot-style job templates
-- ============================================================================
CREATE TABLE jobforge_job_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL UNIQUE, -- e.g., 'autopilot.ops.scan'
  
  -- Template metadata
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('ops', 'support', 'growth', 'finops', 'core')),
  version TEXT NOT NULL DEFAULT '1.0.0',
  
  -- Schemas (stored as JSON for flexibility)
  input_schema JSONB NOT NULL, -- Zod-compatible JSON schema
  output_schema JSONB NOT NULL,
  
  -- Requirements
  required_scopes JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of required permission scopes
  required_connectors JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of required connector types
  estimated_cost_tier TEXT NOT NULL DEFAULT 'low' CHECK (estimated_cost_tier IN ('low', 'medium', 'high')),
  
  -- Execution config
  default_max_attempts INT NOT NULL DEFAULT 3,
  default_timeout_ms INT NOT NULL DEFAULT 300000, -- 5 minutes
  
  -- Safety flags
  is_action_job BOOLEAN NOT NULL DEFAULT false, -- Requires policy token if true
  enabled BOOLEAN NOT NULL DEFAULT false, -- Feature flag per template
  
  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_jobforge_templates_category ON jobforge_job_templates (category);
CREATE INDEX idx_jobforge_templates_enabled ON jobforge_job_templates (enabled) WHERE enabled = true;
CREATE INDEX idx_jobforge_templates_action ON jobforge_job_templates (is_action_job) WHERE is_action_job = true;

-- ============================================================================
-- TABLE: jobforge_audit_logs
-- Audit trail for event ingestion and job requests
-- ============================================================================
CREATE TABLE jobforge_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID,
  
  -- Audit entry
  action TEXT NOT NULL CHECK (action IN ('event_ingest', 'job_request', 'job_cancel', 'policy_check', 'trigger_fire')),
  actor_id TEXT,
  
  -- Reference to related entities
  event_id UUID REFERENCES jobforge_events(id) ON DELETE SET NULL,
  job_id UUID REFERENCES jobforge_jobs(id) ON DELETE SET NULL,
  template_key TEXT,
  
  -- Request details
  request_payload JSONB,
  response_summary JSONB,
  
  -- Policy and scope info
  scopes_granted JSONB,
  policy_token_used TEXT,
  policy_check_result BOOLEAN,
  
  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  duration_ms INT
);

-- Indexes
CREATE INDEX idx_jobforge_audit_tenant ON jobforge_audit_logs (tenant_id, created_at DESC);
CREATE INDEX idx_jobforge_audit_action ON jobforge_audit_logs (action, created_at DESC);
CREATE INDEX idx_jobforge_audit_event ON jobforge_audit_logs (event_id) WHERE event_id IS NOT NULL;
CREATE INDEX idx_jobforge_audit_job ON jobforge_audit_logs (job_id) WHERE job_id IS NOT NULL;

-- ============================================================================
-- TABLE: jobforge_triggers
-- Scheduling triggers for cron and event-driven execution
-- ============================================================================
CREATE TABLE jobforge_triggers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID,
  
  -- Trigger config
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('cron', 'event')),
  name TEXT NOT NULL,
  
  -- Cron triggers
  cron_expression TEXT, -- Standard cron format (e.g., '0 0 * * *')
  
  -- Event triggers
  event_type_filter TEXT, -- Match event_type (for event triggers)
  event_source_filter TEXT, -- Match source_app (optional)
  
  -- Action to take
  target_template_key TEXT NOT NULL REFERENCES jobforge_job_templates(template_key),
  target_inputs JSONB NOT NULL DEFAULT '{}'::jsonb, -- Template inputs to use
  
  -- Feature flags
  enabled BOOLEAN NOT NULL DEFAULT false,
  dry_run BOOLEAN NOT NULL DEFAULT false, -- Log what would trigger without executing
  
  -- Last execution tracking
  last_fired_at TIMESTAMPTZ,
  last_job_id UUID REFERENCES jobforge_jobs(id) ON DELETE SET NULL,
  fire_count INT NOT NULL DEFAULT 0,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_jobforge_triggers_tenant ON jobforge_triggers (tenant_id, enabled);
CREATE INDEX idx_jobforge_triggers_template ON jobforge_triggers (target_template_key);
CREATE INDEX idx_jobforge_triggers_event ON jobforge_triggers (event_type_filter) WHERE trigger_type = 'event';

-- ============================================================================
-- RPC: jobforge_submit_event
-- Ingest a standard event envelope
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_submit_event(
  p_tenant_id UUID,
  p_event_type TEXT,
  p_trace_id TEXT,
  p_source_app TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb,
  p_project_id UUID DEFAULT NULL,
  p_actor_id TEXT DEFAULT NULL,
  p_source_module TEXT DEFAULT NULL,
  p_subject_type TEXT DEFAULT NULL,
  p_subject_id TEXT DEFAULT NULL,
  p_contains_pii BOOLEAN DEFAULT false,
  p_redaction_hints JSONB DEFAULT NULL,
  p_event_version TEXT DEFAULT '1.0'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_row jobforge_events%ROWTYPE;
BEGIN
  -- Validate inputs
  IF p_tenant_id IS NULL OR p_event_type IS NULL OR p_trace_id IS NULL OR p_source_app IS NULL THEN
    RAISE EXCEPTION 'tenant_id, event_type, trace_id, and source_app are required';
  END IF;

  -- Insert event
  INSERT INTO jobforge_events (
    tenant_id,
    project_id,
    event_version,
    event_type,
    trace_id,
    actor_id,
    source_app,
    source_module,
    subject_type,
    subject_id,
    payload,
    contains_pii,
    redaction_hints
  )
  VALUES (
    p_tenant_id,
    p_project_id,
    p_event_version,
    p_event_type,
    p_trace_id,
    p_actor_id,
    p_source_app,
    p_source_module,
    p_subject_type,
    p_subject_id,
    p_payload,
    p_contains_pii,
    p_redaction_hints
  )
  RETURNING * INTO v_event_row;

  -- Create audit log entry
  INSERT INTO jobforge_audit_logs (
    tenant_id,
    project_id,
    action,
    actor_id,
    event_id,
    request_payload
  )
  VALUES (
    p_tenant_id,
    p_project_id,
    'event_ingest',
    p_actor_id,
    v_event_row.id,
    jsonb_build_object('event_type', p_event_type, 'source_app', p_source_app)
  );

  RETURN row_to_json(v_event_row)::jsonb;
END;
$$;

-- ============================================================================
-- RPC: jobforge_request_job
-- Request execution of an autopilot job from a template
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_request_job(
  p_tenant_id UUID,
  p_template_key TEXT,
  p_inputs JSONB DEFAULT '{}'::jsonb,
  p_project_id UUID DEFAULT NULL,
  p_trace_id TEXT DEFAULT NULL,
  p_actor_id TEXT DEFAULT NULL,
  p_dry_run BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_template jobforge_job_templates%ROWTYPE;
  v_job_result JSONB;
  v_audit_id UUID;
  v_trace TEXT;
BEGIN
  -- Validate inputs
  IF p_tenant_id IS NULL OR p_template_key IS NULL THEN
    RAISE EXCEPTION 'tenant_id and template_key are required';
  END IF;

  -- Get template
  SELECT * INTO v_template
  FROM jobforge_job_templates
  WHERE template_key = p_template_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found: %', p_template_key;
  END IF;

  -- Check if template is enabled
  IF NOT v_template.enabled THEN
    RAISE EXCEPTION 'Template is disabled: %', p_template_key;
  END IF;

  -- Generate trace_id if not provided
  v_trace := COALESCE(p_trace_id, gen_random_uuid()::text);

  -- Create audit log entry first
  INSERT INTO jobforge_audit_logs (
    tenant_id,
    project_id,
    action,
    actor_id,
    template_key,
    request_payload,
    response_summary
  )
  VALUES (
    p_tenant_id,
    p_project_id,
    'job_request',
    p_actor_id,
    p_template_key,
    jsonb_build_object('inputs', p_inputs, 'dry_run', p_dry_run),
    NULL
  )
  RETURNING id INTO v_audit_id;

  -- If dry_run, return without creating job
  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'dry_run', true,
      'template_key', p_template_key,
      'would_execute', true,
      'trace_id', v_trace,
      'audit_id', v_audit_id
    );
  END IF;

  -- Enqueue job using existing enqueue function
  SELECT jobforge_enqueue_job(
    p_tenant_id,
    p_template_key,
    jsonb_build_object(
      'template_inputs', p_inputs,
      'trace_id', v_trace,
      'actor_id', p_actor_id,
      'project_id', p_project_id
    ),
    NULL, -- idempotency_key
    NOW(),
    v_template.default_max_attempts
  ) INTO v_job_result;

  -- Update audit log with job reference
  UPDATE jobforge_audit_logs
  SET 
    job_id = (v_job_result->>'id')::UUID,
    response_summary = jsonb_build_object('job_id', v_job_result->>'id', 'status', 'queued'),
    processed_at = NOW()
  WHERE id = v_audit_id;

  RETURN jsonb_build_object(
    'job', v_job_result,
    'trace_id', v_trace,
    'audit_id', v_audit_id
  );
END;
$$;

-- ============================================================================
-- RPC: jobforge_create_manifest
-- Create an artifact manifest for a job run
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_create_manifest(
  p_run_id UUID,
  p_tenant_id UUID,
  p_job_type TEXT,
  p_project_id UUID DEFAULT NULL,
  p_inputs_snapshot_ref TEXT DEFAULT NULL,
  p_logs_ref TEXT DEFAULT NULL,
  p_outputs JSONB DEFAULT '[]'::jsonb,
  p_metrics JSONB DEFAULT '{}'::jsonb,
  p_env_fingerprint JSONB DEFAULT '{}'::jsonb,
  p_tool_versions JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_manifest_row jobforge_artifact_manifests%ROWTYPE;
BEGIN
  -- Validate inputs
  IF p_run_id IS NULL OR p_tenant_id IS NULL OR p_job_type IS NULL THEN
    RAISE EXCEPTION 'run_id, tenant_id, and job_type are required';
  END IF;

  INSERT INTO jobforge_artifact_manifests (
    run_id,
    tenant_id,
    project_id,
    job_type,
    inputs_snapshot_ref,
    logs_ref,
    outputs,
    metrics,
    env_fingerprint,
    tool_versions,
    status
  )
  VALUES (
    p_run_id,
    p_tenant_id,
    p_project_id,
    p_job_type,
    p_inputs_snapshot_ref,
    p_logs_ref,
    p_outputs,
    p_metrics,
    p_env_fingerprint,
    p_tool_versions,
    'complete'
  )
  RETURNING * INTO v_manifest_row;

  RETURN row_to_json(v_manifest_row)::jsonb;
END;
$$;

-- ============================================================================
-- RPC: jobforge_get_manifest
-- Retrieve an artifact manifest by run_id
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_get_manifest(
  p_run_id UUID,
  p_tenant_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_manifest_row jobforge_artifact_manifests%ROWTYPE;
BEGIN
  SELECT * INTO v_manifest_row
  FROM jobforge_artifact_manifests
  WHERE run_id = p_run_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN row_to_json(v_manifest_row)::jsonb;
END;
$$;

-- ============================================================================
-- RPC: jobforge_list_events
-- Query events with filters
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_list_events(
  p_tenant_id UUID,
  p_project_id UUID DEFAULT NULL,
  p_filters JSONB DEFAULT '{}'::jsonb
)
RETURNS SETOF jobforge_events
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event_type TEXT;
  v_source_app TEXT;
  v_processed BOOLEAN;
  v_limit INT;
  v_offset INT;
  v_from_time TIMESTAMPTZ;
  v_to_time TIMESTAMPTZ;
BEGIN
  -- Extract filters
  v_event_type := p_filters->>'event_type';
  v_source_app := p_filters->>'source_app';
  v_processed := (p_filters->>'processed')::BOOLEAN;
  v_limit := LEAST(COALESCE((p_filters->>'limit')::INT, 100), 1000);
  v_offset := COALESCE((p_filters->>'offset')::INT, 0);
  v_from_time := (p_filters->>'from_time')::TIMESTAMPTZ;
  v_to_time := (p_filters->>'to_time')::TIMESTAMPTZ;

  RETURN QUERY
  SELECT *
  FROM jobforge_events
  WHERE tenant_id = p_tenant_id
    AND (p_project_id IS NULL OR project_id = p_project_id)
    AND (v_event_type IS NULL OR event_type = v_event_type)
    AND (v_source_app IS NULL OR source_app = v_source_app)
    AND (v_processed IS NULL OR processed = v_processed)
    AND (v_from_time IS NULL OR occurred_at >= v_from_time)
    AND (v_to_time IS NULL OR occurred_at <= v_to_time)
  ORDER BY occurred_at DESC
  LIMIT v_limit
  OFFSET v_offset;
END;
$$;

-- ============================================================================
-- RLS POLICIES for Execution Plane Tables
-- ============================================================================

-- Events policies
ALTER TABLE jobforge_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobforge_events_select_policy ON jobforge_events
  FOR SELECT
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.tenant_id', true) IS NULL
  );

CREATE POLICY jobforge_events_insert_policy ON jobforge_events
  FOR INSERT
  WITH CHECK (false); -- RPC only

CREATE POLICY jobforge_events_update_policy ON jobforge_events
  FOR UPDATE
  USING (false);

CREATE POLICY jobforge_events_delete_policy ON jobforge_events
  FOR DELETE
  USING (false);

-- Manifests policies
ALTER TABLE jobforge_artifact_manifests ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobforge_manifests_select_policy ON jobforge_artifact_manifests
  FOR SELECT
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.tenant_id', true) IS NULL
  );

CREATE POLICY jobforge_manifests_write_policy ON jobforge_artifact_manifests
  FOR ALL
  USING (false);

-- Templates policies (global read, admin write)
ALTER TABLE jobforge_job_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobforge_templates_select_policy ON jobforge_job_templates
  FOR SELECT
  TO authenticated, anon
  USING (true);

CREATE POLICY jobforge_templates_write_policy ON jobforge_job_templates
  FOR ALL
  USING (false);

-- Audit logs policies
ALTER TABLE jobforge_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobforge_audit_select_policy ON jobforge_audit_logs
  FOR SELECT
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.tenant_id', true) IS NULL
  );

CREATE POLICY jobforge_audit_write_policy ON jobforge_audit_logs
  FOR ALL
  USING (false);

-- Triggers policies
ALTER TABLE jobforge_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobforge_triggers_select_policy ON jobforge_triggers
  FOR SELECT
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.tenant_id', true) IS NULL
  );

CREATE POLICY jobforge_triggers_write_policy ON jobforge_triggers
  FOR ALL
  USING (false);

-- ============================================================================
-- GRANTS
-- ============================================================================

-- Grant execute on new RPC functions
GRANT EXECUTE ON FUNCTION jobforge_submit_event TO authenticated, anon;
GRANT EXECUTE ON FUNCTION jobforge_request_job TO authenticated, anon;
GRANT EXECUTE ON FUNCTION jobforge_create_manifest TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION jobforge_get_manifest TO authenticated, anon;
GRANT EXECUTE ON FUNCTION jobforge_list_events TO authenticated, anon;

-- Grant SELECT on new tables (RLS enforced)
GRANT SELECT ON jobforge_events TO authenticated, anon;
GRANT SELECT ON jobforge_artifact_manifests TO authenticated, anon;
GRANT SELECT ON jobforge_job_templates TO authenticated, anon;
GRANT SELECT ON jobforge_audit_logs TO authenticated, anon;
GRANT SELECT ON jobforge_triggers TO authenticated, anon;

-- ============================================================================
-- SEED DATA: Default Job Templates
-- ============================================================================

INSERT INTO jobforge_job_templates (
  template_key,
  name,
  description,
  category,
  input_schema,
  output_schema,
  required_scopes,
  required_connectors,
  estimated_cost_tier,
  is_action_job,
  enabled
) VALUES
-- Ops templates
('autopilot.ops.scan', 'Infrastructure Scan', 'Scan infrastructure for issues', 'ops',
 '{"type":"object","properties":{"target":{"type":"string"},"scan_type":{"type":"string","enum":["security","cost","performance"]}}}',
 '{"type":"object","properties":{"findings":{"type":"array"},"summary":{"type":"string"}}}',
 '["ops:read"]',
 '[]',
 'low',
 false,
 false),

('autopilot.ops.diagnose', 'Issue Diagnosis', 'Diagnose infrastructure issues', 'ops',
 '{"type":"object","properties":{"alert_id":{"type":"string"},"service":{"type":"string"}}}',
 '{"type":"object","properties":{"root_cause":{"type":"string"},"recommendations":{"type":"array"}}}',
 '["ops:read"]',
 '[]',
 'medium',
 false,
 false),

('autopilot.ops.recommend', 'Recommendation Engine', 'Generate recommendations', 'ops',
 '{"type":"object","properties":{"category":{"type":"string"},"constraints":{"type":"object"}}}',
 '{"type":"object","properties":{"recommendations":{"type":"array"},"confidence_scores":{"type":"object"}}}',
 '["ops:read"]',
 '[]',
 'low',
 false,
 false),

('autopilot.ops.apply', 'Apply Changes', 'Apply infrastructure changes', 'ops',
 '{"type":"object","properties":{"changeset_id":{"type":"string"},"approval_token":{"type":"string"}}}',
 '{"type":"object","properties":{"applied":{"type":"boolean"},"change_log":{"type":"array"}}}',
 '["ops:write"]',
 '[]',
 'high',
 true,
 false),

-- Support templates
('autopilot.support.triage', 'Ticket Triage', 'Triage support tickets', 'support',
 '{"type":"object","properties":{"ticket_id":{"type":"string"},"content":{"type":"string"}}}',
 '{"type":"object","properties":{"priority":{"type":"string"},"category":{"type":"string"},"suggested_assignee":{"type":"string"}}}',
 '["support:read"]',
 '[]',
 'low',
 false,
 false),

('autopilot.support.draft_reply', 'Draft Reply', 'Draft support ticket replies', 'support',
 '{"type":"object","properties":{"ticket_id":{"type":"string"},"tone":{"type":"string","enum":["professional","friendly","technical"]}}}',
 '{"type":"object","properties":{"draft_reply":{"type":"string"},"suggested_resources":{"type":"array"}}}',
 '["support:read"]',
 '[]',
 'low',
 false,
 false),

('autopilot.support.propose_kb_patch', 'Propose KB Update', 'Propose knowledge base updates', 'support',
 '{"type":"object","properties":{"article_id":{"type":"string"},"suggested_changes":{"type":"string"}}}',
 '{"type":"object","properties":{"patch_id":{"type":"string"},"review_url":{"type":"string"}}}',
 '["support:read"]',
 '[]',
 'low',
 false,
 false),

-- Growth templates
('autopilot.growth.seo_scan', 'SEO Scan', 'Scan for SEO issues', 'growth',
 '{"type":"object","properties":{"url":{"type":"string"},"depth":{"type":"integer","default":1}}}',
 '{"type":"object","properties":{"issues":{"type":"array"},"score":{"type":"number"}}}',
 '["growth:read"]',
 '[]',
 'low',
 false,
 false),

('autopilot.growth.experiment_propose', 'Propose Experiment', 'Propose growth experiments', 'growth',
 '{"type":"object","properties":{"goal":{"type":"string"},"channel":{"type":"string"}}}',
 '{"type":"object","properties":{"experiment_id":{"type":"string"},"hypothesis":{"type":"string"},"metrics":{"type":"array"}}}',
 '["growth:read"]',
 '[]',
 'low',
 false,
 false),

('autopilot.growth.content_draft', 'Content Draft', 'Draft content for marketing', 'growth',
 '{"type":"object","properties":{"topic":{"type":"string"},"format":{"type":"string","enum":["blog","email","social","ad"]},"tone":{"type":"string"}}}',
 '{"type":"object","properties":{"draft":{"type":"string"},"suggested_headlines":{"type":"array"},"seo_keywords":{"type":"array"}}}',
 '["growth:read"]',
 '[]',
 'medium',
 false,
 false),

-- FinOps templates
('autopilot.finops.reconcile', 'Cost Reconciliation', 'Reconcile cloud costs', 'finops',
 '{"type":"object","properties":{"provider":{"type":"string"},"billing_period":{"type":"string"}}}',
 '{"type":"object","properties":{"discrepancies":{"type":"array"},"total_cost":{"type":"number"}}}',
 '["finops:read"]',
 '[]',
 'medium',
 false,
 false),

('autopilot.finops.anomaly_scan', 'Anomaly Detection', 'Scan for cost anomalies', 'finops',
 '{"type":"object","properties":{"time_range":{"type":"string"},"threshold_pct":{"type":"number","default":20}}}',
 '{"type":"object","properties":{"anomalies":{"type":"array"},"investigation_links":{"type":"array"}}}',
 '["finops:read"]',
 '[]',
 'low',
 false,
 false),

('autopilot.finops.churn_risk_report', 'Churn Risk Report', 'Generate churn risk analysis', 'finops',
 '{"type":"object","properties":{"segment":{"type":"string"},"timeframe":{"type":"string"}}}',
 '{"type":"object","properties":{"at_risk_accounts":{"type":"array"},"risk_factors":{"type":"object"}}}',
 '["finops:read"]',
 '[]',
 'medium',
 false,
 false);

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE jobforge_events IS 'Standard Event Envelope storage for runnerless autopilot modules';
COMMENT ON TABLE jobforge_artifact_manifests IS 'Canonical manifest for job run outputs';
COMMENT ON TABLE jobforge_job_templates IS 'Registry for autopilot-style job templates';
COMMENT ON TABLE jobforge_audit_logs IS 'Audit trail for event ingestion and job requests';
COMMENT ON TABLE jobforge_triggers IS 'Scheduling triggers for cron and event-driven execution';

-- Update version marker
COMMENT ON TABLE jobforge_jobs IS 'JobForge job queue with multi-tenant isolation (Execution Plane v0.2.0)';

-- ============================================================================
-- EXTENSION: Bundle Trigger Rules (v0.3.0)
-- Event-driven auto-triggering for bundle execution
-- ============================================================================

-- ============================================================================
-- TABLE: jobforge_bundle_trigger_rules
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobforge_bundle_trigger_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- Match configuration
  match_event_type_allowlist TEXT[] NOT NULL,
  match_source_module_allowlist TEXT[],
  match_severity_threshold TEXT,
  match_priority_threshold TEXT,
  -- Action configuration
  action_bundle_source TEXT NOT NULL CHECK (action_bundle_source IN ('inline', 'artifact_ref')),
  action_bundle_ref TEXT,
  action_bundle_builder TEXT,
  action_mode TEXT NOT NULL DEFAULT 'dry_run' CHECK (action_mode IN ('dry_run', 'execute')),
  -- Safety configuration
  safety_cooldown_seconds INT NOT NULL DEFAULT 60,
  safety_max_runs_per_hour INT NOT NULL DEFAULT 10,
  safety_dedupe_key_template TEXT,
  safety_allow_action_jobs BOOLEAN NOT NULL DEFAULT FALSE,
  -- Metadata
  last_fired_at TIMESTAMPTZ,
  fire_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for trigger rules
CREATE INDEX IF NOT EXISTS idx_jobforge_bundle_trigger_rules_tenant 
  ON jobforge_bundle_trigger_rules (tenant_id, enabled);
CREATE INDEX IF NOT EXISTS idx_jobforge_bundle_trigger_rules_event_types 
  ON jobforge_bundle_trigger_rules USING GIN (match_event_type_allowlist);

-- ============================================================================
-- TABLE: jobforge_trigger_evaluations
-- Audit trail of trigger rule evaluations
-- ============================================================================
CREATE TABLE IF NOT EXISTS jobforge_trigger_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  rule_id UUID NOT NULL REFERENCES jobforge_bundle_trigger_rules(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES jobforge_events(id) ON DELETE CASCADE,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matched BOOLEAN NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('fire', 'skip', 'rate_limited', 'cooldown', 'disabled', 'error')),
  reason TEXT NOT NULL,
  bundle_run_id UUID,
  dry_run BOOLEAN NOT NULL,
  safety_cooldown_passed BOOLEAN NOT NULL,
  safety_rate_limit_passed BOOLEAN NOT NULL,
  safety_dedupe_passed BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for evaluations
CREATE INDEX IF NOT EXISTS idx_jobforge_trigger_evaluations_rule 
  ON jobforge_trigger_evaluations (rule_id, evaluated_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobforge_trigger_evaluations_event 
  ON jobforge_trigger_evaluations (event_id);

-- Trigger for updated_at
CREATE TRIGGER jobforge_bundle_trigger_rules_update_timestamp
  BEFORE UPDATE ON jobforge_bundle_trigger_rules
  FOR EACH ROW
  EXECUTE FUNCTION jobforge_update_updated_at();

-- ============================================================================
-- RPC: jobforge_create_bundle_trigger_rule
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_create_bundle_trigger_rule(
  p_tenant_id UUID,
  p_name TEXT,
  p_match_event_type_allowlist TEXT[],
  p_action_bundle_source TEXT,
  p_action_mode TEXT DEFAULT 'dry_run',
  p_project_id UUID DEFAULT NULL,
  p_match_source_module_allowlist TEXT[] DEFAULT NULL,
  p_match_severity_threshold TEXT DEFAULT NULL,
  p_match_priority_threshold TEXT DEFAULT NULL,
  p_action_bundle_ref TEXT DEFAULT NULL,
  p_action_bundle_builder TEXT DEFAULT NULL,
  p_enabled BOOLEAN DEFAULT FALSE,
  p_safety_cooldown_seconds INT DEFAULT 60,
  p_safety_max_runs_per_hour INT DEFAULT 10,
  p_safety_allow_action_jobs BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule_row jobforge_bundle_trigger_rules%ROWTYPE;
BEGIN
  IF p_tenant_id IS NULL OR p_name IS NULL OR p_match_event_type_allowlist IS NULL THEN
    RAISE EXCEPTION 'tenant_id, name, and match_event_type_allowlist are required';
  END IF;

  INSERT INTO jobforge_bundle_trigger_rules (
    tenant_id,
    project_id,
    name,
    enabled,
    match_event_type_allowlist,
    match_source_module_allowlist,
    match_severity_threshold,
    match_priority_threshold,
    action_bundle_source,
    action_bundle_ref,
    action_bundle_builder,
    action_mode,
    safety_cooldown_seconds,
    safety_max_runs_per_hour,
    safety_allow_action_jobs
  )
  VALUES (
    p_tenant_id,
    p_project_id,
    p_name,
    p_enabled,
    p_match_event_type_allowlist,
    p_match_source_module_allowlist,
    p_match_severity_threshold,
    p_match_priority_threshold,
    p_action_bundle_source,
    p_action_bundle_ref,
    p_action_bundle_builder,
    p_action_mode,
    p_safety_cooldown_seconds,
    p_safety_max_runs_per_hour,
    p_safety_allow_action_jobs
  )
  RETURNING * INTO v_rule_row;

  RETURN row_to_json(v_rule_row)::jsonb;
END;
$$;

-- ============================================================================
-- RPC: jobforge_list_bundle_trigger_rules
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_list_bundle_trigger_rules(
  p_tenant_id UUID,
  p_project_id UUID DEFAULT NULL
)
RETURNS SETOF jobforge_bundle_trigger_rules
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM jobforge_bundle_trigger_rules
  WHERE tenant_id = p_tenant_id
    AND (p_project_id IS NULL OR project_id = p_project_id)
  ORDER BY created_at DESC;
END;
$$;

-- ============================================================================
-- RPC: jobforge_record_trigger_evaluation
-- ============================================================================
CREATE OR REPLACE FUNCTION jobforge_record_trigger_evaluation(
  p_tenant_id UUID,
  p_rule_id UUID,
  p_event_id UUID,
  p_matched BOOLEAN,
  p_decision TEXT,
  p_reason TEXT,
  p_dry_run BOOLEAN,
  p_safety_cooldown_passed BOOLEAN,
  p_safety_rate_limit_passed BOOLEAN,
  p_safety_dedupe_passed BOOLEAN,
  p_bundle_run_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_eval_row jobforge_trigger_evaluations%ROWTYPE;
BEGIN
  INSERT INTO jobforge_trigger_evaluations (
    tenant_id,
    rule_id,
    event_id,
    matched,
    decision,
    reason,
    dry_run,
    bundle_run_id,
    safety_cooldown_passed,
    safety_rate_limit_passed,
    safety_dedupe_passed
  )
  VALUES (
    p_tenant_id,
    p_rule_id,
    p_event_id,
    p_matched,
    p_decision,
    p_reason,
    p_dry_run,
    p_bundle_run_id,
    p_safety_cooldown_passed,
    p_safety_rate_limit_passed,
    p_safety_dedupe_passed
  )
  RETURNING * INTO v_eval_row;

  -- Update rule stats if fired
  IF p_decision = 'fire' THEN
    UPDATE jobforge_bundle_trigger_rules
    SET last_fired_at = NOW(),
        fire_count = fire_count + 1,
        updated_at = NOW()
    WHERE id = p_rule_id;
  END IF;

  RETURN row_to_json(v_eval_row)::jsonb;
END;
$$;

-- ============================================================================
-- RLS POLICIES for Bundle Trigger Tables
-- ============================================================================

ALTER TABLE jobforge_bundle_trigger_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobforge_trigger_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobforge_bundle_trigger_rules_select_policy ON jobforge_bundle_trigger_rules
  FOR SELECT
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.tenant_id', true) IS NULL
  );

CREATE POLICY jobforge_bundle_trigger_rules_write_policy ON jobforge_bundle_trigger_rules
  FOR ALL
  USING (false);

CREATE POLICY jobforge_trigger_evaluations_select_policy ON jobforge_trigger_evaluations
  FOR SELECT
  USING (
    tenant_id::text = current_setting('app.tenant_id', true)
    OR current_setting('app.tenant_id', true) IS NULL
  );

CREATE POLICY jobforge_trigger_evaluations_write_policy ON jobforge_trigger_evaluations
  FOR ALL
  USING (false);

-- ============================================================================
-- GRANTS for Bundle Trigger Functions
-- ============================================================================

GRANT EXECUTE ON FUNCTION jobforge_create_bundle_trigger_rule TO authenticated, anon;
GRANT EXECUTE ON FUNCTION jobforge_list_bundle_trigger_rules TO authenticated, anon;
GRANT EXECUTE ON FUNCTION jobforge_record_trigger_evaluation TO authenticated, service_role;

GRANT SELECT ON jobforge_bundle_trigger_rules TO authenticated, anon;
GRANT SELECT ON jobforge_trigger_evaluations TO authenticated, anon;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE jobforge_bundle_trigger_rules IS 'Bundle trigger rules for event-driven bundle execution (v0.3.0)';
COMMENT ON TABLE jobforge_trigger_evaluations IS 'Audit trail of bundle trigger rule evaluations';
