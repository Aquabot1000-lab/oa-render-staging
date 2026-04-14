/**
 * BaseAgent — shared foundation for all OA agents
 * Every agent extends this for logging, task creation, and error handling
 */
const { supabaseAdmin } = require('../lib/supabase');

const MC_URL = process.env.MC_URL || 'https://mission-control-production-8225.up.railway.app';

class BaseAgent {
    constructor(name) {
        this.name = name;
        this.startTime = null;
    }

    /** Override in subclass: return true if this agent handles this task type */
    canHandle(taskType) {
        return false;
    }

    /** Override in subclass: execute the task */
    async execute(task, ctx) {
        throw new Error(`${this.name}.execute() not implemented`);
    }

    /** Log action to activity_log */
    async log(caseId, action, details = {}) {
        try {
            await supabaseAdmin.from('activity_log').insert({
                case_id: caseId,
                actor: this.name,
                action,
                details: typeof details === 'string' ? { message: details } : details
            });
        } catch (err) {
            console.error(`[${this.name}] activity_log write failed:`, err.message);
        }
    }

    /** Create or update MC task */
    async createTask(taskData) {
        try {
            const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const payload = {
                id,
                company: 'OA',
                agent: this.name,
                owner: 'Bot',
                trigger: 'Agent',
                status: 'in_progress',
                ...taskData
            };
            const res = await fetch(`${MC_URL}/api/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!res.ok) console.error(`[${this.name}] MC task create failed: ${res.status}`);
            return id;
        } catch (err) {
            console.error(`[${this.name}] MC task create error:`, err.message);
            return null;
        }
    }

    /** Update MC task status */
    async updateTask(taskId, updates) {
        try {
            await fetch(`${MC_URL}/api/tasks/${taskId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
        } catch (err) {
            console.error(`[${this.name}] MC task update error:`, err.message);
        }
    }

    /** Update submission in Supabase */
    async updateSubmission(caseId, fields) {
        const { error } = await supabaseAdmin
            .from('submissions')
            .update({ ...fields, updated_at: new Date().toISOString() })
            .eq('case_id', caseId);
        if (error) throw new Error(`Supabase update failed for ${caseId}: ${error.message}`);
    }

    /** Get submission by case_id */
    async getSubmission(caseId) {
        const { data, error } = await supabaseAdmin
            .from('submissions')
            .select('*')
            .eq('case_id', caseId)
            .single();
        if (error) throw new Error(`Supabase read failed for ${caseId}: ${error.message}`);
        return data;
    }

    /** Wrap execution with timing + error handling */
    async run(task, ctx = {}) {
        this.startTime = Date.now();
        const taskId = await this.createTask({
            title: `${this.name}: ${task.type} for ${task.caseId}`,
            detail: task.detail || '',
            category: 'pipeline',
            currentStep: 'Starting',
            tier: task.priority || 'MEDIUM',
            impact: 'PIPELINE'
        });

        try {
            await this.log(task.caseId, `${task.type}_started`, { taskId });
            const result = await this.execute(task, ctx);
            const elapsed = Date.now() - this.startTime;

            await this.log(task.caseId, `${task.type}_completed`, {
                taskId,
                elapsed_ms: elapsed,
                result: result?.summary || 'OK'
            });

            if (taskId) {
                await this.updateTask(taskId, {
                    status: 'completed',
                    currentStep: 'Done',
                    nextAction: result?.nextAction || null
                });
            }

            return { success: true, taskId, elapsed, ...result };
        } catch (err) {
            const elapsed = Date.now() - this.startTime;
            console.error(`[${this.name}] Error on ${task.caseId}:`, err.message);

            await this.log(task.caseId, `${task.type}_failed`, {
                taskId,
                elapsed_ms: elapsed,
                error: err.message
            });

            if (taskId) {
                await this.updateTask(taskId, {
                    status: 'failed',
                    currentStep: `Error: ${err.message.slice(0, 200)}`
                });
            }

            return { success: false, taskId, elapsed, error: err.message };
        }
    }
}

module.exports = BaseAgent;
