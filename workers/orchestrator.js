/**
 * ORCHESTRATOR — Polls job_queue, assigns to workers, handles retries
 * 
 * Runs as standalone Railway service.
 * Workers run in-process as async handlers (MVP — no separate service yet).
 */

const { createClient } = require('@supabase/supabase-js');
const analysisWorker = require('./analysis-worker');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ylxreuqvofgbpsatfsvr.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '5000');
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT || '3');
const WORKER_ID = `orchestrator-${process.pid}`;

if (!SUPABASE_KEY) {
    console.error('FATAL: SUPABASE_SERVICE_ROLE_KEY required');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Track running jobs
const running = new Map();

// Worker registry — maps job_type to handler
const WORKERS = {
    'run_comps': analysisWorker.runComps,
    'run_qa': analysisWorker.runQA,
    'classify_lead': analysisWorker.classifyLead,
    'analyze_lead': analysisWorker.analyzeLead,  // combined: comps + qa + classify
};

async function claimJob() {
    if (running.size >= MAX_CONCURRENT) return null;

    // Atomic claim: find oldest pending job and set to running
    const { data: jobs, error } = await supabase
        .from('job_queue')
        .select('*')
        .eq('status', 'pending')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true })
        .limit(1);

    if (error || !jobs?.length) return null;

    const job = jobs[0];

    // Attempt atomic claim via conditional update
    const { data: claimed, error: claimErr } = await supabase
        .from('job_queue')
        .update({
            status: 'running',
            assigned_worker: WORKER_ID,
            started_at: new Date().toISOString()
        })
        .eq('id', job.id)
        .eq('status', 'pending')  // Only claim if still pending
        .select()
        .single();

    if (claimErr || !claimed) return null;  // Someone else claimed it

    return claimed;
}

async function executeJob(job) {
    const handler = WORKERS[job.job_type];
    if (!handler) {
        await failJob(job.id, `Unknown job_type: ${job.job_type}`);
        return;
    }

    console.log(`[EXEC] ${job.id.slice(0,8)} | ${job.job_type} | ${JSON.stringify(job.payload).slice(0,80)}`);

    try {
        const result = await handler(job.payload, supabase);

        await supabase.from('job_queue').update({
            status: 'done',
            result: result || {},
            completed_at: new Date().toISOString()
        }).eq('id', job.id);

        console.log(`[DONE] ${job.id.slice(0,8)} | ${job.job_type} | ${JSON.stringify(result).slice(0,80)}`);
    } catch (err) {
        console.error(`[FAIL] ${job.id.slice(0,8)} | ${job.job_type} | ${err.message}`);

        if (job.retries + 1 < job.max_retries) {
            // Retry with exponential backoff
            const backoff = Math.pow(2, job.retries + 1) * 1000;
            await supabase.from('job_queue').update({
                status: 'pending',
                assigned_worker: null,
                started_at: null,
                retries: job.retries + 1,
                error: err.message
            }).eq('id', job.id);
            console.log(`[RETRY] ${job.id.slice(0,8)} | attempt ${job.retries + 2}/${job.max_retries} | backoff ${backoff}ms`);
        } else {
            await failJob(job.id, err.message);
        }
    } finally {
        running.delete(job.id);
    }
}

async function failJob(jobId, errorMsg) {
    await supabase.from('job_queue').update({
        status: 'failed',
        error: errorMsg,
        completed_at: new Date().toISOString()
    }).eq('id', jobId);
    console.log(`[DEAD] ${jobId.slice(0,8)} | max retries exhausted`);
}

async function checkRetries() {
    // Find stale running jobs (stuck > 5 min) and reset them
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stale } = await supabase
        .from('job_queue')
        .select('id, retries, max_retries')
        .eq('status', 'running')
        .lt('started_at', fiveMinAgo);

    for (const job of (stale || [])) {
        if (job.retries + 1 < job.max_retries) {
            await supabase.from('job_queue').update({
                status: 'pending',
                assigned_worker: null,
                started_at: null,
                retries: job.retries + 1,
                error: 'Timed out (>5min)'
            }).eq('id', job.id);
            console.log(`[TIMEOUT] ${job.id.slice(0,8)} reset to pending`);
        } else {
            await failJob(job.id, 'Timed out and max retries exhausted');
        }
    }
}

async function pollLoop() {
    try {
        // Check for stale jobs every cycle
        await checkRetries();

        // Claim and execute jobs
        while (running.size < MAX_CONCURRENT) {
            const job = await claimJob();
            if (!job) break;

            running.set(job.id, true);
            // Fire and forget — runs in parallel
            executeJob(job).catch(err => {
                console.error(`[UNCAUGHT] ${job.id.slice(0,8)}: ${err.message}`);
                running.delete(job.id);
            });
        }
    } catch (err) {
        console.error('[POLL ERROR]', err.message);
    }
}

// Health endpoint
const http = require('http');
const PORT = process.env.PORT || 3001;

const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'ok',
            worker_id: WORKER_ID,
            running_jobs: running.size,
            max_concurrent: MAX_CONCURRENT,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        }));
    } else if (req.url === '/stats') {
        // Quick stats query
        supabase.from('job_queue')
            .select('status', { count: 'exact', head: false })
            .then(({ data }) => {
                const counts = { pending: 0, running: 0, done: 0, failed: 0 };
                for (const row of (data || [])) counts[row.status] = (counts[row.status] || 0) + 1;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(counts));
            })
            .catch(() => { res.writeHead(500); res.end('error'); });
    } else {
        res.writeHead(404);
        res.end('not found');
    }
});

server.listen(PORT, () => {
    console.log(`\n══════════════════════════════════════════`);
    console.log(`  ORCHESTRATOR ONLINE`);
    console.log(`  Worker ID: ${WORKER_ID}`);
    console.log(`  Poll interval: ${POLL_INTERVAL}ms`);
    console.log(`  Max concurrent: ${MAX_CONCURRENT}`);
    console.log(`  Health: http://localhost:${PORT}/health`);
    console.log(`══════════════════════════════════════════\n`);

    // Start poll loop
    setInterval(pollLoop, POLL_INTERVAL);
    pollLoop();  // Run immediately
});
