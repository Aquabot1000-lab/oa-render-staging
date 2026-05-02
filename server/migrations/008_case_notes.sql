-- Phase 4: case_notes table (Tyler msg 28535, 2026-05-01)
-- ========================================================
-- Persistent note storage. Every note write also fires
-- updateCaseState('note_added') in the application layer so it appears
-- in activity_log for the unified timeline.

CREATE TABLE IF NOT EXISTS case_notes (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    case_id      text NOT NULL,
    note_type    text NOT NULL CHECK (note_type IN ('call', 'decision', 'issue', 'general')),
    text         text NOT NULL CHECK (length(text) > 0),
    actor        text NOT NULL,                    -- email or system label
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz,                       -- soft delete; NULL = active
    deleted_by   text,
    edit_count   integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_case_notes_case_id        ON case_notes(case_id);
CREATE INDEX IF NOT EXISTS idx_case_notes_created_at     ON case_notes(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_notes_case_active    ON case_notes(case_id, created_at DESC) WHERE deleted_at IS NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION case_notes_set_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    IF OLD.text IS DISTINCT FROM NEW.text OR OLD.note_type IS DISTINCT FROM NEW.note_type THEN
        NEW.edit_count := COALESCE(OLD.edit_count, 0) + 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_case_notes_updated ON case_notes;
CREATE TRIGGER trg_case_notes_updated
    BEFORE UPDATE ON case_notes
    FOR EACH ROW
    EXECUTE FUNCTION case_notes_set_updated_at();

COMMENT ON TABLE case_notes IS 'Phase 4: persistent case notes. Mirrors to activity_log via updateCaseState(note_added).';
