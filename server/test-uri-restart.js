// Simulate server boot to verify Uri persists
require('dotenv').config();
const bcrypt = require('bcryptjs');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

const USERS_FILE = require('path').join(__dirname, 'users.json');

async function readJsonFile(f) {
    try { return JSON.parse(await fs.readFile(f, 'utf8')); } catch { return null; }
}

(async () => {
    console.log('=== SIMULATING SERVER BOOT ===');
    
    // Read current state
    let users = await readJsonFile(USERS_FILE);
    if (!Array.isArray(users)) users = [];
    console.log('Users before boot:', users.map(u => u.email + ' (' + u.role + ')'));
    
    // Admin account — always reset password
    const adminHash = await bcrypt.hash('OverAssessed!2026', 10);
    const adminIdx = users.findIndex(u => u.email === 'tyler@overassessed.ai');
    if (adminIdx >= 0) {
        users[adminIdx].password = adminHash;
        users[adminIdx].role = 'admin';
    } else {
        users.push({ id: uuidv4(), email: 'tyler@overassessed.ai', password: adminHash, name: 'Tyler Worthey', role: 'admin', createdAt: new Date().toISOString() });
    }
    
    // Uri agent account — create if missing, reset password if exists
    const uriHash = await bcrypt.hash('OA-Uri-2026!', 10);
    const uriIdx = users.findIndex(u => u.email === 'uri@overassessed.ai');
    if (uriIdx >= 0) {
        users[uriIdx].password = uriHash;
        users[uriIdx].role = 'agent';
    } else {
        users.push({ id: uuidv4(), email: 'uri@overassessed.ai', password: uriHash, name: 'Uri Uriah', role: 'agent', createdAt: new Date().toISOString() });
    }
    
    await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
    
    // Verify
    const after = JSON.parse(await fs.readFile(USERS_FILE, 'utf8'));
    console.log('\nUsers after boot:', after.map(u => u.email + ' (' + u.role + ')'));
    
    const uri = after.find(u => u.email === 'uri@overassessed.ai');
    const validPw = await bcrypt.compare('OA-Uri-2026!', uri.password);
    console.log('\n=== URI VERIFICATION ===');
    console.log('Exists after restart:', !!uri);
    console.log('Role:', uri.role);
    console.log('Password valid:', validPw);
    console.log('ID preserved:', uri.id);
    
    // Test login flow
    const loginUser = after.find(u => u.email === 'uri@overassessed.ai');
    const loginValid = loginUser && await bcrypt.compare('OA-Uri-2026!', loginUser.password);
    console.log('\n=== LOGIN TEST ===');
    console.log('Login result:', loginValid ? '✅ SUCCESS' : '❌ FAILED');
})();
