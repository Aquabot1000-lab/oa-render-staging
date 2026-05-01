#!/usr/bin/env node
/**
 * capture-uri-telegram-chat-id.js
 *
 * One-time helper to capture Uri's Telegram chat ID after he DMs the bot.
 *
 * INSTRUCTIONS FOR URI:
 *   1. Open Telegram
 *   2. Search for @WortheyAquaBot
 *   3. Tap "Start" (or send any message like "hello")
 *
 * Then run this script — it scans recent updates, finds Uri's chat,
 * and prints the env line to add to .env / Render config.
 *
 * Usage:
 *   node scripts/capture-uri-telegram-chat-id.js
 *   node scripts/capture-uri-telegram-chat-id.js --name "Uri"
 *   node scripts/capture-uri-telegram-chat-id.js --user-id 123456789
 *
 * Does NOT modify any config files. Read-only discovery.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8546685923:AAGxRV6_YwimsyLvaORNhZTNu-1JM9PtdDs';
const TYLER_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '8568734697';

const args = process.argv.slice(2);
const nameFilter = (args.indexOf('--name') >= 0 ? args[args.indexOf('--name') + 1] : 'uri').toLowerCase();
const userIdFilter = args.indexOf('--user-id') >= 0 ? args[args.indexOf('--user-id') + 1] : null;

(async () => {
    const fetchFn = (typeof fetch !== 'undefined') ? fetch : require('node-fetch');
    const url = `https://api.telegram.org/bot${TOKEN}/getUpdates?limit=100&offset=-100`;
    const res = await fetchFn(url);
    const data = await res.json();
    if (!data.ok) {
        console.error('getUpdates failed:', data.description);
        process.exit(1);
    }

    console.log(`\nFound ${data.result.length} recent updates.`);
    console.log(`Tyler's chat (excluded): ${TYLER_CHAT_ID}\n`);

    const seen = new Map();
    for (const u of data.result) {
        const msg = u.message || u.edited_message || u.callback_query?.message;
        if (!msg) continue;
        const chat = msg.chat || u.callback_query?.from;
        if (!chat) continue;
        const id = String(chat.id);
        if (id === String(TYLER_CHAT_ID)) continue; // skip Tyler
        if (seen.has(id)) continue;
        seen.set(id, {
            chat_id: id,
            type: chat.type,
            first_name: chat.first_name || '',
            last_name: chat.last_name || '',
            username: chat.username || '',
            user_id: msg.from?.id || ''
        });
    }

    if (!seen.size) {
        console.log('No non-Tyler chats found in recent 100 updates.');
        console.log('\nAsk Uri to DM @WortheyAquaBot then re-run within ~24h.');
        process.exit(0);
    }

    console.log('Candidate chats (non-Tyler):');
    console.log('─'.repeat(80));
    for (const c of seen.values()) {
        const matchesName = nameFilter && (
            c.first_name.toLowerCase().includes(nameFilter) ||
            c.last_name.toLowerCase().includes(nameFilter) ||
            c.username.toLowerCase().includes(nameFilter)
        );
        const matchesUserId = userIdFilter && String(c.user_id) === String(userIdFilter);
        const flag = (matchesName || matchesUserId) ? ' ⬅️  LIKELY URI' : '';
        console.log(`  chat_id=${c.chat_id} type=${c.type} name="${c.first_name} ${c.last_name}".trim() username=@${c.username}${flag}`);
    }

    const likely = [...seen.values()].find(c =>
        (nameFilter && (c.first_name.toLowerCase().includes(nameFilter) || c.last_name.toLowerCase().includes(nameFilter) || c.username.toLowerCase().includes(nameFilter))) ||
        (userIdFilter && String(c.user_id) === String(userIdFilter))
    );

    if (likely) {
        console.log('\n' + '─'.repeat(80));
        console.log('✅ Add this to .env / Render env vars:');
        console.log('');
        console.log(`URI_TELEGRAM_CHAT_ID=${likely.chat_id}`);
        console.log('');
        console.log('Then redeploy. Uri will start receiving Telegram alerts.');
    } else {
        console.log('\n⚠️  No clear Uri match. Use --name "<part of name>" or --user-id <id> to narrow.');
        console.log('Or pass --user-id with the Telegram user ID Uri shares.');
    }
})();
