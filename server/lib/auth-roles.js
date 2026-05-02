/**
 * lib/auth-roles.js
 *
 * Role-based access control middleware (Phase 7 — Tyler msg 28364).
 *
 * Roles (stored in auth_users.role column, baked into JWT payload):
 *   - 'admin'     : Tyler / owner. Full permissions.
 *   - 'operator'  : Uri or future ops staff. Restricted (see below).
 *   - 'system'    : Reserved for service-account JWTs (cron, internal calls).
 *
 * OPERATOR CAN:
 *   - View any case
 *   - Add notes, send approved messages
 *   - Request documents from customers
 *   - Update non-final statuses (assign, follow up, etc.)
 *   - Trigger comp re-runs (does not bypass filing gate)
 *
 * OPERATOR CANNOT:
 *   - Approve a case for filing
 *   - File protests (filed event)
 *   - Override status locks (force=true)
 *   - Edit canonical metrics directly
 *   - Change system config / deploy
 *   - Issue setup tokens / create users
 *
 * USAGE:
 *   const { requireRole, requireAdmin, requireOperator, ROLES } = require('./lib/auth-roles');
 *   app.post('/api/filing/approve', authenticateToken, requireAdmin, handler);
 *   app.post('/api/cases/:id/notes', authenticateToken, requireOperator, handler);
 */

'use strict';

const ROLES = Object.freeze({
  ADMIN:    'admin',
  OPERATOR: 'operator',
  SYSTEM:   'system',
});

// Role hierarchy: admin satisfies operator-level checks too.
const ROLE_RANK = {
  [ROLES.SYSTEM]:   100,
  [ROLES.ADMIN]:    50,
  [ROLES.OPERATOR]: 10,
};

/**
 * requireRole(minRole) → middleware
 *
 * Allows the request if req.user.role rank >= minRole rank.
 * Returns 401 when no user attached, 403 when role insufficient.
 */
function requireRole(minRole) {
  if (!ROLE_RANK[minRole] && minRole !== ROLES.OPERATOR) {
    throw new Error(`requireRole: unknown role '${minRole}'`);
  }
  const minRank = ROLE_RANK[minRole] ?? 0;
  return function roleGuard(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const userRank = ROLE_RANK[req.user.role] ?? 0;
    if (userRank < minRank) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: minRole,
        current: req.user.role || 'none',
      });
    }
    next();
  };
}

const requireAdmin    = requireRole(ROLES.ADMIN);
const requireOperator = requireRole(ROLES.OPERATOR);

/**
 * canPerform(role, action) → boolean
 *
 * Programmatic permission check used by route handlers that need conditional
 * logic (e.g. surface different UI based on role) rather than a hard middleware
 * gate.
 *
 * Action catalog:
 *   filing.approve       — admin only
 *   filing.file          — admin only
 *   filing.deny          — admin only
 *   case.lock            — admin only
 *   case.unlock          — admin only
 *   case.override_status — admin only
 *   metrics.write        — admin only (controller still gates further)
 *   case.note            — operator+
 *   case.message_send    — operator+
 *   case.request_doc     — operator+
 *   case.assign          — operator+
 *   case.follow_up       — operator+
 *   case.view            — operator+
 *   case.comps_rerun     — operator+ (controller still gates further)
 */
const ACTION_REQUIREMENTS = {
  'filing.approve':       ROLES.ADMIN,
  'filing.file':          ROLES.ADMIN,
  'filing.deny':          ROLES.ADMIN,
  'filing.reject':        ROLES.ADMIN,
  'case.lock':            ROLES.ADMIN,
  'case.unlock':          ROLES.ADMIN,
  'case.override_status': ROLES.ADMIN,
  'case.force':           ROLES.ADMIN,
  'metrics.write':        ROLES.ADMIN,
  'system.config':        ROLES.ADMIN,
  'system.deploy':        ROLES.ADMIN,
  'user.create':          ROLES.ADMIN,
  'user.setup_token':     ROLES.ADMIN,

  'case.note':            ROLES.OPERATOR,
  'case.message_send':    ROLES.OPERATOR,
  'case.request_doc':     ROLES.OPERATOR,
  'case.assign':          ROLES.OPERATOR,
  'case.follow_up':       ROLES.OPERATOR,
  'case.view':            ROLES.OPERATOR,
  'case.comps_rerun':     ROLES.OPERATOR,
  'case.status_update':   ROLES.OPERATOR,  // non-final status updates only
};

function canPerform(role, action) {
  const required = ACTION_REQUIREMENTS[action];
  if (!required) {
    // Unknown action → deny by default
    return false;
  }
  const userRank = ROLE_RANK[role] ?? 0;
  const requiredRank = ROLE_RANK[required] ?? 0;
  return userRank >= requiredRank;
}

/**
 * Express middleware factory: requirePermission('filing.approve')
 * Equivalent to requireRole(ACTION_REQUIREMENTS[action]) but expresses intent.
 */
function requirePermission(action) {
  const required = ACTION_REQUIREMENTS[action];
  if (!required) throw new Error(`requirePermission: unknown action '${action}'`);
  return requireRole(required);
}

module.exports = {
  ROLES,
  ROLE_RANK,
  ACTION_REQUIREMENTS,
  requireRole,
  requireAdmin,
  requireOperator,
  requirePermission,
  canPerform,
};
